import { test, expect } from "@playwright/test";
import { feeStanding, type Installment } from "../src/lib/tournamentFees";

// La cuota del torneo, regla por regla. Puro: no hay navegador.

// Categoría A del Clausura 2026: 60 + 55 + 55 + 25 = 195, o 178 anticipado.
const A: Installment[] = [
  { month: "2026-09", amount: 60000 },
  { month: "2026-10", amount: 55000 },
  { month: "2026-11", amount: 55000 },
  { month: "2026-12", amount: 25000 },
];
const UPFRONT_A = 178000;

const cuota = (amount: number) => ({ amount, concept: "tournament" as const });
const statuses = (s: ReturnType<typeof feeStanding>) => s.installments.map((i) => i.status);

test("sin pagar nada en septiembre: la primera vence, las otras todavía no", () => {
  const s = feeStanding(A, UPFRONT_A, [], "2026-09");
  expect(statuses(s)).toEqual(["due", "upcoming", "upcoming", "upcoming"]);
  expect(s.dueSoFar).toBe(60000);
  expect(s.outstandingNow).toBe(60000);
  expect(s.total).toBe(195000);
  expect(s.remaining).toBe(195000);
  expect(s.nextSuggested).toBe(60000);
});

test("la mitad de septiembre se ve como septiembre en parte", () => {
  const s = feeStanding(A, UPFRONT_A, [cuota(30000)], "2026-09");
  expect(statuses(s)).toEqual(["partial", "upcoming", "upcoming", "upcoming"]);
  expect(s.installments[0].paid).toBe(30000);
  expect(s.outstandingNow).toBe(30000);
  expect(s.nextSuggested).toBe(30000);
});

test("en octubre, septiembre entero y el 40% de octubre: verde, amarillo, gris, gris", () => {
  // El ejemplo del pedido. Dos pagos sueltos que suman 82k: no importa cómo
  // se repartieron, cuenta el total.
  const s = feeStanding(A, UPFRONT_A, [cuota(50000), cuota(32000)], "2026-10");
  expect(statuses(s)).toEqual(["paid", "partial", "upcoming", "upcoming"]);
  expect(s.installments[1].paid).toBe(22000);
  expect(s.dueSoFar).toBe(115000);
  expect(s.outstandingNow).toBe(33000);
  expect(s.nextSuggested).toBe(33000);
});

test("en octubre sin pagar nada: dos vencidas", () => {
  const s = feeStanding(A, UPFRONT_A, [], "2026-10");
  expect(statuses(s)).toEqual(["due", "due", "upcoming", "upcoming"]);
  expect(s.outstandingNow).toBe(115000);
});

test("pagar de más adelanta cuotas que todavía no vencen", () => {
  const s = feeStanding(A, UPFRONT_A, [cuota(120000)], "2026-09");
  expect(statuses(s)).toEqual(["paid", "paid", "partial", "upcoming"]);
  expect(s.outstandingNow).toBe(0);
  // Al día: lo que sigue es completar noviembre.
  expect(s.nextSuggested).toBe(50000);
});

test("el torneo saldado en cuotas no sugiere nada más", () => {
  const s = feeStanding(A, UPFRONT_A, [cuota(195000)], "2026-11");
  expect(statuses(s)).toEqual(["paid", "paid", "paid", "paid"]);
  expect(s.remaining).toBe(0);
  expect(s.nextSuggested).toBeNull();
});

test("el anticipado se ofrece sólo sin pagos y hasta el primer mes", () => {
  expect(feeStanding(A, UPFRONT_A, [], "2026-08").upfrontAvailable).toBe(true);
  expect(feeStanding(A, UPFRONT_A, [], "2026-09").upfrontAvailable).toBe(true);
  expect(feeStanding(A, UPFRONT_A, [], "2026-10").upfrontAvailable).toBe(false);
  expect(feeStanding(A, UPFRONT_A, [cuota(1000)], "2026-09").upfrontAvailable).toBe(false);
  // Sin precio anticipado en la categoría, nunca.
  expect(feeStanding(A, null, [], "2026-09").upfrontAvailable).toBe(false);
});

test("el anticipado deja todo pago aunque sume menos que las cuotas", () => {
  const s = feeStanding(A, UPFRONT_A, [{ amount: UPFRONT_A, concept: "tournament upfront" }], "2026-09");
  expect(statuses(s)).toEqual(["paid", "paid", "paid", "paid"]);
  expect(s.total).toBe(UPFRONT_A);
  expect(s.remaining).toBe(0);
  expect(s.upfrontTaken).toBe(true);
  // Las cuotas se muestran con su valor nominal, todas cubiertas; lo debido
  // fue el precio anticipado entero, de una.
  expect(s.installments.map((i) => i.amount)).toEqual([60000, 55000, 55000, 25000]);
  expect(s.installments.map((i) => i.paid)).toEqual([60000, 55000, 55000, 25000]);
  expect(s.dueSoFar).toBe(UPFRONT_A);
  expect(s.outstandingNow).toBe(0);
  expect(s.nextSuggested).toBeNull();
});

test("un anticipado cargado a mano por menos se lee a escala de lo que pagó", () => {
  const s = feeStanding(A, UPFRONT_A, [{ amount: 100000, concept: "tournament upfront" }], "2026-09");
  expect(s.total).toBe(UPFRONT_A);
  expect(s.installments.reduce((acc, i) => acc + i.amount, 0)).toBe(UPFRONT_A);
  expect(statuses(s)).toEqual(["paid", "partial", "upcoming", "upcoming"]);
  expect(s.outstandingNow).toBe(78000);
  expect(s.remaining).toBe(78000);
});

test("pagar más que el total no rompe nada", () => {
  const s = feeStanding(A, UPFRONT_A, [cuota(200000)], "2026-09");
  expect(statuses(s)).toEqual(["paid", "paid", "paid", "paid"]);
  expect(s.paid).toBe(200000);
  expect(s.remaining).toBe(0);
  expect(s.outstandingNow).toBe(0);
});

test("las cuotas se aplican en orden de mes aunque vengan desordenadas", () => {
  const shuffled = [A[2], A[0], A[3], A[1]];
  const s = feeStanding(shuffled, UPFRONT_A, [cuota(60000)], "2026-09");
  expect(s.installments.map((i) => i.month)).toEqual(["2026-09", "2026-10", "2026-11", "2026-12"]);
  expect(statuses(s)).toEqual(["paid", "upcoming", "upcoming", "upcoming"]);
});

test("una categoría sin cuotas no debe nada", () => {
  const s = feeStanding([], null, [], "2026-09");
  expect(s.installments).toEqual([]);
  expect(s.total).toBe(0);
  expect(s.outstandingNow).toBe(0);
  expect(s.nextSuggested).toBeNull();
  expect(s.upfrontAvailable).toBe(false);
});
