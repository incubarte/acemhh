import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { withPermission, type AuthSession } from "@/lib/authMiddleware";
import { cleanNotes, duplicateResponse, recentDuplicate } from "@/lib/moneyWrites";

function formatRegisteredBy(sess: AuthSession | null): string {
  if (!sess) return "[unknown]";
  const name = `${sess.first_name}${sess.last_name ? ` ${sess.last_name}` : ""}`.trim();
  const uname = sess.username ? `@${sess.username}` : "";
  const head = `${name}${uname ? ` (${uname})` : ""}`.trim();
  return `${head || "[unknown]"} [id=${sess.id}]`;
}

function currentYearMonth() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export const POST = withPermission('api', '/api/payments/dues', 'POST', async (sess, req) => {

  const body = (await req.json()) as {
    player_id: string;
    amount: number;
    month?: string;
    notes?: string | null;
    confirm_duplicate?: boolean;
  };
  if (!body?.player_id || !body?.amount) {
    return new NextResponse("Missing fields", { status: 400 });
  }

  const month = (body.month ?? "").trim() || currentYearMonth();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return new NextResponse("Invalid month", { status: 400 });
  }

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return new NextResponse("Invalid amount", { status: 400 });
  }

  const s = supabaseAdmin();

  if (!body.confirm_duplicate && await recentDuplicate(s, "payments", {
    player_id: body.player_id,
    concept: "membership dues",
    amount,
  })) {
    return duplicateResponse("una matrícula");
  }

  // Keep consistent with existing payments schema constraints:
  // - concept='monthly' uses month and no session
  // - dashboard dues uses concept='membership dues'
  const { error } = await s.from("payments").insert([
    {
      id: crypto.randomUUID(),
      player_id: body.player_id,
      registered_by: formatRegisteredBy(sess),
      registered_by_user_id: sess.id,
      concept: "membership dues",
      month,
      amount,
      // Paid straight to the bank account: the concept alone keeps it out of
      // the registering admin's caja.
      notes: cleanNotes(body.notes),
    },
  ]);

  if (error) return new NextResponse(error.message, { status: 500 });
  return NextResponse.json({ ok: true });
});
