import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { withPermission } from "@/lib/authMiddleware";

function slotToCat(slot: string): string[] {
  switch (slot) {
    case "jue 21hs":
      return ["cat-a"];
    case "jue 22hs":
      return ["cat-b"];
    case "jue 23hs":
      return ["cat-c"];
    default:
      return [];
  }
}

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

    // Parse session format: YYYY-MM-DD-HH
    const parts = session.split('-');
    if (parts.length !== 4) {
      return new NextResponse("Invalid session format", { status: 400 });
    }

    const isoDate = `${parts[0]}-${parts[1]}-${parts[2]}`;
    const hour = parts[3];
    
    const specificSlot = toSpecificSlot(isoDate, hour);
    const genericSlot = toGenericSlot(isoDate, hour);
    const cats = slotToCat(genericSlot);
    const selectedMonth = isoDate.substring(0, 7);

    if (cats.length === 0) {
      return new NextResponse("Invalid slot", { status: 400 });
    }

    // Get players for the categories
    const { data: players, error: playersError } = await supabaseAdmin()
      .from("players")
      .select("*")
      .in("category", cats)
      .order("last_name")
      .order("name");

    if (playersError) {
      console.error(playersError);
      return new NextResponse("Error fetching players", { status: 500 });
    }

    // Get attendances for this session
    const { data: attendances, error: attendanceError } = await supabaseAdmin()
      .from("attendances")
      .select("*")
      .eq("session", specificSlot);

    if (attendanceError) {
      console.error(attendanceError);
      return new NextResponse("Error fetching attendances", { status: 500 });
    }

    // Get payments for this month and slot
    const { data: payments, error: paymentsError } = await supabaseAdmin()
      .from("payments")
      .select("player_id, amount")
      .eq("concept", "monthly")
      .eq("month", selectedMonth)
      .eq("slot", genericSlot);

    if (paymentsError) {
      console.error(paymentsError);
      return new NextResponse("Error fetching payments", { status: 500 });
    }

    // Build response with attendance and payment info
    const attendanceMap = new Map(
      (attendances || []).map(a => [a.player_id, a.attended])
    );

    const paymentMap = new Map<string, number>();
    const hasPaymentMap = new Map<string, boolean>();
    (payments || []).forEach(p => {
      const current = paymentMap.get(p.player_id) || 0;
      paymentMap.set(p.player_id, current + p.amount);
      hasPaymentMap.set(p.player_id, true);
    });

    const playersWithData = (players || []).map(player => ({
      ...player,
      attended: attendanceMap.get(player.id) || false,
      payments: paymentMap.get(player.id) || 0,
      hasSessionPayment: hasPaymentMap.get(player.id) || false,
    }));

    return NextResponse.json({ players: playersWithData });
  } catch (error) {
    console.error(error);
    return new NextResponse("Internal server error", { status: 500 });
  }
});
