import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { withPermission } from "@/lib/authMiddleware";
import { groupIncomeByDay } from "@/lib/cashflow";

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

type FlowKind =
  | { kind: "income"; name: string; amount: number; count: number; slot: string }
  | { kind: "expense"; name: string; amount: number; concept: string; notes: string | null; is_cash: boolean }
  | { kind: "handoff"; from_name: string; to_name: string; amount: number };

/** A movement before the running balance is known. */
type Movement = FlowKind & {
  at: string;
  /** How this movement changed the caja being viewed. */
  delta: number;
};

/** The caja right after the movement. */
export type FlowEntry = Movement & { balanceAfter: number };

const HistoryLimit = 100;

// Movements before the caja existed are folded into the opening balance: those
// payments were collected and long since spent, but the matching expenses and
// handoffs were never recorded, so listing them is noise. The running balance
// still starts from them, so every figure on screen adds up.
const HistoryFrom = "2026-08-01";

// Balances are derived, never stored:
//   caja(admin) = cash payments they registered
//               - cash expenses they paid
//               - handoffs given + handoffs received (accepted only)
export const GET = withPermission('api', '/api/caja', 'GET', async (sess, req) => {
  const s = supabaseAdmin();
  // ?user=<uuid> narrows every figure to that admin's caja; without it the
  // view is the club's, where handoffs are internal and move nothing.
  const scope = new URL(req.url).searchParams.get("user");

  const [usersRes, paymentsRes, expensesRes, handoffsRes] = await Promise.all([
    s.from("users").select("id,first_name,last_name,groups"),
    s.from("payments")
      .select("registered_by_user_id,amount,created_at,slot_weekday,slot_hour")
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
  // Movements with the delta they apply to the caja in scope. Entries that do
  // not touch it at all are left out.
  const movements: Movement[] = [];

  for (const h of handoffsRes.data ?? []) {
    if (!h.accepted_at) {
      pending.push({
        id: h.id,
        amount: Number(h.amount),
        from_user: h.from_user,
        to_user: h.to_user,
        from_name: nameOf.get(h.from_user) ?? "?",
        to_name: nameOf.get(h.to_user) ?? "?",
        created_at: h.created_at,
      });
      continue;
    }

    const amount = Number(h.amount);
    add(h.from_user, -amount);
    add(h.to_user, amount);

    // For the club as a whole a handoff is internal: it moves nothing.
    const delta = !scope ? 0 : h.from_user === scope ? -amount : h.to_user === scope ? amount : null;
    if (delta === null) continue;
    movements.push({
      kind: "handoff",
      at: h.created_at,
      delta,
      from_name: nameOf.get(h.from_user) ?? "?",
      to_name: nameOf.get(h.to_user) ?? "?",
      amount,
    });
  }

  // Income entries: one per collector per slot per collection day
  // (5am → 5am, BA).
  const incomeGroups = groupIncomeByDay((paymentsRes.data ?? []).map((p) => ({
    user_id: p.registered_by_user_id!,
    amount: Number(p.amount),
    created_at: p.created_at,
    slot_weekday: p.slot_weekday,
    slot_hour: p.slot_hour,
  })));
  for (const g of incomeGroups) {
    if (scope && g.user_id !== scope) continue;
    movements.push({
      kind: "income",
      at: g.start,
      delta: g.amount,
      name: nameOf.get(g.user_id) ?? "?",
      amount: g.amount,
      count: g.count,
      slot: g.slot,
    });
  }

  for (const e of expensesRes.data ?? []) {
    if (scope && e.paid_by !== scope) continue;
    movements.push({
      kind: "expense",
      at: e.created_at,
      // A bank-paid expense is club money leaving, but never out of a caja.
      delta: e.is_cash ? -Number(e.amount) : 0,
      name: nameOf.get(e.paid_by) ?? "?",
      amount: Number(e.amount),
      concept: e.concept,
      notes: e.notes,
      is_cash: e.is_cash,
    });
  }

  // Oldest first, so the running balance reads as a ledger.
  movements.sort((a, b) => a.at.localeCompare(b.at));

  // Everything before the cutoff — plus any overflow past the display limit —
  // becomes the opening balance, so the first listed movement starts from a
  // figure that already accounts for it.
  const shown = movements.filter((m) => m.at >= HistoryFrom);
  const foldedCount = movements.length - shown.length +
    Math.max(0, shown.length - HistoryLimit);
  const displayed = shown.slice(-HistoryLimit);
  const firstShownAt = displayed[0]?.at;
  let opening = 0;
  for (const m of movements) {
    if (firstShownAt === undefined || m.at < firstShownAt) opening += m.delta;
  }

  let running = opening;
  const history: FlowEntry[] = displayed.map((m) => {
    running += m.delta;
    return { ...m, balanceAfter: running };
  });

  const users: CajaUser[] = admins
    .map((u) => ({ id: u.id, name: nameOf.get(u.id)!, balance: balances.get(u.id)! }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({
    me: sess.id,
    scope,
    users,
    pending,
    opening,
    /** How many older movements the opening balance stands for. */
    openingCount: foldedCount,
    history,
  });
});
