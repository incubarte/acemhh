import { assertEquals } from "jsr:@std/assert";
import {
    EMPTY_STATE,
    ledgerMonth,
    type LedgerState,
    type MonthInput,
    ratesFor,
    slotKey,
    type Rates,
} from "../_shared/tokens.ts";

// The token model, rule by rule. See docs/modelo-de-cobros.md.

const PRICE: Rates = {
    session_price: 30000,
    prepaid_session_price: 25000,
    goalkeeper_session_price: 25000,
};

const S22 = slotKey(4, 22);
const S23 = slotKey(4, 23);

/** A month where `held` sessions of S22 took place (plus S23 if given). */
function month(
    opts: {
        held?: number;
        heldS23?: number;
        attended?: number;
        attendedS23?: number;
        monthly?: number;
        monthlyS23?: number;
        session?: number;
        settle?: number;
    },
): MonthInput {
    const sessionsPerSlot = new Map<string, number>();
    sessionsPerSlot.set(S22, opts.held ?? 4);
    if (opts.heldS23 !== undefined) sessionsPerSlot.set(S23, opts.heldS23);

    const attendances = [
        ...Array.from({ length: opts.attended ?? 0 }, () => ({ slot: S22 })),
        ...Array.from({ length: opts.attendedS23 ?? 0 }, () => ({ slot: S23 })),
    ];

    const payments: MonthInput["payments"] = [];
    if (opts.monthly) payments.push({ concept: "monthly", amount: opts.monthly, slot: S22 });
    if (opts.monthlyS23) payments.push({ concept: "monthly", amount: opts.monthlyS23, slot: S23 });
    if (opts.session) payments.push({ concept: "session", amount: opts.session, slot: S22 });
    if (opts.settle) payments.push({ concept: "debt settlement", amount: opts.settle, slot: S22 });

    return { attendances, payments, sessionsPerSlot };
}

function run(state: LedgerState, input: MonthInput, goalkeeper = false, scholarship = 0) {
    return ledgerMonth(state, input, PRICE, goalkeeper, scholarship);
}

// ////////////////////////////////////
// TARIFAS
// ////////////////////////////////////

Deno.test("el arquero paga la misma tarifa suelta que por mes", () => {
    assertEquals(ratesFor(PRICE, true, 0), { individual: 25000, promo: 25000 });
    assertEquals(ratesFor(PRICE, false, 0), { individual: 30000, promo: 25000 });
});

Deno.test("la beca descuenta las dos tarifas", () => {
    assertEquals(ratesFor(PRICE, false, 50), { individual: 15000, promo: 12500 });
    assertEquals(ratesFor(PRICE, true, 100), { individual: 0, promo: 0 });
});

// ////////////////////////////////////
// COMPRAR Y GASTAR TOKENS
// ////////////////////////////////////

Deno.test("el mes pago cubre las sesiones del slot", () => {
    const r = run(EMPTY_STATE, month({ held: 4, attended: 4, monthly: 100000 }));
    assertEquals(r.pending, 0);
    assertEquals(r.next.debt, 0);
    assertEquals(r.carryoverOut, 0);
});

Deno.test("el mes pago es use-it-or-lose-it: faltar no devuelve nada", () => {
    // Compró 4, hubo 4, fue a 2. Los 2 que no usó se pierden.
    const r = run(EMPTY_STATE, month({ held: 4, attended: 2, monthly: 100000 }));
    assertEquals(r.pending, 0);
    assertEquals(r.carryoverOut, 0);
});

Deno.test("asistir sin token debe a tarifa individual, no a la promocional", () => {
    // Fue a 3 sin pagar nada: 3 x 30k, no 3 x 25k. El descuento se gana
    // pagando antes, no entrenando mucho.
    const r = run(EMPTY_STATE, month({ held: 4, attended: 3 }));
    assertEquals(r.pending, 90000);
    assertEquals(r.next.debt, 90000);
});

