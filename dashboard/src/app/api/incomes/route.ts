import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { withPermission } from "@/lib/authMiddleware";
import { cleanNotes, duplicateResponse, recentDuplicate } from "@/lib/moneyWrites";

// Money that comes in with no player behind it — a colecta, a feria del plato.
// Always cash, into the caja of whoever registers it.
export const POST = withPermission('api', '/api/incomes', 'POST', async (sess, req) => {
  const body = (await req.json()) as {
    amount: number;
    concept: string;
    notes?: string | null;
    confirm_duplicate?: boolean;
  };

  const amount = Number(body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return new NextResponse("Invalid amount", { status: 400 });
  }

  // Free text: these are one-off by nature, there is no list to pick from.
  const concept = (body?.concept ?? "").trim();
  if (!concept) {
    return new NextResponse("Contá de dónde salió la plata", { status: 400 });
  }

  const s = supabaseAdmin();
  if (!body.confirm_duplicate && await recentDuplicate(s, "incomes", {
    received_by: sess.id,
    concept,
    amount,
  })) {
    return duplicateResponse("un ingreso");
  }

  const { data, error } = await s
    .from("incomes")
    .insert([{ amount, concept, notes: cleanNotes(body?.notes), received_by: sess.id }])
    .select("id")
    .single();

  if (error) return new NextResponse(error.message, { status: 500 });
  return NextResponse.json({ income: data });
});
