// What the WhatsApp receipt for a payment says, and to whom. Pure, so the
// tests exercise it without a stack; index.ts wires it to the database and to
// Meta.

import { type LedgerMonth, monthName } from "../whatsapp-webhook/status.ts";
import { debtDetail } from "../debt-reminders/reminders.ts";
import { reminderWho } from "../_shared/reminderTemplate.ts";

export type ReceiptPayment = {
    id: string;
    concept: string;
    amount: number;
    month: string;
    slot_hour: number | null;
    session: string | null;
};

export type ReceiptPlayer = {
    id: string;
    name: string;
    phone: string | null;
    guardian_phone: string | null;
    scholarship: number;
};

export type Receipt = {
    paymentId: string;
    playerId: string;
    waId: string;
    relation: "self" | "guardian";
    /** The template's parameters, in order: whose account, the payment, the balance. */
    params: [string, string, string];
};

function formatArs(amount: number): string {
    return `$${Math.round(amount).toLocaleString("es-AR")}`;
}

/** "2026-11-12 22hs" → 12/11. */
function sessionDay(session: string): string | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(session);
    return m ? `${Number(m[3])}/${Number(m[2])}` : null;
}

function ofMonth(p: ReceiptPayment): string {
    const name = /^\d{4}-\d{2}$/.test(p.month) ? ` de ${monthName(p.month).toLowerCase()}` : "";
    const hour = p.slot_hour !== null && p.slot_hour !== undefined ? ` de las ${p.slot_hour}hs` : "";
    return `${name}${hour}`;
}

function tournamentText(name: string | null, upfront: boolean): string {
    const base = !name ? "torneo" : /^torneo\b/i.test(name) ? name : `torneo ${name}`;
    return upfront ? `${base} completo` : base;
}

/** "$35.000 (entrenamiento del 12/11)", "$100.000 (mes de noviembre de las 22hs)", … */
export function paymentText(p: ReceiptPayment, tournamentName: string | null = null): string {
    const what = (() => {
        switch (p.concept) {
            case "session": {
                const day = p.session ? sessionDay(p.session) : null;
                return day ? `entrenamiento del ${day}` : "entrenamiento";
            }
            case "monthly":
                return `mes${ofMonth(p)}`;
            case "half month":
                return `medio mes${ofMonth(p)}`;
            case "debt settlement":
                return "pago de deuda";
            case "membership dues":
                return "matrícula";
            case "tournament":
                return tournamentText(tournamentName, false);
            case "tournament upfront":
                return tournamentText(tournamentName, true);
            default:
                return null;
        }
    })();
    return what ? `${formatArs(p.amount)} (${what})` : formatArs(p.amount);
}

/** What the player still owes for training after the payment, month by
 * month as the Thursday reminder says it; "$0" when nothing. */
export function balanceText(ledger: LedgerMonth[], scholarship: number): string {
    const now = ledger.at(-1);
    if (!now || scholarship >= 100) return "$0";
    if (Math.round(now.closedDebt) <= 0 && Math.round(now.pending) <= 0) return "$0";
    const detail = debtDetail([...now.debtMonths, ...(now.monthDebt ? [now.monthDebt] : [])]);
    return detail || formatArs(now.closedDebt + now.pending);
}

/**
 * One receipt per phone linked to the player who paid: theirs and their
 * guardian's, once each. Full scholarships get it too — they still pay
 * matrícula and tournaments. Nothing for a payment of no amount.
 */
export function receiptsFor(
    player: ReceiptPlayer,
    payment: ReceiptPayment,
    ledger: LedgerMonth[],
    tournamentName: string | null = null,
): Receipt[] {
    if (!(Number(payment.amount) > 0)) return [];
    const paid = paymentText(payment, tournamentName);
    const balance = balanceText(ledger, player.scholarship);
    const out: Receipt[] = [];
    const seen = new Set<string>();
    const add = (waId: string | null, relation: Receipt["relation"]) => {
        if (!waId || seen.has(waId)) return;
        seen.add(waId);
        out.push({
            paymentId: payment.id,
            playerId: player.id,
            waId,
            relation,
            params: [reminderWho(relation, player.name), paid, balance],
        });
    };
    add(player.phone, "self");
    add(player.guardian_phone, "guardian");
    return out;
}

/** The Cloud API body for one receipt. */
export function receiptPayload(receipt: Receipt, template: { name: string; language: string }) {
    return {
        to: receipt.waId,
        type: "template",
        template: {
            name: template.name,
            language: { code: template.language },
            components: [{
                type: "body",
                parameters: receipt.params.map((text) => ({ type: "text", text })),
            }],
        },
    };
}