Deno.test("los pagos sueltos compran tokens que sirven en cualquier slot", () => {
    // 60k a tarifa individual son 2 tokens, y los gasta en el slot de las 23.
    const r = run(EMPTY_STATE, month({ held: 4, heldS23: 4, attendedS23: 2, session: 60000 }));
    assertEquals(r.pending, 0);
    assertEquals(r.carryoverOut, 0);
});

Deno.test("el token del mes está atado a su slot", () => {
    // Compró el mes de las 22 y fue a las 23: ese token no lo cubre.
    const r = run(EMPTY_STATE, month({ held: 4, heldS23: 4, attendedS23: 1, monthly: 100000 }));
    assertEquals(r.pending, 30000);
});

Deno.test("un pago fraccionario cubre su parte y debe el resto", () => {
    // 15k a 30k la sesión es medio token: la sesión queda a medio pagar.
    const r = run(EMPTY_STATE, month({ held: 4, attended: 1, session: 15000 }));
    assertEquals(r.pending, 15000);
});

// ////////////////////////////////////
// ORDEN DE CONSUMO
// ////////////////////////////////////

Deno.test("se quema primero el saldo de apertura, que es lo que antes muere", () => {
    // Entra con 2 heredados, compra el mes de 4, y asiste 2 veces. Lo heredado
    // se gasta y los promocionales quedan intactos.
    const r = run({ debt: 0, carryover: 2 }, month({ held: 4, attended: 2, monthly: 100000 }));
    assertEquals(r.pending, 0);
    // Los promocionales sobrantes no vuelven: el club dio las 4 sesiones.
    assertEquals(r.carryoverOut, 0);
});

Deno.test("después del saldo de apertura va lo promocional, y lo individual queda para el final", () => {
    // Sin herencia: 1 asistencia al slot del mes gasta un promocional y deja
    // intacto el individual, que es el que sí puede pasar al mes siguiente.
    const r = run(EMPTY_STATE, month({ held: 4, attended: 1, monthly: 100000, session: 30000 }));
    assertEquals(r.pending, 0);
    assertEquals(r.carryoverOut, 1);
});

// ////////////////////////////////////
// CARRYOVER
// ////////////////////////////////////

Deno.test("lo promocional vuelve sólo en la medida en que el club no dio la sesión", () => {
    // Le cobraron 4 sesiones y el mes tuvo 3: esa que no se dio vuelve.
    const r = run(EMPTY_STATE, month({ held: 3, attended: 3, monthly: 100000 }));
    assertEquals(r.pending, 0);
    assertEquals(r.carryoverOut, 1);
});

Deno.test("lo individual sin usar vuelve siempre", () => {
    // Compró 3 sueltas y usó 1: las otras 2 pasan, sin preguntar por qué.
    const r = run(EMPTY_STATE, month({ held: 4, attended: 1, session: 90000 }));
    assertEquals(r.carryoverOut, 2);
});

Deno.test("el saldo heredado que no se usa muere: no hay segundo salto", () => {
    const r = run({ debt: 0, carryover: 3 }, month({ held: 4, attended: 1 }));
    assertEquals(r.carryoverOut, 0);
});

Deno.test("el ejemplo combinado del documento da 2 tokens de carryover", () => {
    // Mensual de 100k para las 22 donde sólo hubo 3 entrenamientos, más 30k y
    // 60k sueltos para las 23. Asistió a las 3 de las 22 y a 2 de las 23.
    const input: MonthInput = {
        attendances: [
            { slot: S22 }, { slot: S22 }, { slot: S22 },
            { slot: S23 }, { slot: S23 },
        ],
        payments: [
            { concept: "monthly", amount: 100000, slot: S22 },
            { concept: "session", amount: 30000, slot: S23 },
            { concept: "session", amount: 60000, slot: S23 },
        ],
        sessionsPerSlot: new Map([[S22, 3], [S23, 4]]),
    };
    const r = run(EMPTY_STATE, input);
    assertEquals(r.pending, 0);
    assertEquals(r.carryoverOut, 2);
});

