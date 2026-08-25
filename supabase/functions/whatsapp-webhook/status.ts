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
    type MonthInput,
    type MonthPayment,
    periodMonths,
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
        .select("valid_from,session_price,prepaid_session_price,goalkeeper_session_price")
        .order("valid_from");
    if (error) throw new Error("prices: " + error.message);
    return (data ?? []).map((p) => ({
        valid_from: String(p.valid_from),
        session_price: Number(p.session_price),
        prepaid_session_price: Number(p.prepaid_session_price),
        goalkeeper_session_price: Number(p.goalkeeper_session_price),
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
     * slot and youth second sessions are already out. */
    attended: number;
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

export async function fetchMonthStatuses(
    supabase: SupabaseClient,
    playerId: string,
    months: string[],
    prices: LedgerPrice[],
    slots: TrainingSlotRow[],
    player: { goalkeeper: boolean; categories: string[]; scholarship: number },
): Promise<MonthStatus[]> {
    const [payments, attendances] = await Promise.all([
        supabase.from("payments")
            .select("month,concept,amount,slot_weekday,slot_hour")
            .eq("player_id", playerId)
            .in("month", months)
            .in("concept", ["monthly", "session", "debt settlement"]),
        supabase.from("attendances")
            .select("session,bonified")
            .eq("player_id", playerId)
            .eq("attended", true)
            .gte("session", `${months[0]}-01`),
    ]);

    if (payments.error) throw new Error("payments: " + payments.error.message);
    if (attendances.error) throw new Error("attendances: " + attendances.error.message);

    // The agenda, indexed both ways the ledger needs it.
    const featuresAt = new Map<string, { slot: string; categories: string[]; goalies: boolean }>();
    const perMonth = new Map<string, Map<string, number>>();
    for (const s of slots) {
        const weekday = isoWeekday(s.date);
        const slot = slotKey(weekday, s.hour);
        featuresAt.set(`${s.date}|${s.hour}`, { slot, categories: s.categories, goalies: s.goalies });
        const month = s.date.slice(0, 7);
        if (!perMonth.has(month)) perMonth.set(month, new Map());
        const counts = perMonth.get(month)!;
        counts.set(slot, (counts.get(slot) ?? 0) + 1);
    }

    const attByMonth = new Map<string, AttendanceRow[]>();
    for (const a of attendances.data ?? []) {
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

    return months.map((month) => {
        const monthPayments = (payments.data ?? []).filter((p) => p.month === month);
        const rows = attByMonth.get(month) ?? [];
        return {
            month,
            attended: billableAttendances(rows, player).length,
            totalPaid: monthPayments.reduce((sum, p) => sum + Number(p.amount), 0),
            sessionPrice: ratesFor(priceFor(prices, month), player.goalkeeper, player.scholarship)
                .individual,
            input: {
                attendances: billableAttendances(rows, player),
                payments: monthPayments
                    .filter((p) => p.slot_weekday !== null && p.slot_hour !== null)
                    .map((p): MonthPayment => ({
                        concept: p.concept as MonthPayment["concept"],
                        amount: Number(p.amount),
                        slot: slotKey(Number(p.slot_weekday), Number(p.slot_hour)),
                    })),
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
};

/**
 * Runs the shared token ledger over a player's months, keeping the per-month
 * detail the reply needs. The arithmetic lives in _shared/tokens.ts — this
 * only threads state forward and reshapes the result.
 */
export function computeLedger(
    statuses: MonthStatus[],
    prices: LedgerPrice[],
    player: { goalkeeper: boolean; scholarship: number },
): LedgerMonth[] {
    let state: LedgerState = EMPTY_STATE;

    return statuses.map((s) => {
        const r = ledgerMonth(
            state,
            s.input,
            priceFor(prices, s.month),
            player.goalkeeper,
            player.scholarship,
        );
        const row = {
            ...s,
            boughtMonth: r.pending === 0 &&
                s.input.payments.some((p) => p.concept === "monthly"),
            carryoverIn: state.carryover,
            carryoverOut: r.carryoverOut,
            debtAfter: r.next.debt,
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
    const bonified = bonifiedUsed > 0
        ? ` (${bonifiedUsed} bonificada${bonifiedUsed === 1 ? "" : "s"})`
        : "";
    const attendance = l.attended > 0
        ? `${w.attended} ${times(l.attended)}${bonified}`
        : w.notAttended;

    if (opts.fullScholarship) {
        return l.attended > 0
            ? `- ${name}: ${attendance} y ${w.scholarship} ✅`
            : `- ${name}: ${w.notAttended} aunque ${w.scholarship}`;
    }

    const icon = l.debtAfter > 0 ? "❌" : "✅";

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
