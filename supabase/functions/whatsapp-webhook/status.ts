// Player payment/attendance status for the WhatsApp auto-reply. Everything
// here is importable without side effects, so tests can exercise it directly;
// index.ts only wires it to the transport.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
    billableAttendances,
    EMPTY_STATE,
    type AttendanceRow,
    type LedgerPrice,
    type LedgerState,
    ledgerMonth,
    type MonthResult,
    type MonthInput,
    type MonthPayment,
    periodMonths,
    type PlayerBilling,
    priceFor,
    ratesFor,
    type SlotDay,
    slotKey,
    trainingsFor,
} from "../_shared/tokens.ts";
import { isoWeekday } from "../_shared/slot.ts";

export { periodMonths, priceFor, trainingsFor };
export type { LedgerPrice, SlotDay };

// The activity agenda derives from training_sessions: a month is active when
// at least one training happens in it (fetchMonthTrainings keys). Holidays and
// breaks fall out naturally.
//
// Categories and goalies are features of the SLOT (weekday + hour), versioned
// by date in training_slot_features; the training_sessions_resolved view
// resolves each session against the configuration in force at its own date.

export type TrainingSlotRow = {
    date: string; // YYYY-MM-DD
    hour: number;
    categories: string[];
    goalies: boolean;
};

export async function fetchTrainingSlots(
    supabase: SupabaseClient,
): Promise<TrainingSlotRow[]> {
    const { data, error } = await supabase
        .from("training_sessions_resolved")
        .select("date,hour,categories,goalies");
    if (error) throw new Error("training_sessions_resolved: " + error.message);
    return (data ?? []).map((r) => {
        // NULL means the slot has no features in force at that date. Treating
        // it as "no categories" would silently shrink the month it falls in,
        // so it fails loudly instead.
        if (r.categories === null || r.goalies === null) {
            throw new Error(
                `Sin configuración de slot para ${r.date}: cargá la fila en training_slot_features.`,
            );
        }
        return {
            date: String(r.date),
            hour: Number(r.hour),
            categories: r.categories as string[],
            goalies: Boolean(r.goalies),
        };
    });
}


/** The whole agenda's months (any category): drives the semester window. */
export function activeMonths(slots: TrainingSlotRow[]): string[] {
    return [...new Set(slots.map((s) => s.date.slice(0, 7)))].sort();
}

/** Kept as a local alias: callers here have always said `Price`. */
export type Price = LedgerPrice;

export async function fetchPrices(supabase: SupabaseClient): Promise<Price[]> {
    const { data, error } = await supabase
        .from("prices")
        // One literal: split across a concatenation, supabase-js cannot infer
        // the row type and every field comes back as unknown.
        .select(
            "valid_from,session_price,prepaid_session_price,goalkeeper_session_price,goalkeeper_invitee_session_price,sibling_session_discount",
        )
        .order("valid_from");
    if (error) throw new Error("prices: " + error.message);
    return (data ?? []).map((p) => ({
        valid_from: String(p.valid_from),
        session_price: Number(p.session_price),
        prepaid_session_price: Number(p.prepaid_session_price),
        goalkeeper_session_price: Number(p.goalkeeper_session_price),
        goalkeeper_invitee_session_price: Number(p.goalkeeper_invitee_session_price),
        sibling_session_discount: Number(p.sibling_session_discount) || 0,
    }));
}

export function currentMonthBA(now: Date = new Date()): string {
    // en-CA formats as YYYY-MM.
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Argentina/Buenos_Aires",
        year: "numeric",
        month: "2-digit",
    }).format(now);
}

/** Every active month of the current period up to currentMonth, ascending.
 * The ledger (carryover of credit and debt) accumulates over these. */
export function periodActiveMonths(
    currentMonth: string,
    activeMonths: string[],
): string[] {
    const window = new Set(periodMonths(currentMonth));
    return activeMonths
        .filter((m) => m <= currentMonth && window.has(m))
        .sort();
}

/** Last up-to-3 active months of the current period, up to currentMonth —
 * the part of the ledger the reply displays. Empty during months before the
 * semester's activity starts (e.g. July). */
export function monthsWindow(
    currentMonth: string,
    activeMonths: string[],
): string[] {
    return periodActiveMonths(currentMonth, activeMonths).slice(-3);
}

