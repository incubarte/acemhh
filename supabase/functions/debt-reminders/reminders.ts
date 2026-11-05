// Who gets Thursday's debt reminder, and what it says. Pure, so the tests can
// exercise it without a stack; index.ts wires it to the database and to Meta.

import { type LedgerMonth, monthName } from "../whatsapp-webhook/status.ts";
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

/** "$60.000 de meses anteriores y $35.000 de noviembre", or either half alone. */
export function debtDetail(closedDebt: number, monthDebt: number, month: string): string {
    const parts: string[] = [];
    if (closedDebt > 0) parts.push(`${formatArs(closedDebt)} de meses anteriores`);
    if (monthDebt > 0) parts.push(`${formatArs(monthDebt)} de ${monthName(month).toLowerCase()}`);
    return parts.join(" y ");
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

    const detail = debtDetail(closedDebt, monthDebt, now.month);
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
