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

function month(m: string, closedDebt: number, pending: number): LedgerMonth {
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
    assertEquals(r.params, ["tu cuenta", "$30.000 de meses anteriores y $35.000 de noviembre"]);
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

Deno.test("debtDetail: cada mitad sola", () => {
    assertEquals(debtDetail(60000, 0, "2026-11"), "$60.000 de meses anteriores");
    assertEquals(debtDetail(0, 35000, "2026-11"), "$35.000 de noviembre");
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
                    { type: "text", text: "$35.000 de noviembre" },
                ],
            }],
        },
    });
});