export type MonthStatus = {
    month: string; // YYYY-MM
    /** Sessions the club charges this player for — goalkeepers outside their
     * slot and youth second sessions are already out. In a free month, every
     * session attended: there is nothing to charge, but going still counts. */
    attended: number;
    /** Nothing this month could be charged to this player: a goalkeeper in a
     * month with no goalkeepers' slot (none since October 2026). */
    free: boolean;
    /** Everything paid that month, whatever the concept. */
    totalPaid: number;
    /** What one session costs this player on its own, that month. */
    sessionPrice: number;
    /** What the ledger needs to price the month. */
    input: MonthInput;
};

/** attendances.session is "YYYY-MM-DD HHhs". */
function parseSession(session: string): { date: string; hour: number } {
    return {
        date: session.slice(0, 10),
        hour: Number(session.slice(11).replace(/\D/g, "")),
    };
}

/** A payments row, as the ledger reads it. */
export type PaymentRow = {
    month: string;
    concept: string;
    amount: number | string;
    slot_weekday: number | null;
    slot_hour: number | null;
    /** "YYYY-MM-DD HHhs" — where a half month was sold. */
    session: string | null;
};

/** An attendances row (attended = true only). */
export type AttendanceDbRow = {
    session: string;
    bonified: boolean | null;
};

export const LedgerConcepts = ["monthly", "session", "half month", "debt settlement"];

export async function fetchMonthStatuses(
    supabase: SupabaseClient,
    playerId: string,
    months: string[],
    prices: LedgerPrice[],
    slots: TrainingSlotRow[],
    player: PlayerBilling,
): Promise<MonthStatus[]> {
    const [payments, attendances] = await Promise.all([
        supabase.from("payments")
            .select("month,concept,amount,slot_weekday,slot_hour,session")
            .eq("player_id", playerId)
            .in("month", months)
            .in("concept", LedgerConcepts),
        supabase.from("attendances")
            .select("session,bonified")
            .eq("player_id", playerId)
            .eq("attended", true)
            .gte("session", `${months[0]}-01`),
    ]);

    if (payments.error) throw new Error("payments: " + payments.error.message);
    if (attendances.error) throw new Error("attendances: " + attendances.error.message);

    return buildMonthStatuses(
        payments.data ?? [],
        attendances.data ?? [],
        months,
        prices,
        slots,
        player,
    );
}

/** The agenda, indexed both ways the ledger needs it: what each session was,
 * and how many sessions each slot held each month. */
export type Agenda = {
    featuresAt: Map<string, { slot: string; categories: string[]; goalies: boolean }>;
    perMonth: Map<string, Map<string, number>>;
    /** Months with at least one goalkeepers' session. */
    goalieSessions: Map<string, number>;
};

export function indexAgenda(slots: TrainingSlotRow[]): Agenda {
    const featuresAt: Agenda["featuresAt"] = new Map();
    const perMonth: Agenda["perMonth"] = new Map();
    for (const s of slots) {
        const weekday = isoWeekday(s.date);
        const slot = slotKey(weekday, s.hour);
        featuresAt.set(`${s.date}|${s.hour}`, { slot, categories: s.categories, goalies: s.goalies });
        const month = s.date.slice(0, 7);
        if (!perMonth.has(month)) perMonth.set(month, new Map());
        const counts = perMonth.get(month)!;
        counts.set(slot, (counts.get(slot) ?? 0) + 1);
    }
    return { featuresAt, perMonth, goalieSessions: trainingsFor(slots, [], true) };
}

/**
 * One player's months, priced from rows already fetched. Pure, so the bot can
 * fetch per player and the reminders can fetch everyone at once.
 *
 * Must read the rows the way the dashboard does (rosterLedger.ts): what the
 * bot tells a player and what the admin sees on the roster are the same
 * number, or one of them is lying.
 */
