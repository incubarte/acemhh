import { test, expect } from "@playwright/test";
import { collectionDay, groupIncomeByDay, NoSlotLabel } from "../src/lib/cashflow";

// Pure unit tests for the collection-day grouping (no browser involved).
// Timestamps are UTC; a collection day runs 5am → 5am Buenos Aires time
// (UTC-3), i.e. 08:00Z → 08:00Z.

const A = "user-a";
const B = "user-b";

function pay(user_id: string, created_at: string, amount = 1000, slot: string | null = "jue 22hs") {
  return { user_id, amount, created_at, slot };
}

test("un entrenamiento nocturno y sus cobros pasada la medianoche son un solo día", () => {
  // 21hs, 22hs and 01hs BA — the last one already the next calendar day.
  const groups = groupIncomeByDay([
    pay(A, "2026-08-14T00:00:00Z"), // 21hs del 13 en BA
    pay(A, "2026-08-14T01:00:00Z"), // 22hs del 13
    pay(A, "2026-08-14T04:00:00Z"), // 01hs del 14
  ]);

  expect(groups).toEqual([
    { user_id: A, start: "2026-08-14T00:00:00Z", day: "2026-08-13", slot: "jue 22hs", amount: 3000, count: 3 },
  ]);
});

test("el corte es a las 5am de Buenos Aires, no a medianoche", () => {
  // 04:59 BA belongs to the previous day; 05:01 BA opens the new one.
  expect(collectionDay("2026-08-14T07:59:00Z")).toBe("2026-08-13");
  expect(collectionDay("2026-08-14T08:01:00Z")).toBe("2026-08-14");

  const groups = groupIncomeByDay([
    pay(A, "2026-08-14T07:59:00Z"),
    pay(A, "2026-08-14T08:01:00Z"),
  ]);
  expect(groups).toHaveLength(2);
  expect(groups.map((g) => g.day)).toEqual(["2026-08-13", "2026-08-14"]);
});

test("cobros de días distintos no se mezclan aunque estén a pocas horas", () => {
  const groups = groupIncomeByDay([
    pay(A, "2026-08-14T00:00:00Z"), // 21hs del 13
    pay(A, "2026-08-15T00:00:00Z"), // 21hs del 14
  ]);
  expect(groups.map((g) => g.day)).toEqual(["2026-08-13", "2026-08-14"]);
});

test("cobradores distintos nunca comparten entrada", () => {
  const groups = groupIncomeByDay([
    pay(A, "2026-08-14T00:00:00Z"),
    pay(B, "2026-08-14T00:30:00Z"),
  ]);

  expect(groups).toHaveLength(2);
  expect(groups.map((g) => g.user_id).sort()).toEqual([A, B]);
});

test("el orden de llegada no altera la agrupación ni el inicio del día", () => {
  const shuffled = groupIncomeByDay([
    pay(A, "2026-08-14T04:00:00Z"),
    pay(A, "2026-08-14T00:00:00Z"),
    pay(A, "2026-08-14T01:00:00Z"),
  ]);

  expect(shuffled).toEqual([
    { user_id: A, start: "2026-08-14T00:00:00Z", day: "2026-08-13", slot: "jue 22hs", amount: 3000, count: 3 },
  ]);
});

test("cada slot de la misma noche es una entrada aparte", () => {
  // One collector takes money at the three trainings of a single night: the
  // day is the same, but each training is settled on its own.
  const groups = groupIncomeByDay([
    pay(A, "2026-08-14T00:00:00Z", 1000, "jue 21hs"),
    pay(A, "2026-08-14T01:00:00Z", 2000, "jue 22hs"),
    pay(A, "2026-08-14T01:30:00Z", 3000, "jue 22hs"),
    pay(A, "2026-08-14T02:00:00Z", 4000, "jue 23hs"),
  ]);

  expect(groups).toHaveLength(3);
  expect(groups.map((g) => [g.slot, g.amount, g.count])).toEqual([
    ["jue 21hs", 1000, 1],
    ["jue 22hs", 5000, 2],
    ["jue 23hs", 4000, 1],
  ]);
  // Still one day for all of them.
  expect(new Set(groups.map((g) => g.day))).toEqual(new Set(["2026-08-13"]));
});

test("un mismo slot en noches distintas no se junta", () => {
  const groups = groupIncomeByDay([
    pay(A, "2026-08-14T01:00:00Z", 1000, "jue 22hs"),
    pay(A, "2026-08-21T01:00:00Z", 2000, "jue 22hs"),
  ]);

  expect(groups).toHaveLength(2);
  expect(groups.map((g) => g.day)).toEqual(["2026-08-13", "2026-08-20"]);
});

test("los cobros viejos sin slot quedan en su propia entrada", () => {
  const groups = groupIncomeByDay([
    pay(A, "2026-08-14T01:00:00Z", 1000, null),
    pay(A, "2026-08-14T01:10:00Z", 2000, "jue 22hs"),
  ]);

  expect(groups).toHaveLength(2);
  expect(groups.map((g) => g.slot).sort()).toEqual(["jue 22hs", NoSlotLabel]);
});
