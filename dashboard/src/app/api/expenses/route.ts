import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { withPermission } from "@/lib/authMiddleware";

export const POST = withPermission('api', '/api/expenses', 'POST', async (sess, req) => {
  const body = (await req.json()) as {
    amount: number;
    concept: string;
    payee: string;
    month?: string | null;
    is_cash?: boolean;
    notes?: string | null;
  };

  const amount = Number(body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return new NextResponse("Invalid amount", { status: 400 });
  }

  const concept = (body?.concept ?? "").trim();
  const payee = (body?.payee ?? "").trim();
  if (!concept || !payee) {
    return new NextResponse("Missing fields", { status: 400 });
  }

  const month = (body?.month ?? "").trim() || null;
  if (month && !/^\d{4}-\d{2}$/.test(month)) {
    return new NextResponse("Invalid month", { status: 400 });
  }

  const { data, error } = await supabaseAdmin()
    .from("expenses")
    .insert([{
      amount,
      concept,
      payee,
      month,
      paid_by: sess.id,
      is_cash: body?.is_cash ?? true,
      notes: (body?.notes ?? "").trim() || null,
    }])
    .select("id")
    .single();

  if (error) return new NextResponse(error.message, { status: 500 });
  return NextResponse.json({ expense: data });
});