export function buildMonthStatuses(
    payments: PaymentRow[],
    attendances: AttendanceDbRow[],
    months: string[],
    prices: LedgerPrice[],
    slots: TrainingSlotRow[] | Agenda,
    player: PlayerBilling,
): MonthStatus[] {
    const { featuresAt, perMonth, goalieSessions } = Array.isArray(slots)
        ? indexAgenda(slots)
        : slots;

    const attByMonth = new Map<string, AttendanceRow[]>();
    for (const a of attendances) {
        const { date, hour } = parseSession(String(a.session));
        const f = featuresAt.get(`${date}|${hour}`);
        // An attendance whose session the agenda no longer has cannot be
        // priced: there is no slot to charge it to.
        if (!f) continue;
        const month = date.slice(0, 7);
        if (!attByMonth.has(month)) attByMonth.set(month, []);
        attByMonth.get(month)!.push({
            date,
            slot: f.slot,
            categories: f.categories,
            goalies: f.goalies,
            bonified: Boolean(a.bonified),
        });
    }

    /** Sessions of a slot in their month from `date` onward, that one
     * included: what a half month sold on that date is entitled to. */
    const sessionsFrom = (date: string, slot: string) =>
        [...featuresAt.entries()].filter(([key, f]) =>
            f.slot === slot && key.slice(0, 10) >= date && key.slice(0, 7) === date.slice(0, 7)
        ).length;

    return months.map((month) => {
        const monthPayments = payments.filter((p) => p.month === month);
        const ledgerPayments = monthPayments
            .filter((p) => p.slot_weekday !== null && p.slot_hour !== null)
            .map((p): MonthPayment => {
                const slot = slotKey(Number(p.slot_weekday), Number(p.slot_hour));
                return {
                    concept: p.concept as MonthPayment["concept"],
                    amount: Number(p.amount),
                    slot,
                    ...(p.concept === "half month" && p.session
                        ? { coversSessions: sessionsFrom(String(p.session).slice(0, 10), slot) }
                        : {}),
                };
            });
        // Paying the youth slot's month is what buys the youth bonus.
        const bonusPaid = ledgerPayments.some((p) =>
            (p.concept === "monthly" || p.concept === "half month") &&
            [...featuresAt.values()].some((f) => f.slot === p.slot && f.categories.includes("youth"))
        );
        const rows = attByMonth.get(month) ?? [];
        const billable = billableAttendances(rows, player, bonusPaid);
        const free = player.goalkeeper && !goalieSessions.get(month);
        return {
            month,
            attended: free ? rows.length : billable.length,
            free,
            totalPaid: monthPayments.reduce((sum, p) => sum + Number(p.amount), 0),
            sessionPrice: ratesFor(priceFor(prices, month), player).individual,
            input: {
                attendances: billable,
                payments: ledgerPayments,
                sessionsPerSlot: perMonth.get(month) ?? new Map(),
            },
        };
    });
}

export type LedgerMonth = MonthStatus & {
    /** Nothing left pending, with a monthly payment behind it. */
    boughtMonth: boolean;
    /** Tokens the month opened with. */
    carryoverIn: number;
    /** Tokens handed to the next month. */
    carryoverOut: number;
    /** Pesos owed from closed months, through this one. */
    debtAfter: number;
    /** What earlier months still owe, net of the debt payments registered
     * this month. The dashboard's "deuda cerrada". */
    closedDebt: number;
    /** What this month is still waiting for, right now — shown as debt while
     * the month runs, even if closing may forgive part of it. The
     * dashboard's "saldo del mes". */
    pending: number;
    /** What each closed month still owes and why, oldest first, net of the
     * debt payments registered through this month. Adds up to closedDebt. */
    debtMonths: MonthDebt[];
    /** This month's pending, and why. Null when nothing is pending. */
    monthDebt: MonthDebt | null;
};

/** Where a month's debt comes from. */
export type DebtSource =
    | {
        kind: "sessions";
        /** The attendances no token covered: "YYYY-MM-DD", hour. */
        sessions: { date: string; hour: number }[];
        amount: number;
    }
    | {
        kind: "monthly";
        /** The slot's hour: every training is on Thursdays. */
        hour: number;
        /** What was paid toward the month, and what the month costs. */
        paid: number;
        full: number;
        amount: number;
    };

export type MonthDebt = {
    month: string; // YYYY-MM
    /** What is still owed. */
    amount: number;
    /** What the month owed before any debt payment reached it. */
    charged: number;
    sources: DebtSource[];
};

/** "4-22" → 22. */
function slotHour(slot: string): number {
    return Number(slot.split("-")[1]);
}

/**
 * The month's debt, by source: attendances no token covered, at the month's
 * individual rate, and monthly payments short of the month. A closed month
 * drops the shortfalls its close forgave; the running month keeps them all,
 * because pending is shown as firm debt.
 */
