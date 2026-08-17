// Player payment/attendance status for the WhatsApp auto-reply. Everything
// here is importable without side effects, so tests can exercise it directly;
// index.ts only wires it to the transport.

import type { SupabaseClient } from "@supabase/supabase-js";

// The activity agenda: months where the club runs trainings and charges for
// them. Extend this list each semester. Months missing here (e.g. July, the
// winter break) never show up in the status message.
export const ACTIVE_MONTHS = [
    "2026-08",
    "2026-09",
    "2026-10",
    "2026-11",
    "2026-12",
];

export function currentMonthBA(now: Date = new Date()): string {
    // en-CA formats as YYYY-MM.
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Argentina/Buenos_Aires",
        year: "numeric",
        month: "2-digit",
    }).format(now);
}

/** Last up-to-3 active months of the current semester, up to currentMonth.
 * Empty during months before the semester's activity starts (e.g. July). */
export function monthsWindow(
    currentMonth: string,
    activeMonths: string[] = ACTIVE_MONTHS,
): string[] {
    const [year, month] = currentMonth.split("-");
    const semesterMonths = Number(month) <= 6
        ? ["01", "02", "03", "04", "05", "06"]
        : ["07", "08", "09", "10", "11", "12"];

    return activeMonths
        .filter((m) => m <= currentMonth)
        .filter((m) => m.startsWith(`${year}-`) && semesterMonths.includes(m.slice(5)))
        .sort()
        .slice(-3);
}

export type MonthStatus = {
    month: string; // YYYY-MM
    attended: number;
    paidMonthly: boolean;
    /** Everything paid for the month (monthly + sessions), in pesos. */
    totalPaid: number;
};

export async function fetchMonthStatuses(
    supabase: SupabaseClient,
    playerId: string,
    months: string[],
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
        return {
            month,
            // attendances.session is "YYYY-MM-DD HHhs".
            attended: (attendances.data ?? [])
                .filter((a) => (a.session ?? "").startsWith(month)).length,
            paidMonthly: monthPayments.some((p) => p.concept === "monthly"),
            totalPaid: monthPayments.reduce((sum, p) => sum + Number(p.amount), 0),
        };
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

/** What one paid session costs; a partial payment covers floor(total/price)
 * attendances. Keep in sync with what the club actually charges. */
export const SESSION_PRICE = 30000;

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
}> = {
    vos: {
        attended: "asististe",
        notAttended: "no asististe",
        paid: "pagaste",
        notPaid: "no pagaste",
        scholarship: "tenés beca",
    },
    el: {
        attended: "asistió",
        notAttended: "no asistió",
        paid: "pagó",
        notPaid: "no pagó",
        scholarship: "tiene beca",
    },
};

// Each line splits into attendance / payment, and the icon says whether the
// money covers the attendance: a monthly payment always does; a partial one
// covers floor(totalPaid / SESSION_PRICE) sessions; no payment with at least
// one attendance is a cross.
export function formatMonthLine(s: MonthStatus, opts: LineOpts): string {
    const name = monthName(s.month);
    const w = WORDING[opts.voice];
    const attendance = s.attended > 0 ? `${w.attended} ${times(s.attended)}` : w.notAttended;

    if (opts.fullScholarship) {
        return s.attended > 0
            ? `- ${name}: ${attendance} y ${w.scholarship} ✅`
            : `- ${name}: ${w.notAttended} aunque ${w.scholarship}`;
    }

    if (s.paidMonthly) {
        return `- ${name}: ${attendance} / ${w.paid} el mes ✅`;
    }

    if (s.totalPaid > 0) {
        const covered = Math.floor(s.totalPaid / SESSION_PRICE);
        const payment = covered >= 1
            ? `${w.paid} ${covered === 1 ? "1 sesión" : `${covered} sesiones`}`
            : `${w.paid} $${s.totalPaid.toLocaleString("es-AR")}`;
        return `- ${name}: ${attendance} / ${payment} ${s.attended <= covered ? "✅" : "❌"}`;
    }

    if (s.attended > 0) {
        return `- ${name}: ${attendance} / ${w.notPaid} ❌`;
    }
    return `- ${name}: ${w.notAttended}`;
}

/** One player's section of the reply, or null when there is nothing to show
 * (no active months yet this semester). */
export function buildPlayerSection(
    statuses: MonthStatus[],
    title: string,
    opts: LineOpts,
): string | null {
    if (statuses.length === 0) return null;
    return [title, ...statuses.map((s) => formatMonthLine(s, opts))].join("\n");
}
