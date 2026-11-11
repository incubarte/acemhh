// Tests for the Thursday debt reminders: who gets one, what it says, and on
// which days. Pure, no stack needed:
//
//     deno test -A supabase/functions/tests/debt-reminders.test.ts

import { assertEquals } from "jsr:@std/assert";
import {
    debtDetail,
    isReminderDay,
    remindersFor,
    templatePayload,
    todayBA,
} from "../debt-reminders/reminders.ts";
import type { LedgerMonth } from "../whatsapp-webhook/status.ts";

/** A month owing closedDebt from October's 1/10 and pending from its own 12/11. */
function month(m: string, closedDebt: number, pending: number): LedgerMonth {
    const sessions = (date: string, amount: number) => ({
        kind: "sessions" as const,
        sessions: [{ date, hour: 22 }],
        amount,
    });
    return {
        month: m,
        attended: 0,
        free: false,
        totalPaid: 0,
        sessionPrice: 35000,
        input: { attendances: [], payments: [], sessionsPerSlot: new Map() },
        boughtMonth: false,
        carryoverIn: 0,
        carryoverOut: 0,
        debtAfter: closedDebt + pending,
        closedDebt,
        pending,
        debtMonths: closedDebt > 0
            ? [{ month: "2026-10", amount: closedDebt, charged: closedDebt, sources: [sessions("2026-10-01", closedDebt)] }]
            : [],
        monthDebt: pending > 0
            ? { month: m, amount: pending, charged: pending, sources: [sessions(`${m}-12`, pending)] }
            : null,
    };
}

const JUAN = {
    id: "p1",
    name: "Juan",
    phone: "5491111111111",
    guardian_phone: null,
    scholarship: 0,
};

Deno.test("todayBA: el día es el de Buenos Aires, no el de UTC", () => {
    // 01:00 UTC on Thursday is still Wednesday 22hs in Buenos Aires.
    assertEquals(todayBA(new Date("2026-11-12T01:00:00Z")), "2026-11-11");
    // The cron fires at 11:00 UTC: 8am Thursday there.
    assertEquals(todayBA(new Date("2026-11-12T11:00:00Z")), "2026-11-12");
});

Deno.test("isReminderDay: jueves con entrenamiento, nada más", () => {
    const trainings = new Set(["2026-11-12", "2026-11-19", "2026-11-17"]);
    assertEquals(isReminderDay("2026-11-12", trainings), true);
    // The 5th is a Thursday off.
    assertEquals(isReminderDay("2026-11-05", trainings), false);
    // A Tuesday with training is not the reminder's day.
    assertEquals(isReminderDay("2026-11-17", trainings), false);
});

Deno.test("remindersFor: alcanza con cualquiera de las dos deudas", () => {
    assertEquals(remindersFor(JUAN, [month("2026-10", 0, 30000), month("2026-11", 30000, 0)]).length, 1);
    assertEquals(remindersFor(JUAN, [month("2026-11", 0, 35000)]).length, 1);
    assertEquals(remindersFor(JUAN, [month("2026-10", 0, 30000), month("2026-11", 30000, 35000)]).length, 1);
    assertEquals(remindersFor(JUAN, [month("2026-10", 0, 0), month("2026-11", 0, 0)]), []);
});

Deno.test("remindersFor: los montos son los del mes en curso", () => {
    const [r] = remindersFor(JUAN, [month("2026-10", 0, 30000), month("2026-11", 30000, 35000)]);
    assertEquals(r.closedDebt, 30000);
    assertEquals(r.monthDebt, 35000);
    assertEquals(r.params, [
        "tu cuenta",
        "$30.000 de octubre (entrenamiento del 1/10 sin pagar) y $35.000 de noviembre (entrenamiento del 12/11 sin pagar)",
    ]);
});

Deno.test("remindersFor: le llega al jugador y al tutor", () => {
    const withGuardian = { ...JUAN, guardian_phone: "5492222222222" };
    const out = remindersFor(withGuardian, [month("2026-11", 0, 35000)]);
    assertEquals(out.map((r) => [r.waId, r.relation, r.params[0]]), [
        ["5491111111111", "self", "tu cuenta"],
        ["5492222222222", "guardian", "la cuenta de Juan"],
    ]);
});