function sourcesOf(r: MonthResult, sessionPrice: number, closed: boolean): DebtSource[] {
    const sources: DebtSource[] = [];
    if (r.uncovered.length > 0) {
        const owed = r.uncovered.reduce((sum, u) => sum + u.owed, 0);
        sources.push({
            kind: "sessions",
            sessions: r.uncovered.map((u) => ({ date: u.date ?? "", hour: slotHour(u.slot) })),
            // Rounded once for the month, as pending is.
            amount: Math.round(owed * sessionPrice),
        });
    }
    for (const f of r.shortfalls) {
        if (closed && f.forgivable) continue;
        sources.push({ kind: "monthly", hour: slotHour(f.slot), paid: f.paid, full: f.full, amount: f.short });
    }
    return sources;
}

/**
 * Runs the shared token ledger over a player's months, keeping the per-month
 * detail the reply needs. The arithmetic lives in _shared/tokens.ts — this
 * only threads state forward and reshapes the result.
 */
export function computeLedger(
    statuses: MonthStatus[],
    prices: LedgerPrice[],
    player: PlayerBilling,
): LedgerMonth[] {
    let state: LedgerState = EMPTY_STATE;
    // Closed months' debt, oldest first. A debt payment is not tied to a
    // month: it settles the oldest debt standing when it was made, as the
    // dashboard reads it (rosterLedger.ts).
    const closed: MonthDebt[] = [];

    return statuses.map((s, i) => {
        let settled = s.input.payments
            .filter((p) => p.concept === "debt settlement")
            .reduce((sum, p) => sum + p.amount, 0);
        for (const d of closed) {
            const take = Math.min(d.amount, settled);
            d.amount -= take;
            settled -= take;
        }

        const r = ledgerMonth(
            state,
            s.input,
            priceFor(prices, s.month),
            player,
        );
        const isLast = i === statuses.length - 1;
        const monthDebt: MonthDebt | null = r.pending > 0
            ? {
                month: s.month,
                amount: r.pending,
                charged: r.pending,
                sources: sourcesOf(r, s.sessionPrice, false),
            }
            : null;
        const debtMonths = closed.filter((d) => d.amount > 0).map((d) => ({ ...d }));

        // What this month leaves owing once it closes: its pending, less what
        // the close forgives.
        if (!isLast) {
            const added = r.pending - r.shortfalls
                .filter((f) => f.forgivable)
                .reduce((sum, f) => sum + f.short, 0);
            if (added > 0) {
                closed.push({
                    month: s.month,
                    amount: added,
                    charged: added,
                    sources: sourcesOf(r, s.sessionPrice, true),
                });
            }
        }

        const row = {
            ...s,
            boughtMonth: r.pending === 0 &&
                s.input.payments.some((p) => p.concept === "monthly"),
            carryoverIn: state.carryover,
            carryoverOut: r.carryoverOut,
            debtAfter: r.next.debt,
            closedDebt: Math.max(0, state.debt - s.input.payments
                .filter((p) => p.concept === "debt settlement")
                .reduce((sum, p) => sum + p.amount, 0)),
            pending: r.pending,
            debtMonths,
            monthDebt,
        };
        state = r.next;
        return row;
    });
}

const MONTH_NAMES = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

export function monthName(month: string): string {
    return MONTH_NAMES[Number(month.slice(5)) - 1] ?? month;
}

function times(n: number): string {
    return n === 1 ? "1 vez" : `${n} veces`;
}

/** "vos" for the player reading about themselves, "el" for a guardian reading
 * about their kid. */
export type Voice = "vos" | "el";

export type LineOpts = {
    voice: Voice;
    /** scholarship === 100: attendance is the only thing worth reporting. */
    fullScholarship: boolean;
};

const WORDING: Record<Voice, {
    attended: string;
    notAttended: string;
    paid: string;
    notPaid: string;
    scholarship: string;
    has: string;
}> = {
    vos: {
        attended: "asististe",
        notAttended: "no asististe",
        paid: "pagaste",
        notPaid: "no pagaste",
        scholarship: "tenés beca",
        has: "Tenés",
    },
    el: {
        attended: "asistió",
        notAttended: "no asistió",
        paid: "pagó",
        notPaid: "no pagó",
        scholarship: "tiene beca",
        has: "Tiene",
    },
};

/** What part of the month's attendance was bonified. The ledger counts
 * fractions of a session — a payment of 4 sessions at the old rate is 3.6 at
 * the new one — so a leftover share reads as a percentage, rounded down. */
