import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { verifySessionCookieValue } from "@/lib/telegramAuth";

function requireAuth() {
  const v = cookies().get("dash_session")?.value;
  if (!v) return null;
  return verifySessionCookieValue(v);
}

function formatRegisteredBy(sess: ReturnType<typeof requireAuth>): string {
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

export async function POST(req: Request) {
  const sess = requireAuth();
  if (!sess) return new NextResponse("Unauthorized", { status: 401 });

  const body = (await req.json()) as { player_id: string; amount: number; month?: string };
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

  // Keep consistent with existing payments schema constraints:
  // - concept='monthly' uses month and no session
  // - dashboard dues uses concept='membership dues'
  const { error } = await s.from("payments").insert([
    {
      id: crypto.randomUUID(),
      player_id: body.player_id,
      registered_by: formatRegisteredBy(sess),
      concept: "membership dues",
      month,
      amount,
      is_cash: true,
    },
  ]);

  if (error) return new NextResponse(error.message, { status: 500 });
  return NextResponse.json({ ok: true });
}
