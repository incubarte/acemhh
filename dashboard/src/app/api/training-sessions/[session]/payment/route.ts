import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { withPermission } from "@/lib/authMiddleware";

function toGenericSlot(isoDate: string, hour: string): string {
  const date = new Date(`${isoDate}T${hour}:00`);
  return date.toLocaleString("es-AR", {
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).replace(",", "") + "hs";
}

export const POST = withPermission('api', '/api/training-sessions/payment', 'POST', async (sess, req) => {
  try {
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/');
    const session = pathParts[pathParts.length - 2]; // YYYY-MM-DD-HH

    // Parse session format: YYYY-MM-DD-HH
    const parts = session.split('-');
    if (parts.length !== 4) {
      return new NextResponse("Invalid session format", { status: 400 });
    }

    const isoDate = `${parts[0]}-${parts[1]}-${parts[2]}`;
    const hour = parts[3];
    const genericSlot = toGenericSlot(isoDate, hour);
    const selectedMonth = isoDate.substring(0, 7);

    const body = await req.json() as { player_id: string; amount: number };
    
    if (!body?.player_id || !body?.amount) {
      return new NextResponse("Missing fields", { status: 400 });
    }

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return new NextResponse("Invalid amount", { status: 400 });
    }

    const paymentId = crypto.randomUUID();

    const registeredBy = `${sess.first_name}${sess.last_name ? ` ${sess.last_name}` : ''} ${sess.username ? `(@${sess.username})` : ''} [id=${sess.id}]`.trim();

    const s = supabaseAdmin();

    // Anything up to one session's price is a per-session payment; more than
    // that is a monthly. The tariff valid at the session's date decides.
    const { data: price, error: priceError } = await s
      .from("prices")
      .select("session_price")
      .lte("valid_from", isoDate)
      .order("valid_from", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (priceError || !price) {
      console.error("Price lookup failed:", priceError);
      return new NextResponse("No price configured for this date", { status: 500 });
    }

    const isSession = amount <= Number(price.session_price);

    const { error } = await s
      .from("payments")
      .insert([{
        id: paymentId,
        player_id: body.player_id,
        registered_by: registeredBy,
        registered_by_user_id: sess.id,
        slot: genericSlot,
        concept: isSession ? "session" : "monthly",
        month: selectedMonth,
        session: isSession ? `${isoDate} ${hour}hs` : null,
        amount,
        is_cash: true,
      }]);

    if (error) {
      if (error.code === "23505") {
        return new NextResponse("Payment already registered", { status: 409 });
      }
      console.error(error);
      return new NextResponse("Error registering payment", { status: 500 });
    }

    return NextResponse.json({ ok: true, payment_id: paymentId });
  } catch (error) {
    console.error(error);
    return new NextResponse("Internal server error", { status: 500 });
  }
});
