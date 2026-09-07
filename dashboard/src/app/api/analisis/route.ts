import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { withPermission } from "@/lib/authMiddleware";
import { ledgerExtrasFor, type LedgerExtras } from "@/lib/rosterLedger";
import { todayBA } from "@/lib/trainingDay";
import {
  buildAnalysis,
  slotsByMonth,
  type Analysis,
  type AnalysisAttendance,
  type AnalysisPayment,
  type MonthSlot,
} from "@/lib/analysis";
import { LEDGER_FROM, periodStart, slotKey } from "@shared/tokens";
import { isoWeekday, slotLabel } from "@shared/slot";

export type AnalysisResponse = {
  /** The month on screen. */
  month: string;
  /** Buenos Aires' current month, where the screen opens and returns to. */
  current_month: string;
  /** The first month the ledger can account for. */
  available_from: string;
  analysis: Analysis | null;
};

function monthAfter(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** "Nombre Apellido (@user) [id=...]" as stored, down to the name. */
function collectorName(registeredBy: string | null, user?: { first_name: string; last_name: string | null }) {
  if (user) return `${user.first_name}${user.last_name ? ` ${user.last_name}` : ""}`;
  const raw = (registeredBy ?? "").replace(/\s*\[id=[^\]]*\]\s*$/, "").replace(/\s*\(@[^)]*\)\s*$/, "").trim();
  return raw || "sin registrar";
}

export const GET = withPermission("api", "/api/analisis", "GET", async (_sess, req) => {
  const current = todayBA().slice(0, 7);
  const requested = new URL(req.url).searchParams.get("month");
  const month = requested && /^\d{4}-\d{2}$/.test(requested) ? requested : current;
  const base: Omit<AnalysisResponse, "analysis"> = {
    month,
    current_month: current,
    available_from: LEDGER_FROM,
  };
  if (month < LEDGER_FROM) return NextResponse.json({ ...base, analysis: null });

  const s = supabaseAdmin();
  const start = periodStart(month);
  const from = start > LEDGER_FROM ? start : LEDGER_FROM;

  const [playersRes, sessionsRes, paymentsRes, attRes, usersRes] = await Promise.all([
    s.from("players").select("id,name,last_name,categories,player_type,scholarship,sibling_rank,invitee"),
    s.from("training_sessions").select("date,hour")
      .gte("date", `${month}-01`).lt("date", `${monthAfter(month)}-01`).order("date").order("hour"),
    s.from("payments")
      .select("player_id,concept,amount,slot_weekday,slot_hour,month,registered_by,registered_by_user_id")
      .gte("month", from).lte("month", month)
      .in("concept", ["monthly", "session", "half month", "debt settlement"]),
    s.from("attendances").select("player_id,session").eq("attended", true)
      .gte("session", `${from}-01`).lt("session", `${monthAfter(month)}-01`),
    s.from("users").select("id,first_name,last_name"),
  ]);
  const failed = playersRes.error ?? sessionsRes.error ?? paymentsRes.error ?? attRes.error ?? usersRes.error;
  if (failed) return new NextResponse(failed.message, { status: 500 });

  const users = new Map((usersRes.data ?? []).map((u) => [String(u.id), u]));
  const payments: AnalysisPayment[] = (paymentsRes.data ?? []).map((p) => ({
    player_id: String(p.player_id),
    concept: String(p.concept),
    amount: Number(p.amount),
    slot_weekday: p.slot_weekday === null ? null : Number(p.slot_weekday),
    slot_hour: p.slot_hour === null ? null : Number(p.slot_hour),
    month: String(p.month),
    collector: collectorName(
      p.registered_by as string | null,
      p.registered_by_user_id ? users.get(String(p.registered_by_user_id)) : undefined,
    ),
  }));
  const attendances: AnalysisAttendance[] = (attRes.data ?? []).map((a) => ({
    player_id: String(a.player_id),
    session: String(a.session),
  }));

  // The month's slots, with the first training of each: the ledger prices a
  // player's month for the slot of the session it is asked about.
  const firstSession = new Map<string, string>();
  for (const r of sessionsRes.data ?? []) {
    const date = String(r.date);
    const key = slotKey(isoWeekday(date), Number(r.hour));
    if (!firstSession.has(key)) firstSession.set(key, `${date}-${r.hour}`);
  }
  const monthSlots: MonthSlot[] = [...firstSession.keys()].map((key) => {
    const [weekday, hour] = key.split("-").map(Number);
    return { key, label: slotLabel(weekday, hour) };
  });

  // Ledger per slot for the players that belong to it this month, so each
  // month_preset is the right slot's; one more pass, at any session of the
  // month, for everybody else who was active in the period — only their
  // closed debt is read from it.
  const players = playersRes.data ?? [];
  const byId = new Map(players.map((p) => [String(p.id), p]));
  const rosterOf = (ids: Iterable<string>) =>
    [...ids].map((id) => byId.get(id)).filter((p) => p !== undefined).map((p) => ({
      id: String(p.id),
      categories: p.categories as string[],
      player_type: p.player_type as string,
      scholarship: Number(p.scholarship) || 0,
      sibling_rank: Number(p.sibling_rank) || 1,
      invitee: Boolean(p.invitee),
    }));
  const thisMonth = slotsByMonth(attendances, payments).get(month) ?? new Map<string, string>();
  const active = new Set<string>([
    ...payments.map((p) => p.player_id),
    ...attendances.map((a) => a.player_id),
  ]);

  const extras = new Map<string, LedgerExtras>();
  const bySlot = new Map<string, string[]>();
  for (const [id, slot] of thisMonth) {
    if (!bySlot.has(slot)) bySlot.set(slot, []);
    bySlot.get(slot)!.push(id);
  }
  const anySession = firstSession.values().next().value ?? `${month}-01-22`;
  for (const [slot, ids] of bySlot) {
    const session = firstSession.get(slot) ?? anySession;
    for (const [id, e] of await ledgerExtrasFor(s, rosterOf(ids), session)) extras.set(id, e);
  }
  const rest = [...active].filter((id) => !thisMonth.has(id));
  if (rest.length > 0) {
    for (const [id, e] of await ledgerExtrasFor(s, rosterOf(rest), anySession)) extras.set(id, e);
  }

  const analysis = buildAnalysis({
    month,
    payments,
    attendances,
    players: players.map((p) => ({ id: String(p.id), name: String(p.name), last_name: String(p.last_name) })),
    extras,
    monthSlots,
  });
  return NextResponse.json({ ...base, analysis } satisfies AnalysisResponse);
});