// ////////////////////////////////////
// PARCIAL MENSUAL Y CONDONACIÓN
// ////////////////////////////////////

Deno.test("el parcial mensual es un anticipo: otorga el mes entero y debe el resto", () => {
    // 40k de un mes de 100k. Recibe los 4 tokens, no 1,6.
    const r = run(EMPTY_STATE, month({ held: 4, attended: 4, monthly: 40000 }));
    assertEquals(r.pending, 60000);
    // Las 4 asistencias NO deben además a tarifa individual.
    assertEquals(r.pending, 60000);
});

Deno.test("condona si lo pagado cubre lo asistido a tarifa individual", () => {
    // 90k, asistió 3: 3 x 30k = 90k. Se condonan los 10k.
    const r = run(EMPTY_STATE, month({ held: 4, attended: 3, monthly: 90000 }));
    assertEquals(r.pending, 10000);
    assertEquals(r.next.debt, 0);
});

Deno.test("un peso menos y no condona nada", () => {
    // 89k contra 3 x 30k = 90k: queda debiendo el mes entero menos lo pagado.
    const r = run(EMPTY_STATE, month({ held: 4, attended: 3, monthly: 89000 }));
    assertEquals(r.next.debt, 11000);
});

Deno.test("40k y una sola asistencia: condonado", () => {
    const r = run(EMPTY_STATE, month({ held: 4, attended: 1, monthly: 40000 }));
    assertEquals(r.pending, 60000);
    assertEquals(r.next.debt, 0);
});

Deno.test("40k y dos asistencias: debe el mes entero menos el parcial", () => {
    // 40k < 2 x 30k. El escalón es a propósito: usar el mes compromete.
    const r = run(EMPTY_STATE, month({ held: 4, attended: 2, monthly: 40000 }));
    assertEquals(r.next.debt, 60000);
});

// ////////////////////////////////////
// DEUDA
// ////////////////////////////////////

Deno.test("el pago de deuda salda meses cerrados y no compra sesiones", () => {
    const r = run({ debt: 60000, carryover: 0 }, month({ held: 4, attended: 0, settle: 60000 }));
    assertEquals(r.next.debt, 0);
    assertEquals(r.granted, 0);
});

Deno.test("un pago de deuda parcial deja el resto", () => {
    const r = run({ debt: 60000, carryover: 0 }, month({ held: 4, settle: 25000 }));
    assertEquals(r.next.debt, 35000);
});

Deno.test("saldar deuda no cubre las asistencias del mes", () => {
    // Salda los 60k viejos y además fue una vez sin pagarla: debe esa sesión.
    const r = run({ debt: 60000, carryover: 0 }, month({ held: 4, attended: 1, settle: 60000 }));
    assertEquals(r.pending, 30000);
    assertEquals(r.next.debt, 30000);
});

Deno.test("la deuda de meses cerrados se acumula", () => {
    const first = run(EMPTY_STATE, month({ held: 4, attended: 2 }));
    assertEquals(first.next.debt, 60000);
    const second = run(first.next, month({ held: 4, attended: 1 }));
    assertEquals(second.next.debt, 90000);
});

// ////////////////////////////////////
// ARQUEROS
// ////////////////////////////////////

Deno.test("el mes de un arquero es su tarifa por las sesiones de su slot", () => {
    // 4 sesiones a 25k: sin descuento, porque no hay descuento que dar.
    const r = run(EMPTY_STATE, month({ held: 4, attended: 4, monthly: 100000 }), true);
    assertEquals(r.pending, 0);
});

Deno.test("al arquero una asistencia sin token le cuesta 25k, no 30k", () => {
    const r = run(EMPTY_STATE, month({ held: 4, attended: 1 }), true);
    assertEquals(r.pending, 25000);
});

