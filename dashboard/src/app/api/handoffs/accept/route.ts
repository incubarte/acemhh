import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { withPermission } from "@/lib/authMiddleware";

export const POST = withPermission('api', '/api/handoffs/accept', 'POST', async (sess, req) => {
  const body = (await req.json()) as { id: string };
  const id = (body?.id ?? "").trim();
  if (!id) return new NextResponse("Missing id", { status: 400 });

  // Only the receiver can accept, and only once: the filters make a repeated
  // or foreign accept find no row instead of double-counting.
  const { data, error } = await supabaseAdmin()
    .from("cash_handoffs")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("to_user", sess.id)
    .is("accepted_at", null)
    .select("id")
    .maybeSingle();

  if (error) return new NextResponse(error.message, { status: 500 });
  if (!data) return new NextResponse("Entrega no encontrada o ya confirmada", { status: 404 });

  return NextResponse.json({ ok: true });
});
