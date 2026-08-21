import { test, expect } from "@playwright/test";
import { collectionDay, groupIncomeByDay } from "../src/lib/cashflow";

// Pure unit tests for the collection-day grouping (no browser involved).
// Timestamps are UTC; a collection day runs 5am → 5am Buenos Aires time
// (UTC-3), i.e. 08:00Z → 08:00Z.

const A = "user-a";
const B = "user-b";

function pay(user_id: string, created_at: string, amount = 1000) {
  return { user_id, amount, created_at };
}

test("un entrenamiento nocturno y sus cobros pasada la medianoche son un solo día", () => {
  // 21hs, 22hs and 01hs BA — the last one already the next calendar day.
  const groups = groupIncomeByDay([
    pay(A, "2026-08-14T00:00:00Z"), // 21hs del 13 en BA
    pay(A, "2026-08-14T01:00:00Z"), // 22hs del 13
    pay(A, "2026-08-14T04:00:00Z"), // 01hs del 14
  ]);

  expect(groups).toEqual([
    { user_id: A, start: "2026-08-14T00:00:00Z", day: "2026-08-13", amount: 3000, count: 3 },
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
    { user_id: A, start: "2026-08-14T00:00:00Z", day: "2026-08-13", amount: 3000, count: 3 },
  ]);
});