// ////////////////////////////////////
// QUÉ ASISTENCIAS SE COBRAN
// ////////////////////////////////////

import { billableAttendances, type AttendanceRow } from "../_shared/tokens.ts";

const DAY = "2026-08-20";
function att(hour: number, categories: string[], goalies = false, bonified = false): AttendanceRow {
    return { date: DAY, slot: slotKey(4, hour), categories, goalies, bonified };
}
const A21 = att(21, ["youth"], true);
const A22 = att(22, ["cat-a", "cat-b"]);
const A23 = att(23, ["cat-c"]);

Deno.test("al arquero sólo se le cobra el slot de arqueros", () => {
    const billable = billableAttendances([A21, A22, A23], {
        goalkeeper: true,
        categories: ["youth"],
    });
    assertEquals(billable, [{ slot: slotKey(4, 21) }]);
});

Deno.test("el youth tiene una sesión adicional bonificada el mismo día", () => {
    // Va a las 21 (la suya), 22 y 23: una de las otras dos es gratis.
    const billable = billableAttendances([A21, A22, A23], {
        goalkeeper: false,
        categories: ["youth"],
    });
    assertEquals(billable.length, 2);
    assertEquals(billable.some((b) => b.slot === slotKey(4, 21)), true);
});

Deno.test("el youth que no va a la suya no bonifica nada", () => {
    const billable = billableAttendances([A22, A23], {
        goalkeeper: false,
        categories: ["youth"],
    });
    assertEquals(billable.length, 2);
});

Deno.test("la bonificación de youth es por día, no por mes", () => {
    const otherDay = { ...A22, date: "2026-08-27" };
    const ownOtherDay = { ...A21, date: "2026-08-27" };
    const billable = billableAttendances([A21, A22, ownOtherDay, otherDay], {
        goalkeeper: false,
        categories: ["youth"],
    });
    // Dos días, una bonificada en cada uno: quedan las dos propias.
    assertEquals(billable.length, 2);
});

Deno.test("un jugador común paga todas las sesiones que asiste, incluso el mismo día", () => {
    const billable = billableAttendances([A21, A22, A23], {
        goalkeeper: false,
        categories: ["cat-b"],
    });
    assertEquals(billable.length, 3);
});

Deno.test("las categorías no deciden qué se cobra: el que se cuelga en otro horario paga", () => {
    const billable = billableAttendances([A23], { goalkeeper: false, categories: ["cat-b"] });
    assertEquals(billable, [{ slot: slotKey(4, 23) }]);
});

Deno.test("la bonificación discrecional del admin gana sobre todo", () => {
    const billable = billableAttendances(
        [{ ...A22, bonified: true }, A23],
        { goalkeeper: false, categories: ["cat-b"] },
    );
    assertEquals(billable, [{ slot: slotKey(4, 23) }]);
});

// ////////////////////////////////////
// QUÉ SE PUEDE REGISTRAR
// ////////////////////////////////////

import {
    checkPayment,
    type PaymentGuard,
    weekStart,
    withinWriteWindow,
} from "../_shared/tokens.ts";

const OPEN: PaymentGuard = {
    closedDebt: 0,
    monthlySlots: new Set(),
    individualSlots: new Set(),
    monthPrice: 100000,
    monthlyPaid: 0,
    monthlyClosed: false,
};
const pay = (concept: "monthly" | "session" | "debt settlement", amount: number) => ({
    concept, amount, slot: S22,
});

Deno.test("la semana va de lunes a domingo", () => {
    assertEquals(weekStart("2026-08-20"), "2026-08-17"); // jueves -> lunes
    assertEquals(weekStart("2026-08-17"), "2026-08-17"); // lunes
    assertEquals(weekStart("2026-08-23"), "2026-08-17"); // domingo
});

