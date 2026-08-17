import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { withPermission } from "@/lib/authMiddleware";

// The giver registers the handoff; it stays pending (and out of balances)
// until the receiver accepts it in /api/handoffs/accept.
export const POST = withPermission('api', '/api/handoffs', 'POST', async (sess, req) => {
  const body = (await req.json()) as { amount: number; to_user: string };

  const amount = Number(body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return new NextResponse("Invalid amount", { status: 400 });
  }

  const toUser = (body?.to_user ?? "").trim();
  if (!toUser) return new NextResponse("Missing to_user", { status: 400 });
  if (toUser === sess.id) {
    return new NextResponse("No podés entregarte caja a vos mismo", { status: 400 });
  }

  const s = supabaseAdmin();

  const { data: receiver, error: receiverError } = await s
    .from("users")
    .select("id,groups")
    .eq("id", toUser)
    .maybeSingle();

  if (receiverError) return new NextResponse(receiverError.message, { status: 500 });
  if (!receiver || (receiver.groups ?? []).length === 0) {
    return new NextResponse("El destinatario no es un admin", { status: 400 });
  }

  const { data, error } = await s
    .from("cash_handoffs")
    .insert([{ amount, from_user: sess.id, to_user: toUser }])
    .select("id")
    .single();

  if (error) return new NextResponse(error.message, { status: 500 });
  return NextResponse.json({ handoff: data });
});
