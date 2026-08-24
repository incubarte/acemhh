import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireFeatures } from "@/lib/slotFeatures";
import { withPermission } from "@/lib/authMiddleware";
import { LEDGER_DEFAULTS, ledgerExtrasFor } from "@/lib/rosterLedger";
import { duesStatusFor, duesTotalsByPlayer } from "@/lib/dues";
import { currentTrainingDate } from "@/lib/trainingDay";

// Roster for the redesigned attendance & payments screen. Unlike the legacy
// route it ignores the trains flag entirely, includes every player whose
// categories overlap the slot's, and adds the signals the new screen groups
// by: whether they qualify for the slot and whether they attended any of the
// slot's last 3 trainings.

function toSpecificSlot(isoDate: string, hour: string): string {
  return `${isoDate} ${hour}hs`;
}

function toGenericSlot(isoDate: string, hour: string): string {
  const date = new Date(`${isoDate}T${hour}:00`);
  return date.toLocaleString("es-AR", {
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).replace(",", "") + "hs";
}

export const GET = withPermission('api', '/api/training-sessions', 'GET', async (sess, req) => {
  try {
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/');
    const session = pathParts[pathParts.length - 1]; // YYYY-MM-DD-HH

    const parts = session.split('-');
    if (parts.length !== 4) {
      return new NextResponse("Invalid session format", { status: 400 });
    }

    const isoDate = `${parts[0]}-${parts[1]}-${parts[2]}`;
    const hour = parts[3];
    const specificSlot = toSpecificSlot(isoDate, hour);
    const genericSlot = toGenericSlot(isoDate, hour);
    const selectedMonth = isoDate.substring(0, 7);
    const sessionYear = parts[0];

    const s = supabaseAdmin();

    const { data: slot, error: slotError } = await s
      .from("training_sessions_resolved")
      .select("categories,goalies")
      .eq("date", isoDate)
      .eq("hour", Number(hour))
      .maybeSingle();

    if (slotError) {
      console.error(slotError);
      return new NextResponse("Error fetching slot", { status: 500 });
    }
    if (!slot) {
      return new NextResponse("Invalid slot", { status: 400 });
    }
    // Features resolve as of the session's date; a slot with none configured
    // is a broken agenda, not something to guess at.
    const { categories: cats, goalies } = requireFeatures(slot, session);

    const [
      categoryPlayersRes,
      goalkeepersRes,
      attendancesRes,
      monthlyPaymentsRes,
      sessionPaymentsRes,
      duesRes,
      recentDatesRes,
    ] = await Promise.all([
      s.from("players").select("*").overlaps("categories", cats),
      goalies
        ? s.from("players").select("*").eq("player_type", "goalkeeper")
        : Promise.resolve({ data: [], error: null }),
      s.from("attendances").select("player_id,attended").eq("session", specificSlot),
      // The month bundle FOR this slot: bundles registered on other slots
      // belong to their own screen.
      s.from("payments")
        .select("player_id,amount")
        .eq("concept", "monthly")
        .eq("month", selectedMonth)
        .eq("slot", genericSlot),
      s.from("payments")
        .select("player_id,amount")
        .eq("concept", "session")
        .eq("session", specificSlot),
      s.from("payments")
        .select("player_id, amount")
        .eq("concept", "membership dues")
        .gte("month", `${sessionYear}-01`)
        .lte("month", `${sessionYear}-12`),
      // The slot group's most recent training dates before this session.
      s.from("training_sessions_resolved")
        .select("date")
        .overlaps("categories", cats)
        .lt("date", isoDate)
        .order("date", { ascending: false })
        .limit(9),
    ]);

    const firstError = categoryPlayersRes.error ?? goalkeepersRes.error ??
      attendancesRes.error ?? monthlyPaymentsRes.error ?? sessionPaymentsRes.error ??
      duesRes.error ?? recentDatesRes.error;
    if (firstError) {
      console.error(firstError);
      return new NextResponse("Error fetching roster", { status: 500 });
    }

    const last3Dates = [...new Set((recentDatesRes.data ?? []).map((r) => String(r.date)))]
      .sort()
      .slice(-3);

    // Who attended any of those dates (any hour of them).
    const recentAttendees = new Set<string>();
    if (last3Dates.length > 0) {
      const { data: recentAtt, error: recentAttError } = await s
        .from("attendances")
        .select("player_id,session")
        .eq("attended", true)
        .gte("session", last3Dates[0])
        .lt("session", isoDate);
      if (recentAttError) {
        console.error(recentAttError);
        return new NextResponse("Error fetching recent attendance", { status: 500 });
      }
      const dateSet = new Set(last3Dates);
      for (const a of recentAtt ?? []) {
        if (dateSet.has(String(a.session).slice(0, 10))) recentAttendees.add(a.player_id);
      }
    }

    const attendanceMap = new Map(
      (attendancesRes.data ?? []).map((a) => [a.player_id, a.attended]),
    );
    const paymentMap = new Map<string, number>();
    const amountsMap = new Map<string, number[]>();
    const hasSessionPaymentIds = new Set<string>();
    const monthlyPayerIds = new Set<string>();
    const addAmount = (playerId: string, amount: number) => {
      paymentMap.set(playerId, (paymentMap.get(playerId) ?? 0) + amount);
      amountsMap.set(playerId, [...(amountsMap.get(playerId) ?? []), amount]);
    };
    for (const p of monthlyPaymentsRes.data ?? []) {
      addAmount(p.player_id, Number(p.amount));
      monthlyPayerIds.add(p.player_id);
    }
    for (const p of sessionPaymentsRes.data ?? []) {
      addAmount(p.player_id, Number(p.amount));
      hasSessionPaymentIds.add(p.player_id);
    }
    // Up to date only when the year's dues payments SUM to the full amount.
    const duesTotals = duesTotalsByPlayer(duesRes.data ?? []);
    const duesStatusOf = (id: string) => duesStatusFor(duesTotals.get(id) ?? 0);

    // Assemble the roster: category players, goalies, plus anyone touching
    // this session through attendance or payments.
    const byId = new Map<string, Record<string, unknown>>();
    for (const p of categoryPlayersRes.data ?? []) byId.set(p.id, p);
    for (const p of goalkeepersRes.data ?? []) byId.set(p.id, p);

    // Extras are players tied to THIS session: attendance, a payment for it,
    // or the month's bundle registered on this very slot. Monthly payments on
    // other slots never pull a player from another category in here.
    const extraIds = new Set<string>();
    for (const a of attendancesRes.data ?? []) {
      if (a.attended && !byId.has(a.player_id)) extraIds.add(a.player_id);
    }
    for (const id of hasSessionPaymentIds) if (!byId.has(id)) extraIds.add(id);
    for (const id of monthlyPayerIds) if (!byId.has(id)) extraIds.add(id);

    if (extraIds.size > 0) {
      const { data: extraPlayers, error: extraError } = await s
        .from("players")
        .select("*")
        .in("id", Array.from(extraIds));
      if (extraError) {
        console.error(extraError);
        return new NextResponse("Error fetching extra players", { status: 500 });
      }
      for (const p of extraPlayers ?? []) byId.set(p.id, p);
    }

    const roster = [...byId.values()].sort((a, b) => {
      const bySurname = String(a.last_name).localeCompare(String(b.last_name));
      return bySurname !== 0 ? bySurname : String(a.name).localeCompare(String(b.name));
    });

    const extras = await ledgerExtrasFor(
      s,
      roster.map((p) => ({
        id: p.id as string,
        categories: p.categories as string[],
        player_type: p.player_type as string,
        scholarship: Number(p.scholarship) || 0,
        attendedThisSession: Boolean(attendanceMap.get(p.id as string)),
      })),
      selectedMonth,
    );

    return NextResponse.json({
      players: roster.map((p) => {
        const id = p.id as string;
        const categories = (p.categories ?? []) as string[];
        return {
          ...p,
          attended: attendanceMap.get(id) || false,
          payments: paymentMap.get(id) ?? 0,
          payment_amounts: amountsMap.get(id) ?? [],
          hasSessionPayment: hasSessionPaymentIds.has(id),
          paidMonthlyForSlot: monthlyPayerIds.has(id),
          paidMembershipDues: duesStatusOf(id) === "full",
          dues_status: duesStatusOf(id),
          qualifies: categories.some((c) => cats.includes(c)),
          recent_attendance: recentAttendees.has(id),
          ...(extras.get(id) ?? LEDGER_DEFAULTS),
        };
      }),
      slot: { categories: cats, goalies },
      // Lets the screen warn when a past or future session is open.
      current_date: await currentTrainingDate(s),
    });
  } catch (error) {
    console.error(error);
    return new NextResponse("Internal server error", { status: 500 });
  }
});
