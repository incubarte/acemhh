import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { withPermission } from "@/lib/authMiddleware";
import { EXPENSE_CONCEPTS } from "@/lib/expenses";

export const POST = withPermission('api', '/api/expenses', 'POST', async (sess, req) => {
  const body = (await req.json()) as {
    amount: number;
    concept: string;
    notes?: string | null;
    is_cash?: boolean;
  };

  const amount = Number(body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return new NextResponse("Invalid amount", { status: 400 });
  }

  const concept = (body?.concept ?? "").trim();
  if (!(EXPENSE_CONCEPTS as readonly string[]).includes(concept)) {
    return new NextResponse("Invalid concept", { status: 400 });
  }

  const notes = (body?.notes ?? "").trim() || null;
  if (concept === "otros" && !notes) {
    return new NextResponse("Las notas son obligatorias para el concepto 'otros'", { status: 400 });
  }

  const { data, error } = await supabaseAdmin()
    .from("expenses")
    .insert([{
      amount,
      concept,
      notes,
      paid_by: sess.id,
      is_cash: body?.is_cash ?? true,
    }])
    .select("id")
    .single();

  if (error) return new NextResponse(error.message, { status: 500 });
  return NextResponse.json({ expense: data });
});
