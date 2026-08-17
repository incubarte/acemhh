import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { withPermission } from "@/lib/authMiddleware";

export type CajaUser = {
  id: string;
  name: string;
  balance: number;
};

export type PendingHandoff = {
  id: string;
  amount: number;
  from_user: string;
  to_user: string;
  from_name: string;
  to_name: string;
  created_at: string;
};

// Balances are derived, never stored:
//   caja(admin) = cash payments they registered
//               - cash expenses they paid
//               - handoffs given + handoffs received (accepted only)
// Legacy payments rows without registered_by_user_id stay out until backfilled.
export const GET = withPermission('api', '/api/caja', 'GET', async (sess) => {
  const s = supabaseAdmin();

  const [usersRes, paymentsRes, expensesRes, handoffsRes] = await Promise.all([
    s.from("users").select("id,first_name,last_name,groups"),
    s.from("payments")
      .select("registered_by_user_id,amount")
      .eq("is_cash", true)
      .not("registered_by_user_id", "is", null),
    s.from("expenses").select("paid_by,amount").eq("is_cash", true),
    s.from("cash_handoffs").select("id,amount,from_user,to_user,created_at,accepted_at"),
  ]);

  const firstError = usersRes.error ?? paymentsRes.error ?? expensesRes.error ?? handoffsRes.error;
  if (firstError) return new NextResponse(firstError.message, { status: 500 });

  const admins = (usersRes.data ?? []).filter((u) => (u.groups ?? []).length > 0);
  const nameOf = new Map(admins.map((u) => [
    u.id,
    `${u.first_name}${u.last_name ? ` ${u.last_name}` : ""}`,
  ]));

  const balances = new Map<string, number>(admins.map((u) => [u.id, 0]));
  const add = (userId: string | null, delta: number) => {
    if (!userId || !balances.has(userId)) return;
    balances.set(userId, balances.get(userId)! + delta);
  };

  for (const p of paymentsRes.data ?? []) add(p.registered_by_user_id, Number(p.amount));
  for (const e of expensesRes.data ?? []) add(e.paid_by, -Number(e.amount));

  const pendingIn: PendingHandoff[] = [];
  const pendingOut: PendingHandoff[] = [];
  for (const h of handoffsRes.data ?? []) {
    if (h.accepted_at) {
      add(h.from_user, -Number(h.amount));
      add(h.to_user, Number(h.amount));
      continue;
    }
    const pending: PendingHandoff = {
      id: h.id,
      amount: Number(h.amount),
      from_user: h.from_user,
      to_user: h.to_user,
      from_name: nameOf.get(h.from_user) ?? "?",
      to_name: nameOf.get(h.to_user) ?? "?",
      created_at: h.created_at,
    };
    if (h.to_user === sess.id) pendingIn.push(pending);
    if (h.from_user === sess.id) pendingOut.push(pending);
  }

  const users: CajaUser[] = admins
    .map((u) => ({ id: u.id, name: nameOf.get(u.id)!, balance: balances.get(u.id)! }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({ me: sess.id, users, pendingIn, pendingOut });
});