Deno.test("se escribe la semana actual y la anterior, no más atrás", () => {
    const today = "2026-08-25"; // martes
    assertEquals(withinWriteWindow("2026-08-25", today), true);
    assertEquals(withinWriteWindow("2026-08-20", today), true); // jueves pasado
    assertEquals(withinWriteWindow("2026-08-17", today), true); // lunes anterior
    assertEquals(withinWriteWindow("2026-08-16", today), false);
    assertEquals(withinWriteWindow("2026-08-13", today), false);
});

Deno.test("el cobro de la madrugada del viernes cae en la semana del jueves", () => {
    // Un entrenamiento de jueves 23hs cobrado a la 1am del viernes: la ventana
    // no puede cortar entre el entrenamiento y su cobro.
    assertEquals(weekStart("2026-08-20"), weekStart("2026-08-21"));
});

Deno.test("la deuda cerrada bloquea todo menos el pago de deuda", () => {
    const ctx = { ...OPEN, closedDebt: 60000 };
    assertEquals(checkPayment(pay("session", 30000), ctx)?.includes("deuda"), true);
    assertEquals(checkPayment(pay("monthly", 100000), ctx)?.includes("deuda"), true);
    assertEquals(checkPayment(pay("debt settlement", 60000), ctx), null);
});

Deno.test("el pago de deuda no puede superar la deuda", () => {
    const ctx = { ...OPEN, closedDebt: 60000 };
    assertEquals(checkPayment(pay("debt settlement", 60001), ctx)?.includes("superar"), true);
    assertEquals(checkPayment(pay("debt settlement", 25000), ctx), null);
});

Deno.test("no hay pago de deuda si no hay deuda", () => {
    assertEquals(checkPayment(pay("debt settlement", 10000), OPEN), "No hay deuda para saldar");
});

Deno.test("no se mezcla mensual con individual en el mismo mes y horario", () => {
    const conIndividual = { ...OPEN, individualSlots: new Set([S22]) };
    assertEquals(checkPayment(pay("monthly", 100000), conIndividual)?.includes("sesión"), true);

    const conMensual = { ...OPEN, monthlySlots: new Set([S22]) };
    assertEquals(checkPayment(pay("session", 30000), conMensual)?.includes("mensual"), true);

    // Otro horario no tiene nada que ver.
    assertEquals(checkPayment({ ...pay("session", 30000), slot: S23 }, conMensual), null);
});

Deno.test("el mensual se puede pagar parcial, con un mínimo", () => {
    assertEquals(checkPayment(pay("monthly", 40000), OPEN), null);
    assertEquals(checkPayment(pay("monthly", 39999), OPEN)?.includes("menor"), true);
    assertEquals(checkPayment(pay("monthly", 100000), OPEN), null);
});

Deno.test("un parcial se completa, no se extiende: no hay tercera cuota", () => {
    const conParcial = { ...OPEN, monthlyPaid: 40000 };
    assertEquals(checkPayment(pay("monthly", 60000), conParcial), null);
    assertEquals(checkPayment(pay("monthly", 30000), conParcial)?.includes("completar"), true);
});

Deno.test("pasada la segunda sesión ya no se compra el mes", () => {
    const tarde = { ...OPEN, monthlyClosed: true };
    assertEquals(checkPayment(pay("monthly", 100000), tarde)?.includes("segunda sesión"), true);
    // Pero completar un parcial que ya se empezó sí se puede.
    assertEquals(checkPayment(pay("monthly", 60000), { ...tarde, monthlyPaid: 40000 }), null);
});

Deno.test("un horario sin entrenamientos este mes no tiene mes que vender", () => {
    assertEquals(
        checkPayment(pay("monthly", 100000), { ...OPEN, monthPrice: 0 })?.includes("entrenamientos"),
        true,
    );
});

Deno.test("el monto tiene que ser positivo", () => {
    assertEquals(checkPayment(pay("session", 0), OPEN)?.includes("mayor a cero"), true);
    assertEquals(checkPayment(pay("session", -1), OPEN)?.includes("mayor a cero"), true);
});
