import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { withPermission } from "@/lib/authMiddleware";
import { groupIncomeWindows } from "@/lib/cashflow";

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

export type FlowEntry =
  | { kind: "income"; at: string; name: string; amount: number; count: number }
  | { kind: "expense"; at: string; name: string; amount: number; concept: string; notes: string | null; is_cash: boolean }
  | { kind: "handoff"; at: string; from_name: string; to_name: string; amount: number };

const HistoryLimit = 100;

// Movements before the caja existed are noise: those payments were collected
// and long since spent, but the matching expenses and handoffs were never
// recorded. The list starts where the record is meaningful; BALANCES still
// count everything, and an opening-adjustment expense reconciles them.
const HistoryFrom = "2026-08-01";

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
      .select("registered_by_user_id,amount,created_at")
      .eq("is_cash", true)
      .not("registered_by_user_id", "is", null),
    s.from("expenses").select("paid_by,amount,concept,notes,is_cash,created_at"),
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
  for (const e of expensesRes.data ?? []) {
    if (e.is_cash) add(e.paid_by, -Number(e.amount));
  }

  const pending: PendingHandoff[] = [];
  const history: FlowEntry[] = [];

  for (const h of handoffsRes.data ?? []) {
    if (h.accepted_at) {
      add(h.from_user, -Number(h.amount));
      add(h.to_user, Number(h.amount));
      if (h.created_at >= HistoryFrom) {
        history.push({
          kind: "handoff",
          at: h.created_at,
          from_name: nameOf.get(h.from_user) ?? "?",
          to_name: nameOf.get(h.to_user) ?? "?",
          amount: Number(h.amount),
        });
      }
      continue;
    }
    pending.push({
      id: h.id,
      amount: Number(h.amount),
      from_user: h.from_user,
      to_user: h.to_user,
      from_name: nameOf.get(h.from_user) ?? "?",
      to_name: nameOf.get(h.to_user) ?? "?",
      created_at: h.created_at,
    });
  }

  // Income entries: one per collector per 5-hour collection window.
  const incomeWindows = groupIncomeWindows(
    (paymentsRes.data ?? [])
      .filter((p) => p.created_at >= HistoryFrom)
      .map((p) => ({
        user_id: p.registered_by_user_id!,
        amount: Number(p.amount),
        created_at: p.created_at,
      })),
  );
  for (const w of incomeWindows) {
    history.push({
      kind: "income",
      at: w.start,
      name: nameOf.get(w.user_id) ?? "?",
      amount: w.amount,
      count: w.count,
    });
  }

  for (const e of (expensesRes.data ?? []).filter((e) => e.created_at >= HistoryFrom)) {
    history.push({
      kind: "expense",
      at: e.created_at,
      name: nameOf.get(e.paid_by) ?? "?",
      amount: Number(e.amount),
      concept: e.concept,
      notes: e.notes,
      is_cash: e.is_cash,
    });
  }

  history.sort((a, b) => b.at.localeCompare(a.at));

  const users: CajaUser[] = admins
    .map((u) => ({ id: u.id, name: nameOf.get(u.id)!, balance: balances.get(u.id)! }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({
    me: sess.id,
    users,
    pending,
    history: history.slice(0, HistoryLimit),
  });
});