export function bonifiedText(n: number): string {
    // Token arithmetic leaves dust (0.9999999 for a whole session): it is not
    // a share of anything.
    const clean = Math.round(n * 1e6) / 1e6;
    const whole = Math.floor(clean);
    const pct = Math.floor((clean - whole) * 100);
    const wholeText = `${whole} bonificada${whole === 1 ? "" : "s"}`;
    if (pct === 0) return wholeText;
    if (whole === 0) return `una sesión bonificada al ${pct}%`;
    return `${wholeText} y otra al ${pct}%`;
}

function sessionsText(n: number): string {
    return n === 1 ? "1 sesión" : `${n} sesiones`;
}

function formatArs(amount: number): string {
    return `$${amount.toLocaleString("es-AR")}`;
}

// Each line splits into attendance / payment; the wording describes what
// happened that month, and the icon reflects the accumulated debt: a month
// can be ❌ despite a payment when older debt is still unpaid. The Deuda line
// at the end totals it.
export function formatMonthLine(l: LedgerMonth, opts: LineOpts): string {
    const name = monthName(l.month);
    const w = WORDING[opts.voice];
    const bonifiedUsed = Math.min(l.carryoverIn, l.attended);
    const bonified = bonifiedUsed > 0 ? ` (${bonifiedText(bonifiedUsed)})` : "";
    const attendance = l.attended > 0
        ? `${w.attended} ${times(l.attended)}${bonified}`
        : w.notAttended;

    if (opts.fullScholarship) {
        return l.attended > 0
            ? `- ${name}: ${attendance} y ${w.scholarship} ✅`
            : `- ${name}: ${w.notAttended} aunque ${w.scholarship}`;
    }

    const icon = l.debtAfter > 0 ? "❌" : "✅";

    // Nothing to charge this month: the attendance is all there is to say —
    // bonified or not makes no difference — and the icon still carries any
    // debt left from before.
    if (l.free && l.totalPaid === 0) {
        return l.attended > 0
            ? `- ${name}: ${w.attended} ${times(l.attended)} ${icon}`
            : `- ${name}: ${w.notAttended}`;
    }

    if (l.boughtMonth) {
        return `- ${name}: ${attendance} / ${w.paid} el mes ${icon}`;
    }

    if (l.totalPaid > 0) {
        // Session count only when the amount is an exact number of singles;
        // odd amounts (partial bundles, debt payments) show the raw figure.
        const exactSessions = l.totalPaid % l.sessionPrice === 0
            ? l.totalPaid / l.sessionPrice
            : 0;
        const payment = exactSessions >= 1
            ? `${w.paid} ${sessionsText(exactSessions)}`
            : `${w.paid} ${formatArs(l.totalPaid)}`;
        return `- ${name}: ${attendance} / ${payment} ${icon}`;
    }

    if (l.attended > 0) {
        // All attendance covered by bonified sessions: nothing to pay.
        if (l.attended <= l.carryoverIn) {
            return `- ${name}: ${attendance} ${icon}`;
        }
        return `- ${name}: ${attendance} / ${w.notPaid} ${icon}`;
    }
    return `- ${name}: ${w.notAttended}`;
}

/** One player's section of the reply: the last up-to-3 months of their ledger
 * plus the carried balance when there is one. Null when there is nothing to
 * show (no active months yet this semester). */
export function buildPlayerSection(
    ledger: LedgerMonth[],
    title: string,
    opts: LineOpts,
): string | null {
    if (ledger.length === 0) return null;

    const lines = [title, ...ledger.slice(-3).map((l) => formatMonthLine(l, opts))];

    if (!opts.fullScholarship) {
        const last = ledger.at(-1)!;
        const w = WORDING[opts.voice];

        // Bonified sessions are announced whole. A leftover fraction is real
        // and still gets applied, but "0,33 sesiones" is not something to put
        // in front of a player — under-promising beats confusing.
        const remaining = last.boughtMonth
            ? 0
            : Math.floor(Math.max(0, last.carryoverIn - last.attended));
        if (remaining >= 1) {
            lines.push(`${w.has} ${sessionsText(remaining)} bonificada${remaining === 1 ? "" : "s"} este mes`);
        }
        const coming = Math.floor(last.carryoverOut);
        if (coming >= 1) {
            lines.push(`${w.has} ${sessionsText(coming)} bonificada${coming === 1 ? "" : "s"} para el mes que viene`);
        }
        if (last.debtAfter > 0) {
            lines.push(`Deuda pendiente: ${formatArs(last.debtAfter)}`);
        }
    }

    return lines.join("\n");
}
