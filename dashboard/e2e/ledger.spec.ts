import { test, expect } from "@playwright/test";
import {
  ledgerStep,
  priceFor,
  runLedger,
  trainingsFor,
  type LedgerPrice,
  type LedgerState,
} from "../src/lib/ledger";

// Pure unit tests for the carryover ledger (no browser involved). Mirrors the
// rules tested for the whatsapp webhook in whatsapp-status.test.ts: singles at
// 30k, prepaid month at 25k per training, bonified sessions only when the
// club fell short, debt in single-rate pesos.

const PRICE: LedgerPrice = {
  valid_from: "2026-01-01",
  session_price: 30000,
  prepaid_session_price: 25000,
};
const ZERO: LedgerState = { debt: 0, carryoverIn: 0 };

test("el mes prepago es use-it-or-lose-it", () => {
  const r = ledgerStep(ZERO, { attended: 2, paidMonthly: true, totalPaid: 100000 }, PRICE, 4, 0);
  expect(r.charge).toBe(100000);
  expect(r.next).toEqual({ debt: 0, carryoverIn: 0 });
});

test("pagar más que la capacidad del mes bonifica sesiones", () => {
  // Feriado: el mes quedó de 3 pero se cobraron 4 sesiones (100k).
  const r = ledgerStep(ZERO, { attended: 3, paidMonthly: false, totalPaid: 100000 }, PRICE, 3, 0);
  expect(r.charge).toBe(75000);
  expect(r.next).toEqual({ debt: 0, carryoverIn: 1 });
});

test("la deuda se computa a tarifa individual, sin tope", () => {
  const r = ledgerStep(ZERO, { attended: 3, paidMonthly: false, totalPaid: 0 }, PRICE, 4, 0);
  expect(r.next.debt).toBe(90000);
  // Asistió a las 4 sin pagar: 4 sueltas (120k), no el precio del bundle.
  const all = ledgerStep(ZERO, { attended: 4, paidMonthly: false, totalPaid: 0 }, PRICE, 4, 0);
  expect(all.next.debt).toBe(120000);
});

test("un pago cercano al bundle es un prepago incompleto", () => {
  // >= (n-1) sesiones prepagas: se debe el bundle completo, falta saldar 20k.
  const partial = ledgerStep(ZERO, { attended: 4, paidMonthly: false, totalPaid: 80000 }, PRICE, 4, 0);
  expect(partial.next.debt).toBe(20000);
  // Pero nunca peor que pagar sueltas: 3 asistencias con 90k quedan saldadas.
  const singles = ledgerStep(ZERO, { attended: 3, paidMonthly: false, totalPaid: 90000 }, PRICE, 4, 0);
  expect(singles.next.debt).toBe(0);
  // Debajo del umbral es sueltas comunes: debe 60k.
  const below = ledgerStep(ZERO, { attended: 4, paidMonthly: false, totalPaid: 60000 }, PRICE, 4, 0);
  expect(below.next.debt).toBe(60000);
});

test("el pago cubre el mes corriente primero y después la deuda vieja", () => {
  // marzo/abril: 1 asistencia impaga (30k), luego mes de 3 pagado con 100k:
  // 75k compran el mes, 25k van a la deuda, quedan 5k — y sin carryover.
  const { state, rows } = runLedger(
    ["2026-08", "2026-09"],
    new Map([
      ["2026-08", { attended: 1, paidMonthly: false, totalPaid: 0 }],
      ["2026-09", { attended: 3, paidMonthly: false, totalPaid: 100000 }],
    ]),
    new Map([["2026-08", 4], ["2026-09", 3]]),
    [PRICE],
    0,
  );
  expect(rows[0].debtAfter).toBe(30000);
  expect(state).toEqual({ debt: 5000, carryoverIn: 0 });
});

test("las sesiones bonificadas descuentan el bundle del mes siguiente", () => {
  const { state } = runLedger(
    ["2026-08", "2026-09"],
    new Map([
      ["2026-08", { attended: 3, paidMonthly: false, totalPaid: 100000 }], // bonifica 1
      ["2026-09", { attended: 4, paidMonthly: false, totalPaid: 75000 }], // (4-1) x 25k
    ]),
    new Map([["2026-08", 3], ["2026-09", 4]]),
    [PRICE],
    0,
  );
  expect(state).toEqual({ debt: 0, carryoverIn: 0 });
});

test("el carryover expira si no se usa al mes siguiente", () => {
  const { state } = runLedger(
    ["2026-08", "2026-09", "2026-10"],
    new Map([
      ["2026-08", { attended: 3, paidMonthly: false, totalPaid: 100000 }], // bonifica 1
      // septiembre sin actividad: la bonificación muere
      ["2026-10", { attended: 1, paidMonthly: false, totalPaid: 0 }],
    ]),
    new Map([["2026-08", 3], ["2026-09", 4], ["2026-10", 4]]),
    [PRICE],
    0,
  );
  expect(state).toEqual({ debt: 30000, carryoverIn: 0 });
});

test("un mes de 1 entrenamiento no tiene bundle", () => {
  const r = ledgerStep(ZERO, { attended: 1, paidMonthly: true, totalPaid: 30000 }, PRICE, 1, 0);
  expect(r.bought).toBe(false);
  expect(r.charge).toBe(30000);
});

test("la beca descuenta ambas tarifas", () => {
  const r = ledgerStep(ZERO, { attended: 4, paidMonthly: false, totalPaid: 50000 }, PRICE, 4, 50);
  expect(r.bought).toBe(true); // 4 x 12.5k = 50k
  expect(r.charge).toBe(50000);
});

test("trainingsFor cuenta fechas por grupo de categorías", () => {
  const slots = [
    { date: "2026-09-03", categories: ["youth"], goalies: true },
    { date: "2026-09-03", categories: ["cat-a", "cat-b"], goalies: false },
    { date: "2026-09-10", categories: ["cat-a", "cat-b"], goalies: false },
  ];
  expect(trainingsFor(slots, ["cat-b"], false).get("2026-09")).toBe(2);
  expect(trainingsFor(slots, ["youth"], false).get("2026-09")).toBe(1);
  // Arqueros: solo los slots goalie-friendly.
  expect(trainingsFor(slots, ["cat-a"], true).get("2026-09")).toBe(1);
});

test("priceFor elige la tarifa vigente al mes", () => {
  const prices: LedgerPrice[] = [
    { valid_from: "2026-01-01", session_price: 25000, prepaid_session_price: 20000 },
    { valid_from: "2026-09-01", session_price: 30000, prepaid_session_price: 25000 },
  ];
  expect(priceFor(prices, "2026-08").session_price).toBe(25000);
  expect(priceFor(prices, "2026-09").prepaid_session_price).toBe(25000);
});
