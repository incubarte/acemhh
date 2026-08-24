// Player payment/attendance status for the WhatsApp auto-reply. Everything
// here is importable without side effects, so tests can exercise it directly;
// index.ts only wires it to the transport.

import type { SupabaseClient } from "@supabase/supabase-js";

// The activity agenda derives from training_sessions: a month is active when
// at least one training happens in it (fetchMonthTrainings keys). Holidays and
// breaks fall out naturally.
//
// Categories and goalies are features of the SLOT (weekday + hour), versioned
// by date in training_slot_features; the training_sessions_resolved view
// resolves each session against the configuration in force at its own date.

export type TrainingSlotRow = {
    date: string; // YYYY-MM-DD
    categories: string[];
    goalies: boolean;
};

export async function fetchTrainingSlots(
    supabase: SupabaseClient,
): Promise<TrainingSlotRow[]> {
    const { data, error } = await supabase
        .from("training_sessions_resolved")
        .select("date,categories,goalies");
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
            categories: r.categories as string[],
            goalies: Boolean(r.goalies),
        };
    });
}

/** Trainings per month for one slot-group: distinct dates with a slot for any
 * of the given categories (or any goalie-friendly slot, for goalkeepers).
 * Every player of a category shares the same n — the month's price follows. */
export function trainingsFor(
    slots: TrainingSlotRow[],
    categories: string[],
    goalkeeper: boolean,
): Map<string, number> {
    const byMonth = new Map<string, Set<string>>();
    for (const s of slots) {
        const matches = goalkeeper
            ? s.goalies
            : s.categories.some((c) => categories.includes(c));
        if (!matches) continue;
        const month = s.date.slice(0, 7);
        if (!byMonth.has(month)) byMonth.set(month, new Set());
        byMonth.get(month)!.add(s.date);
    }
    return new Map([...byMonth].map(([m, dates]) => [m, dates.size]));
}

/** The whole agenda's months (any category): drives the semester window. */
export function activeMonths(slots: TrainingSlotRow[]): string[] {
    return [...new Set(slots.map((s) => s.date.slice(0, 7)))].sort();
}

export type Price = {
    valid_from: string; // YYYY-MM-DD
    /** A session paid on its own. */
    session_price: number;
    /** A session bought as part of a whole month, paid upfront. */
    prepaid_session_price: number;
};

export async function fetchPrices(supabase: SupabaseClient): Promise<Price[]> {
    const { data, error } = await supabase
        .from("prices")
        .select("valid_from,session_price,prepaid_session_price")
        .order("valid_from");
    if (error) throw new Error("prices: " + error.message);
    return (data ?? []).map((p) => ({
        valid_from: String(p.valid_from),
        session_price: Number(p.session_price),
        prepaid_session_price: Number(p.prepaid_session_price),
    }));
}

/** The tariff in force at the start of a month: the newest price whose
 * valid_from is not after it, falling back to the oldest known one. */
export function priceFor(prices: Price[], month: string): Price {
    if (prices.length === 0) throw new Error("No prices configured");
    const applicable = prices.filter((p) => p.valid_from <= `${month}-01`);
    return applicable.at(-1) ?? prices[0];
}

export function currentMonthBA(now: Date = new Date()): string {
    // en-CA formats as YYYY-MM.
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Argentina/Buenos_Aires",
        year: "numeric",
        month: "2-digit",
    }).format(now);
}

/** Every active month of the current semester up to currentMonth, ascending.
 * The ledger (carryover of credit and debt) accumulates over these. */
export function semesterActiveMonths(
    currentMonth: string,
    activeMonths: string[],
): string[] {
    const [year, month] = currentMonth.split("-");
    const semesterMonths = Number(month) <= 6
        ? ["01", "02", "03", "04", "05", "06"]
        : ["07", "08", "09", "10", "11", "12"];

    return activeMonths
        .filter((m) => m <= currentMonth)
        .filter((m) => m.startsWith(`${year}-`) && semesterMonths.includes(m.slice(5)))
        .sort();
}

/** Last up-to-3 active months of the current semester, up to currentMonth —
 * the part of the ledger the reply displays. Empty during months before the
 * semester's activity starts (e.g. July). */
export function monthsWindow(
    currentMonth: string,
    activeMonths: string[],
): string[] {
    return semesterActiveMonths(currentMonth, activeMonths).slice(-3);
}

export type MonthStatus = {
    month: string; // YYYY-MM
    attended: number;
    /** A monthly-concept payment was registered this month. */
    paidMonthly: boolean;
    /** Everything paid for the month (monthly + sessions), in pesos. */
    totalPaid: number;
    /** The tariff in force that month. */
    sessionPrice: number;
    prepaidPrice: number;
    /** Trainings held that month; the month's full price is trainings x prepaidPrice. */
    trainings: number;
};

