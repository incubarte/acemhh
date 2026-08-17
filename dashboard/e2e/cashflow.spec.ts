import { test, expect } from "@playwright/test";
import { groupIncomeWindows } from "../src/lib/cashflow";

// Pure unit tests for the income-window grouping (no browser involved).

const A = "user-a";
const B = "user-b";

function pay(user_id: string, created_at: string, amount = 1000) {
  return { user_id, amount, created_at };
}

test("cobros del mismo cobrador dentro de 5 horas forman una sola entrada", () => {
  // 21:00, 22:00 and 01:00 next day: all within 5h of the first payment.
  const windows = groupIncomeWindows([
    pay(A, "2026-08-13T21:00:00Z"),
    pay(A, "2026-08-13T22:00:00Z"),
    pay(A, "2026-08-14T01:00:00Z"),
  ]);

  expect(windows).toEqual([
    { user_id: A, start: "2026-08-13T21:00:00Z", amount: 3000, count: 3 },
  ]);
});

test("un cobro fuera de la ventana abre una entrada nueva", () => {
  const windows = groupIncomeWindows([
    pay(A, "2026-08-13T21:00:00Z"),
    // 02:00 is 5h after the anchor: outside [21:00, 02:00).
    pay(A, "2026-08-14T02:00:00Z"),
  ]);

  expect(windows).toEqual([
    { user_id: A, start: "2026-08-13T21:00:00Z", amount: 1000, count: 1 },
    { user_id: A, start: "2026-08-14T02:00:00Z", amount: 1000, count: 1 },
  ]);
});

test("cobradores distintos nunca comparten ventana", () => {
  const windows = groupIncomeWindows([
    pay(A, "2026-08-13T21:00:00Z"),
    pay(B, "2026-08-13T21:30:00Z"),
  ]);

  expect(windows).toHaveLength(2);
  expect(windows.map((w) => w.user_id).sort()).toEqual([A, B]);
});

test("el orden de llegada no altera la agrupación", () => {
  const shuffled = groupIncomeWindows([
    pay(A, "2026-08-14T01:00:00Z"),
    pay(A, "2026-08-13T21:00:00Z"),
    pay(A, "2026-08-13T22:00:00Z"),
  ]);

  expect(shuffled).toEqual([
    { user_id: A, start: "2026-08-13T21:00:00Z", amount: 3000, count: 3 },
  ]);
});
