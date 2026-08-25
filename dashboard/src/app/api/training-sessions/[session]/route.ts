import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireFeatures } from "@/lib/slotFeatures";
import { isoWeekday } from "@shared/slot";
import { withPermission } from "@/lib/authMiddleware";
import { LEDGER_DEFAULTS, ledgerExtrasFor } from "@/lib/rosterLedger";
import { duesStatusFor, duesTotalsByPlayer } from "@/lib/dues";
import { currentTrainingDate } from "@/lib/trainingDay";

function toSpecificSlot(isoDate: string, hour: string): string {
  return `${isoDate} ${hour}hs`;
}


type Section = "jugadores" | "invitados" | "arqueros";

export const GET = withPermission('api', '/api/training-sessions', 'GET', async (sess, req) => {
  try {
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/');
    const session = pathParts[pathParts.length - 1]; // YYYY-MM-DD-HH

    // Parse session format: YYYY-MM-DD-HH
    const parts = session.split('-');
    if (parts.length !== 4) {
      return new NextResponse("Invalid session format", { status: 400 });
    }

    const isoDate = `${parts[0]}-${parts[1]}-${parts[2]}`;
    const hour = parts[3];

    const specificSlot = toSpecificSlot(isoDate, hour);
    const selectedMonth = isoDate.substring(0, 7);

    const s = supabaseAdmin();

    // The agenda lives in training_sessions; a date/hour without a row (e.g. a
    // holiday) is not a valid session.
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

    // Fetch A: all players that belong to any of the slot's categories and train.
    // A player appears in the sessions of every category they belong to.
    const { data: categoryPlayers, error: playersError } = await s
      .from("players")
      .select("*")
      .overlaps("categories", cats)
      .eq("trains", true)
      .order("last_name")
      .order("name");

    if (playersError) {
      console.error(playersError);
      return new NextResponse("Error fetching players", { status: 500 });
    }

    // Fetch B: all attendances for current session
    const { data: attendances, error: attendanceError } = await s
      .from("attendances")
      .select("*")
      .eq("session", specificSlot);

    if (attendanceError) {
      console.error(attendanceError);
      return new NextResponse("Error fetching attendances", { status: 500 });
    }

    // Fetch C: all payments for current session or monthly slot, plus annual dues for the session year
    const sessionYear = parts[0];
    const [
      { data: monthlyPayments, error: monthlyError },
      { data: sessionPayments, error: sessionError },
      { data: duesPayments, error: duesError },
    ] = await Promise.all([
      s.from("payments")
        .select("player_id, amount")
        .eq("concept", "monthly")
        .eq("month", selectedMonth)
        .eq("slot_weekday", isoWeekday(isoDate))
        .eq("slot_hour", Number(hour)),
      s.from("payments")
        .select("player_id, amount")
        .eq("concept", "session")
        .eq("session", specificSlot),
      s.from("payments")
        .select("player_id, amount")
        .eq("concept", "membership dues")
        .gte("month", `${sessionYear}-01`)
        .lte("month", `${sessionYear}-12`),
    ]);

    if (monthlyError) {
      console.error(monthlyError);
      return new NextResponse("Error fetching monthly payments", { status: 500 });
    }
    if (sessionError) {
      console.error(sessionError);
      return new NextResponse("Error fetching session payments", { status: 500 });
    }
    if (duesError) {
      console.error(duesError);
      return new NextResponse("Error fetching dues payments", { status: 500 });
    }

    // Up to date only when the year's dues payments SUM to the full amount.
    const duesTotals = duesTotalsByPlayer(duesPayments || []);
    const duesStatusOf = (id: string) => duesStatusFor(duesTotals.get(id) ?? 0);

    // Build attendance and payment maps
    const attendanceMap = new Map(
      (attendances || []).map(a => [a.player_id, a.attended])
    );

    const paymentMap = new Map<string, number>();
    const hasPaymentMap = new Map<string, boolean>();
    for (const p of (monthlyPayments || [])) {
      paymentMap.set(p.player_id, (paymentMap.get(p.player_id) || 0) + p.amount);
      hasPaymentMap.set(p.player_id, true);
    }
    for (const p of (sessionPayments || [])) {
      paymentMap.set(p.player_id, (paymentMap.get(p.player_id) || 0) + p.amount);
      hasPaymentMap.set(p.player_id, true);
    }

    // Assign category players to sections
    const knownIds = new Set<string>();
    const result: Array<Record<string, unknown> & { section: Section }> = [];

    for (const player of (categoryPlayers || [])) {
      knownIds.add(player.id);
      const section: Section =
        player.player_type === "goalkeeper" ? "arqueros" :
        player.invitee ? "invitados" :
        "jugadores";

      result.push({
        ...player,
        attended: attendanceMap.get(player.id) || false,
        payments: paymentMap.get(player.id) || 0,
        hasSessionPayment: hasPaymentMap.get(player.id) || false,
        paidMembershipDues: duesStatusOf(player.id) === "full",
          dues_status: duesStatusOf(player.id),
        section,
      });
    }

    // On goalkeeper-friendly slots, every goalkeeper shows up in the arqueros
    // section regardless of their category.
    if (goalies) {
      const { data: allGoalkeepers, error: gkError } = await s
        .from("players")
        .select("*")
        .eq("player_type", "goalkeeper")
        .order("last_name")
        .order("name");

      if (gkError) {
        console.error(gkError);
        return new NextResponse("Error fetching goalkeepers", { status: 500 });
      }

      for (const player of (allGoalkeepers || [])) {
        if (knownIds.has(player.id)) continue;
        knownIds.add(player.id);
        result.push({
          ...player,
          attended: attendanceMap.get(player.id) || false,
          payments: paymentMap.get(player.id) || 0,
          hasSessionPayment: hasPaymentMap.get(player.id) || false,
          paidMembershipDues: duesStatusOf(player.id) === "full",
          dues_status: duesStatusOf(player.id),
          section: "arqueros",
        });
      }
    }

    // Collect extra player IDs from attendances and payments (not already in category+trains)
    const extraIds = new Set<string>();
    for (const a of (attendances || [])) {
      if (a.attended && !knownIds.has(a.player_id)) extraIds.add(a.player_id);
    }
    for (const p of (sessionPayments || [])) {
      if (!knownIds.has(p.player_id)) extraIds.add(p.player_id);
    }
    for (const p of (monthlyPayments || [])) {
      if (!knownIds.has(p.player_id)) extraIds.add(p.player_id);
    }

    // Fetch extra players
    if (extraIds.size > 0) {
      const { data: extraPlayers } = await s
        .from("players")
        .select("*")
        .in("id", Array.from(extraIds))
        .order("last_name")
        .order("name");

      for (const player of (extraPlayers || [])) {
        knownIds.add(player.id);
        const section: Section =
          player.player_type === "goalkeeper" ? "arqueros" : "invitados";

        result.push({
          ...player,
          attended: attendanceMap.get(player.id) || false,
          payments: paymentMap.get(player.id) || 0,
          hasSessionPayment: hasPaymentMap.get(player.id) || false,
          paidMembershipDues: duesStatusOf(player.id) === "full",
          dues_status: duesStatusOf(player.id),
          section,
        });
      }
    }

    // Ledger enrichment (lib/rosterLedger.ts): each player's debt, bonified
    // sessions and this month's payment presets. Sessions older than
    // LEDGER_FROM keep the legacy threshold logic client-side.
    const extras = await ledgerExtrasFor(
      s,
      result.map((p) => ({
        id: p.id as string,
        categories: p.categories as string[],
        player_type: p.player_type as string,
        scholarship: Number(p.scholarship) || 0,
      })),
      // The ledger needs the SESSION, not just its month: the payment presets
      // and "did this month's slot get bought" are per slot.
      session,
    );

    return NextResponse.json({
      players: result.map((p) => ({
        ...p,
        ...(extras.get(p.id as string) ?? LEDGER_DEFAULTS),
      })),
      slot: { categories: cats, goalies },
      // Lets the screen warn when a past or future session is open.
      current_date: await currentTrainingDate(s),
    });
  } catch (error) {
    console.error(error);
    return new NextResponse("Internal server error", { status: 500 });
  }
});
