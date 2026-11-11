// Tests for the WhatsApp receipt of a payment: what it says, and to whom.
// Pure, no stack needed:
//
//     deno test -A supabase/functions/tests/payment-receipts.test.ts

import { assertEquals } from "jsr:@std/assert";
import { balanceText, paymentText, receiptPayload, receiptsFor } from "../payment-receipts/receipts.ts";
import { buildMonthStatuses, computeLedger } from "../whatsapp-webhook/status.ts";
import { renderReceipt } from "../_shared/receiptTemplate.ts";
import { receiptPost } from "../whatsapp-webhook/inbox.ts";

const pay = (concept: string, amount: number, extra: Partial<{ month: string; slot_hour: number | null; session: string | null }> = {}) => ({
    id: "pay1",
    concept,
    amount,
    month: "2026-11",
    slot_hour: 22,
    session: null,
    ...extra,
});

const JUAN = { id: "p1", name: "Juan", phone: "5491111111111", guardian_phone: null, scholarship: 0 };

Deno.test("paymentText: cada concepto con lo que pagó", () => {
    assertEquals(paymentText(pay("session", 35000, { session: "2026-11-12 22hs" })), "$35.000 (entrenamiento del 12/11)");
    assertEquals(paymentText(pay("monthly", 100000)), "$100.000 (mes de noviembre de las 22hs)");
    assertEquals(paymentText(pay("monthly", 100000, { slot_hour: null })), "$100.000 (mes de noviembre)");
    assertEquals(paymentText(pay("half month", 50000, { session: "2026-11-12 22hs" })), "$50.000 (medio mes de noviembre de las 22hs)");
    assertEquals(paymentText(pay("debt settlement", 30000)), "$30.000 (pago de deuda)");
    assertEquals(paymentText(pay("membership dues", 20000, { slot_hour: null })), "$20.000 (matrícula)");
    assertEquals(paymentText(pay("tournament", 40000, { slot_hour: null }), "Clausura 2026"), "$40.000 (torneo Clausura 2026)");
    assertEquals(paymentText(pay("tournament upfront", 90000, { slot_hour: null }), "Torneo Clausura"), "$90.000 (Torneo Clausura completo)");
    assertEquals(paymentText(pay("algo nuevo", 1000)), "$1.000");
});

// ////////////////////////////////////
// THE BALANCE, THROUGH THE REAL LEDGER
// ////////////////////////////////////

const PRICES = [{
    valid_from: "2026-01-01",
    session_price: 30000,
    prepaid_session_price: 25000,
    goalkeeper_session_price: 20000,
    goalkeeper_invitee_session_price: 25000,
    sibling_session_discount: 5000,
}];
const PLAYER = { goalkeeper: false, invitee: false, scholarship: 0, categories: ["cat-b"] };
const AGENDA = ["2026-10-01", "2026-10-08", "2026-11-12"].map((date) => ({ date, hour: 22, categories: ["cat-b"], goalies: false }));
const went = (...dates: string[]) => dates.map((d) => ({ session: `${d} 22hs`, bonified: false }));
const paid = (month: string, concept: string, amount: number, session: string | null = null) =>
    ({ month, concept, amount, slot_weekday: 4, slot_hour: 22, session });

function ledgerFor(payments: ReturnType<typeof paid>[], attendances: ReturnType<typeof went>) {
    const statuses = buildMonthStatuses(payments, attendances, ["2026-10", "2026-11"], PRICES, AGENDA, PLAYER);
    return computeLedger(statuses, PRICES, PLAYER);
}

Deno.test("balanceText: al día, $0", () => {
    const ledger = ledgerFor([paid("2026-11", "session", 30000, "2026-11-12 22hs")], went("2026-11-12"));
    assertEquals(balanceText(ledger, 0), "$0");
    assertEquals(balanceText([], 0), "$0");
});

Deno.test("balanceText: lo que queda, mes por mes como el recordatorio", () => {
    const ledger = ledgerFor([paid("2026-11", "session", 30000, "2026-11-12 22hs")], went("2026-10-01", "2026-11-12"));
    assertEquals(balanceText(ledger, 0), "$30.000 de octubre (entrenamiento del 1/10 sin pagar)");
    // A full scholarship owes no training, whatever the ledger says.
    assertEquals(balanceText(ledger, 100), "$0");
});

Deno.test("receiptsFor: al jugador y al tutor, una vez cada teléfono", () => {
    const ledger = ledgerFor([], []);
    const payment = pay("session", 30000, { session: "2026-11-12 22hs" });
    const out = receiptsFor({ ...JUAN, guardian_phone: "5492222222222" }, payment, ledger);
    assertEquals(out.map((r) => [r.waId, r.relation, r.params]), [
        ["5491111111111", "self", ["tu cuenta", "$30.000 (entrenamiento del 12/11)", "$0"]],
        ["5492222222222", "guardian", ["la cuenta de Juan", "$30.000 (entrenamiento del 12/11)", "$0"]],
    ]);
    assertEquals(receiptsFor({ ...JUAN, guardian_phone: JUAN.phone }, payment, ledger).length, 1);
    assertEquals(receiptsFor({ ...JUAN, phone: null }, payment, ledger), []);
    assertEquals(receiptsFor(JUAN, { ...payment, amount: 0 }, ledger), []);
    // Full scholarships still pay matrícula and tournaments.
    assertEquals(receiptsFor({ ...JUAN, scholarship: 100 }, pay("membership dues", 20000), ledger).length, 1);
});

Deno.test("receiptPayload y renderReceipt: el template con sus tres parámetros", () => {
    const [r] = receiptsFor(JUAN, pay("debt settlement", 30000), ledgerFor([], []));
    assertEquals(receiptPayload(r, { name: "pago_registrado", language: "es_AR" }), {
        to: "5491111111111",
        type: "template",
        template: {
            name: "pago_registrado",
            language: { code: "es_AR" },
            components: [{
                type: "body",
                parameters: [
                    { type: "text", text: "tu cuenta" },
                    { type: "text", text: "$30.000 (pago de deuda)" },
                    { type: "text", text: "$0" },
                ],
            }],
        },
    });
    assertEquals(
        receiptPost("2026-11-12", renderReceipt(r.params)),
        "📤 Aviso de pago que le mandó el club el 12/11:\n\n" +
            "Pago registrado\n" +
            "Hola! Te escribimos del club para avisarte que registramos en tu cuenta un pago de $30.000 (pago de deuda). " +
            "Saldo pendiente de entrenamientos: $0. Si algo no coincide, respondé este mensaje y lo revisamos.",
    );
});
