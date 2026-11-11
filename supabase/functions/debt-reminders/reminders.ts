// Who gets Thursday's debt reminder, and what it says. Pure, so the tests can
// exercise it without a stack; index.ts wires it to the database and to Meta.

import { type DebtSource, type LedgerMonth, type MonthDebt, monthName } from "../whatsapp-webhook/status.ts";
import { isoWeekday } from "../_shared/slot.ts";
import { reminderWho } from "../_shared/reminderTemplate.ts";

/** Training day the reminder goes out on: ISO weekday 4. */
export const ReminderWeekday = 4;

export type ReminderPlayer = {
    id: string;
    name: string;
    phone: string | null;
    guardian_phone: string | null;
    scholarship: number;
};

export type Reminder = {
    playerId: string;
    waId: string;
    relation: "self" | "guardian";
    /** What earlier months of the period still owe. */
    closedDebt: number;
    /** What the current month is still waiting for. */
    monthDebt: number;
    /** The template's parameters, in order. */
    params: [string, string];
};

/** Today in Buenos Aires, as YYYY-MM-DD. */
export function todayBA(now: Date = new Date()): string {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Argentina/Buenos_Aires",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(now);
}

export function isReminderDay(date: string, trainingDates: Set<string>): boolean {
    return isoWeekday(date) === ReminderWeekday && trainingDates.has(date);
}

function formatArs(amount: number): string {
    return `$${amount.toLocaleString("es-AR")}`;
}

/** WhatsApp takes a template variable on one line only; past this length
 * the detail drops the reasons and keeps the amount of each month. The whole
 * body may not pass 1024 characters, and the fixed text takes ~230. */
export const DetailLimit = 600;

/** YYYY-MM-DD → 3/9. */
function dayMonth(date: string): string {
    return `${Number(date.slice(8, 10))}/${Number(date.slice(5, 7))}`;
}

/** "a", "a y b", "a, b y c". */
function listOf(items: string[]): string {
    return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} y ${items.at(-1)}`;
}

function sourceText(src: DebtSource): string {
    if (src.kind === "monthly") {
        return `resto del mes de las ${src.hour}hs: se pagaron ${formatArs(src.paid)} de ${formatArs(src.full)}`;
    }
    // A day with two sessions names their hours; otherwise the date says it.
    const perDay = new Map<string, number>();
    for (const x of src.sessions) perDay.set(x.date, (perDay.get(x.date) ?? 0) + 1);
    const names = [...src.sessions]
        .sort((a, b) => a.date.localeCompare(b.date) || a.hour - b.hour)
        .map((x) => perDay.get(x.date)! > 1 ? `${dayMonth(x.date)} ${x.hour}hs` : dayMonth(x.date));
    const what = src.sessions.length === 1 ? "entrenamiento" : "entrenamientos";
    return `${what} del ${listOf(names)} sin pagar`;
}

function monthText(d: MonthDebt, withReasons: boolean): string {
    const head = `${formatArs(d.amount)} de ${monthName(d.month).toLowerCase()}`;
    if (!withReasons || d.sources.length === 0) return head;
    const reasons = d.sources.map(sourceText).join("; ");
    // Part of it was already paid off: what is left is a balance of those.
    return `${head} (${d.amount < d.charged ? `saldo de: ${reasons}` : reasons})`;
}

/**
 * The debt, month by month, oldest first, with where each month's comes from:
 * "$70.000 de septiembre (entrenamientos del 3/9 y 10/9 sin pagar) y $60.000
 * de octubre (resto del mes de las 22hs: se pagaron $40.000 de $100.000)".
 * Too long for the template, it keeps only each month's amount.
 */
export function debtDetail(months: MonthDebt[]): string {
    const full = listOf(months.map((d) => monthText(d, true)));
    return full.length <= DetailLimit ? full : listOf(months.map((d) => monthText(d, false)));
}

/**
 * One reminder per phone linked to a player who owes anything — closed months
 * of the period, the current month, or both. The player's own phone and their
 * guardian's both get it; a phone listed twice for the same player gets it
 * once. Full scholarships owe nothing by definition and are skipped outright.
 *
 * `ledger` is the player's period up to the current month; its last row is
 * the current month.
 */
export function remindersFor(player: ReminderPlayer, ledger: LedgerMonth[]): Reminder[] {
    if (player.scholarship >= 100) return [];
    const now = ledger.at(-1);
    if (!now) return [];

    const closedDebt = Math.round(now.closedDebt);
    const monthDebt = Math.round(now.pending);
    if (closedDebt <= 0 && monthDebt <= 0) return [];

    const detail = debtDetail([...now.debtMonths, ...(now.monthDebt ? [now.monthDebt] : [])]);
    const out: Reminder[] = [];
    const seen = new Set<string>();
    const add = (waId: string | null, relation: Reminder["relation"]) => {
        if (!waId || seen.has(waId)) return;
        seen.add(waId);
        out.push({
            playerId: player.id,
            waId,
            relation,
            closedDebt,
            monthDebt,
            params: [reminderWho(relation, player.name), detail],
        });
    };
    add(player.phone, "self");
    add(player.guardian_phone, "guardian");
    return out;
}

/** The Cloud API body for one reminder. */
export function templatePayload(
    reminder: Reminder,
    template: { name: string; language: string },
) {
    return {
        messaging_product: "whatsapp",
        to: reminder.waId,
        type: "template",
        template: {
            name: template.name,
            language: { code: template.language },
            components: [{
                type: "body",
                parameters: reminder.params.map((text) => ({ type: "text", text })),
            }],
        },
    };
}