Deno.test("remindersFor: sin teléfono propio, sólo el tutor; el mismo teléfono dos veces, un mensaje", () => {
    const onlyGuardian = { ...JUAN, phone: null, guardian_phone: "5492222222222" };
    assertEquals(
        remindersFor(onlyGuardian, [month("2026-11", 0, 35000)]).map((r) => r.relation),
        ["guardian"],
    );
    const same = { ...JUAN, guardian_phone: JUAN.phone };
    assertEquals(remindersFor(same, [month("2026-11", 0, 35000)]).length, 1);
    const none = { ...JUAN, phone: null };
    assertEquals(remindersFor(none, [month("2026-11", 0, 35000)]), []);
});

Deno.test("remindersFor: la beca completa no recibe nada", () => {
    assertEquals(remindersFor({ ...JUAN, scholarship: 100 }, [month("2026-11", 0, 35000)]), []);
});

Deno.test("templatePayload: el template con sus dos parámetros", () => {
    const [r] = remindersFor(JUAN, [month("2026-11", 0, 35000)]);
    assertEquals(templatePayload(r, { name: "recordatorio_deuda", language: "es_AR" }), {
        messaging_product: "whatsapp",
        to: "5491111111111",
        type: "template",
        template: {
            name: "recordatorio_deuda",
            language: { code: "es_AR" },
            components: [{
                type: "body",
                parameters: [
                    { type: "text", text: "tu cuenta" },
                    { type: "text", text: "$35.000 de noviembre (entrenamiento del 12/11 sin pagar)" },
                ],
            }],
        },
    });
});

// ////////////////////////////////////
// THE DETAIL, THROUGH THE REAL LEDGER
// ////////////////////////////////////

import { buildMonthStatuses, computeLedger } from "../whatsapp-webhook/status.ts";
import { DetailLimit } from "../debt-reminders/reminders.ts";

const PRICES = [{
    valid_from: "2026-01-01",
    session_price: 30000,
    prepaid_session_price: 25000,
    goalkeeper_session_price: 20000,
    goalkeeper_invitee_session_price: 25000,
    sibling_session_discount: 5000,
}];
const PLAYER = { goalkeeper: false, invitee: false, scholarship: 0, categories: ["cat-b"] };
const at22 = (dates: string[]) => dates.map((date) => ({ date, hour: 22, categories: ["cat-b"], goalies: false }));
// Thursdays: three in September, four in October (a month of $100.000), one in November.
const AGENDA = at22([
    "2026-09-03", "2026-09-10", "2026-09-17",
    "2026-10-01", "2026-10-08", "2026-10-15", "2026-10-22",
    "2026-11-12",
]);
const went = (...dates: string[]) => dates.map((d) => ({ session: `${d} 22hs`, bonified: false }));
const paid = (month: string, concept: string, amount: number) =>
    ({ month, concept, amount, slot_weekday: 4, slot_hour: 22, session: null });

function detailFor(payments: ReturnType<typeof paid>[], attendances: ReturnType<typeof went>, agenda = AGENDA) {
    const statuses = buildMonthStatuses(payments, attendances, ["2026-09", "2026-10", "2026-11"], PRICES, agenda, PLAYER);
    const ledger = computeLedger(statuses, PRICES, PLAYER);
    const now = ledger.at(-1)!;
    return { now, detail: debtDetail([...now.debtMonths, ...(now.monthDebt ? [now.monthDebt] : [])]) };
}

Deno.test("debtDetail: cada mes con sus entrenamientos sin pagar", () => {
    const { now, detail } = detailFor([], went("2026-09-03", "2026-09-10", "2026-11-12"));
    assertEquals(
        detail,
        "$60.000 de septiembre (entrenamientos del 3/9 y 10/9 sin pagar) y $30.000 de noviembre (entrenamiento del 12/11 sin pagar)",
    );
    assertEquals([now.closedDebt, now.pending], [60000, 30000]);
});

