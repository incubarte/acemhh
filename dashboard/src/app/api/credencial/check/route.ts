import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { ANNUAL_DUES } from "@/lib/dues";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const playerId = (searchParams.get("player_id") || "").trim();
    if (!playerId) {
      return new NextResponse("Missing player_id", { status: 400 });
    }

    const s = supabaseAdmin();

    // Get player info
    const { data: player, error: playerErr } = await s
      .from("players")
      .select("id,name,last_name,dni,fecha_nac,categories,invitee")
      .eq("id", playerId)
      .maybeSingle();

    if (playerErr) {
      console.error("/api/credencial/check GET player error:", playerErr.message);
      return NextResponse.json({ error: playerErr.message }, { status: 500 });
    }
    if (!player) return new NextResponse("Player not found", { status: 404 });

    // Check membership dues payments for the current year
    const year = new Date().getUTCFullYear();
    const monthFrom = `${year}-01`;
    const monthTo = `${year}-12`;

    const { data: payments, error: payErr } = await s
      .from("payments")
      .select("id,amount,month,created_at")
      .eq("player_id", playerId)
      .eq("concept", "membership dues")
      .gte("month", monthFrom)
      .lte("month", monthTo)
      .order("created_at", { ascending: false });

    if (payErr) {
      console.error("/api/credencial/check GET payments error:", payErr.message);
      return NextResponse.json({ error: payErr.message }, { status: 500 });
    }

    const totalPaid = (payments ?? []).reduce((sum, p) => sum + Number(p.amount), 0);
    // Up to date only with the FULL annual dues — one payment or installments
    // summing to it; a partial payment still shows as owing.
    const upToDate = totalPaid >= ANNUAL_DUES;

    return NextResponse.json({
      player: {
        id: player.id,
        name: player.name,
        last_name: player.last_name,
        dni: player.dni,
        fecha_nac: player.fecha_nac,
        categories: player.categories,
        invitee: player.invitee,
      },
      year,
      upToDate,
      totalPaid,
      payments: (payments ?? []).map((p) => ({
        amount: Number(p.amount),
        month: p.month,
        date: p.created_at,
      })),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("/api/credencial/check GET failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