export async function fetchMonthStatuses(
    supabase: SupabaseClient,
    playerId: string,
    months: string[],
    prices: Price[],
    trainingsByMonth: Map<string, number>,
): Promise<MonthStatus[]> {
    const [payments, attendances] = await Promise.all([
        supabase.from("payments")
            .select("month,concept,amount")
            .eq("player_id", playerId)
            .in("month", months)
            .in("concept", ["monthly", "session"]),
        supabase.from("attendances")
            .select("session")
            .eq("player_id", playerId)
            .eq("attended", true)
            .gte("session", `${months[0]}-01`),
    ]);

    if (payments.error) throw new Error("payments: " + payments.error.message);
    if (attendances.error) throw new Error("attendances: " + attendances.error.message);

    return months.map((month) => {
        const monthPayments = (payments.data ?? []).filter((p) => p.month === month);
        const price = priceFor(prices, month);
        return {
            month,
            // attendances.session is "YYYY-MM-DD HHhs".
            attended: (attendances.data ?? [])
                .filter((a) => (a.session ?? "").startsWith(month)).length,
            paidMonthly: monthPayments.some((p) => p.concept === "monthly"),
            totalPaid: monthPayments.reduce((sum, p) => sum + Number(p.amount), 0),
            sessionPrice: price.session_price,
            prepaidPrice: price.prepaid_session_price,
            trainings: trainingsByMonth.get(month) ?? 0,
        };
    });
}

export type LedgerMonth = MonthStatus & {
    /** The player bought the (carryover-adjusted) month at the prepaid rate. */
    boughtMonth: boolean;
    /** What this month cost, scholarship-adjusted, in pesos. */
    charge: number;
    /** Bonified sessions available this month, from last month's excess. */
    carryoverIn: number;
    /** Bonified sessions generated for the NEXT month (club's fault only). */
    carryoverOut: number;
    /** Accumulated unpaid pesos through this month. */
    debtAfter: number;
};

/** The month admits a prepaid bundle only with at least 2 trainings. */
export const MinBundleTrainings = 2;

// The ledger rules:
// - The month's bundle costs (trainings - carryover) x prepaid rate, and only
//   exists for months with at least MinBundleTrainings trainings. A bought
//   month is use-it-or-lose-it: absences earn nothing.
// - Not bought, each attendance beyond the bonified ones costs the single
//   rate; what goes unpaid accumulates as debt (in single-rate pesos).
// - Payments cover this month first, then old debt.
// - Carryover exists only when the club fell short: money paid beyond the
//   month's worth (a holiday miscount, a cancelled training) becomes whole
//   bonified sessions for the NEXT month only — never while debt remains, and
//   never as a peso balance.
export function computeLedger(statuses: MonthStatus[], scholarship: number): LedgerMonth[] {
    const k = (100 - scholarship) / 100;
    let debt = 0;
    let carryoverIn = 0;

    return statuses.map((s) => {
        const bundleSessions = Math.max(0, s.trainings - carryoverIn);
        const prepaidUnit = Math.round(s.prepaidPrice * k);
        const bundle = bundleSessions * prepaidUnit;
        const hasBundle = s.trainings >= MinBundleTrainings && bundle > 0;
        const boughtMonth = hasBundle && (s.paidMonthly || s.totalPaid >= bundle);

        // Bonified sessions absorb attendance before anything is charged.
        const bonifiedUsed = Math.min(carryoverIn, s.attended);
        const attEff = s.attended - bonifiedUsed;
        const singles = Math.round(attEff * s.sessionPrice * k);

        // A payment at most one prepaid session short of the bundle reads as
        // an incomplete bundle purchase: the whole bundle is owed and the
        // rest becomes debt — but never worse than paying singles.
        const partialBundle = !boughtMonth && hasBundle && s.totalPaid > 0 &&
            s.totalPaid >= (bundleSessions - 1) * prepaidUnit;

        const charge = boughtMonth
            ? bundle
            : partialBundle
            ? Math.min(singles, bundle)
            : singles;

        let carryoverOut = 0;
        if (s.totalPaid >= charge) {
            let excess = s.totalPaid - charge;
            const payingDebt = Math.min(debt, excess);
            debt -= payingDebt;
            excess -= payingDebt;
            if (boughtMonth && debt === 0 && excess > 0 && prepaidUnit > 0) {
                carryoverOut = Math.floor(excess / prepaidUnit);
            }
        } else {
            debt += charge - s.totalPaid;
        }

        const row = {
            ...s,
            boughtMonth,
            charge,
            carryoverIn,
            carryoverOut,
            debtAfter: debt,
        };
        // Carryover only reaches the immediately following month.
        carryoverIn = carryoverOut;
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

        // Bonified sessions still usable this month (when the month was not
        // settled as a bundle, which already discounted them).
        const remaining = last.boughtMonth
            ? 0
            : Math.max(0, last.carryoverIn - last.attended);
        if (remaining > 0) {
            lines.push(`${w.has} ${sessionsText(remaining)} bonificada${remaining === 1 ? "" : "s"} este mes`);
        }
        if (last.carryoverOut > 0) {
            lines.push(`${w.has} ${sessionsText(last.carryoverOut)} bonificada${last.carryoverOut === 1 ? "" : "s"} para el mes que viene`);
        }
        if (last.debtAfter > 0) {
            lines.push(`Deuda pendiente: ${formatArs(last.debtAfter)}`);
        }
    }

    return lines.join("\n");
}