Deno.test("debtDetail: el mes pagado en parte que no se condona muestra lo que falta", () => {
    // $40.000 of a $100.000 month, and two sessions attended: 40.000 < 2 × 30.000,
    // so closing October did not forgive the rest.
    const { now, detail } = detailFor(
        [paid("2026-10", "monthly", 40000)],
        went("2026-10-01", "2026-10-08"),
    );
    assertEquals(detail, "$60.000 de octubre (resto del mes de las 22hs: se pagaron $40.000 de $100.000)");
    assertEquals(now.closedDebt, 60000);
});

Deno.test("debtDetail: el mes pagado en parte que se condonó no aparece", () => {
    // One session attended: 40.000 ≥ 30.000, so the close forgave the rest.
    const { now, detail } = detailFor([paid("2026-10", "monthly", 40000)], went("2026-10-01"));
    assertEquals(detail, "");
    assertEquals(now.closedDebt, 0);
});

Deno.test("debtDetail: en el mes en curso, el parcial cuenta entero aunque después se condone", () => {
    const agenda = at22(["2026-11-05", "2026-11-12", "2026-11-19", "2026-11-26"]);
    const { now, detail } = detailFor([paid("2026-11", "monthly", 40000)], went("2026-11-05"), agenda);
    assertEquals(detail, "$60.000 de noviembre (resto del mes de las 22hs: se pagaron $40.000 de $100.000)");
    assertEquals(now.pending, 60000);
});

Deno.test("debtDetail: un pago de deuda salda el mes más viejo primero", () => {
    const { now, detail } = detailFor(
        [paid("2026-10", "monthly", 40000), paid("2026-11", "debt settlement", 20000)],
        went("2026-09-03", "2026-09-10", "2026-10-01", "2026-10-08", "2026-11-12"),
    );
    assertEquals(
        detail,
        "$40.000 de septiembre (saldo de: entrenamientos del 3/9 y 10/9 sin pagar), " +
            "$60.000 de octubre (resto del mes de las 22hs: se pagaron $40.000 de $100.000) y " +
            "$30.000 de noviembre (entrenamiento del 12/11 sin pagar)",
    );
    // The breakdown adds up to what the dashboard calls each half.
    assertEquals([now.closedDebt, now.pending], [100000, 30000]);
    assertEquals(now.debtMonths.reduce((sum, d) => sum + d.amount, 0), now.closedDebt);
});

Deno.test("debtDetail: dos sesiones el mismo día llevan la hora", () => {
    const agenda = [
        ...at22(["2026-09-03"]),
        { date: "2026-09-03", hour: 23, categories: ["cat-c"], goalies: false },
        ...at22(["2026-11-12"]),
    ];
    const statuses = buildMonthStatuses(
        [],
        [{ session: "2026-09-03 22hs", bonified: false }, { session: "2026-09-03 23hs", bonified: false }],
        ["2026-09", "2026-11"],
        PRICES,
        agenda,
        PLAYER,
    );
    const now = computeLedger(statuses, PRICES, PLAYER).at(-1)!;
    assertEquals(debtDetail(now.debtMonths), "$60.000 de septiembre (entrenamientos del 3/9 22hs y 3/9 23hs sin pagar)");
});

Deno.test("debtDetail: si no entra en el template, queda el monto de cada mes", () => {
    // Every day of September at four hours: far past what a real month holds.
    const many = Array.from({ length: 120 }, (_, i) => ({
        date: `2026-09-${String((i % 30) + 1).padStart(2, "0")}`,
        hour: 20 + Math.floor(i / 30),
    }));
    const months = [
        { month: "2026-09", amount: 900000, charged: 900000, sources: [{ kind: "sessions" as const, sessions: many, amount: 900000 }] },
        { month: "2026-11", amount: 30000, charged: 30000, sources: [{ kind: "sessions" as const, sessions: many.slice(0, 1), amount: 30000 }] },
    ];
    const detail = debtDetail(months);
    assertEquals(detail, "$900.000 de septiembre y $30.000 de noviembre");
    assertEquals(detail.length <= DetailLimit, true);
});
