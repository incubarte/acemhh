import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { withPermission } from "@/lib/authMiddleware";
import { categoriesForSlot, isGoalkeeperFriendlySlot } from "@/lib/schedule";

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
    const genericSlot = toGenericSlot(isoDate, hour);
    const cats = categoriesForSlot(isoDate, genericSlot);
    const selectedMonth = isoDate.substring(0, 7);

    if (cats.length === 0) {
      return new NextResponse("Invalid slot", { status: 400 });
    }

    const s = supabaseAdmin();

    // Fetch A: all players that belong to category and train
    const { data: categoryPlayers, error: playersError } = await s
      .from("players")
      .select("*")
      .in("category", cats)
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
        .eq("slot", genericSlot),
      s.from("payments")
        .select("player_id, amount")
        .eq("concept", "session")
        .eq("session", specificSlot),
      s.from("payments")
        .select("player_id")
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

    const paidDuesIds = new Set((duesPayments || []).map(d => d.player_id));

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
        paidMembershipDues: paidDuesIds.has(player.id),
        section,
      });
    }

    // On goalkeeper-friendly slots, every goalkeeper shows up in the arqueros
    // section regardless of their category.
    if (isGoalkeeperFriendlySlot(genericSlot)) {
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
          paidMembershipDues: paidDuesIds.has(player.id),
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
          paidMembershipDues: paidDuesIds.has(player.id),
          section,
        });
      }
    }

    return NextResponse.json({ players: result });
  } catch (error) {
    console.error(error);
    return new NextResponse("Internal server error", { status: 500 });
  }
});
