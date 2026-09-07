import { test, expect } from "@playwright/test";
import { buildAnalysis, NoSlot, slotsByMonth, type AnalysisPayment } from "../src/lib/analysis";
import { LEDGER_DEFAULTS, type LedgerExtras } from "../src/lib/rosterLedger";
import { todayBA } from "./fixtures";

// The month's money, pivoted by month: pure arithmetic first (no browser),
// then the screen that shows it.

const M = "2026-09";
const PLAYERS = [
  { id: "p1", name: "Ana", last_name: "Uno" },
  { id: "p2", name: "Beto", last_name: "Dos" },
  { id: "p3", name: "Cami", last_name: "Tres" },
  { id: "p4", name: "Dani", last_name: "Cuatro" },
];
const SLOTS = [
  { key: "4-21", label: "jue 21hs" },
  { key: "4-22", label: "jue 22hs" },
];

function pay(
  player_id: string,
  concept: string,
  amount: number,
  opts: { hour?: number | null; month?: string; collector?: string } = {},
): AnalysisPayment {
  const hour = opts.hour === undefined ? 22 : opts.hour;
  return {
    player_id,
    concept,
    amount,
    slot_weekday: hour === null ? null : 4,
    slot_hour: hour,
    month: opts.month ?? M,
    collector: opts.collector ?? "Alejandro",
  };
}

function extras(over: Partial<LedgerExtras>): LedgerExtras {
  return { ...LEDGER_DEFAULTS, ...over };
}

test("slotsByMonth: where they trained first, youth slot first on a double, else where they paid", () => {
  const slots = slotsByMonth(
    [
      { player_id: "p1", session: "2026-09-03 23hs" },
      { player_id: "p1", session: "2026-09-03 21hs" },
      { player_id: "p2", session: "2026-08-20 22hs" },
    ],
    [pay("p3", "monthly", 110000, { hour: 23 }), pay("p2", "session", 35000, { hour: 21 })],
  );
  expect(slots.get("2026-09")?.get("p1")).toBe("4-21");
  expect(slots.get("2026-09")?.get("p3")).toBe("4-23");
  // p2 trained in August at 22hs and paid September at 21hs: one per month.
  expect(slots.get("2026-08")?.get("p2")).toBe("4-22");
  expect(slots.get("2026-09")?.get("p2")).toBe("4-21");
});

test("cobros del mes: por horario y por cobrador, sin los pagos de deuda", () => {
  const a = buildAnalysis({
    month: M,
    payments: [
      pay("p1", "monthly", 110000, { hour: 22, collector: "Alejandro" }),
      pay("p2", "session", 35000, { hour: 22, collector: "Abril" }),
      pay("p3", "monthly", 90000, { hour: 21, collector: "Abril" }),
      pay("p4", "debt settlement", 30000, { hour: 21, collector: "Abril" }),
    ],
    attendances: [],
    players: PLAYERS,
    extras: new Map(),
    monthSlots: SLOTS,
  });
  expect(a.collections.total).toBe(235000);
  expect(a.collections.byCollector).toEqual([
    { label: "Abril", amount: 125000 },
    { label: "Alejandro", amount: 110000 },
  ]);
  const s22 = a.collections.slots.find((s) => s.slot === "jue 22hs")!;
  expect(s22.collected).toBe(145000);
  expect(s22.byCollector).toEqual([
    { label: "Alejandro", amount: 110000 },
    { label: "Abril", amount: 35000 },
  ]);
  expect(a.collections.slots.find((s) => s.slot === "jue 21hs")!.collected).toBe(90000);
  // The settlement is debt money: it shows up there and only there.
  expect(a.debt.settled).toBe(30000);
  expect(a.debt.settledByCollector).toEqual([{ label: "Abril", amount: 30000 }]);
});

test("faltante: el que no pagó nada puede comprar el mes; el parcial y el que pagó sesión, no", () => {
  const a = buildAnalysis({
    month: M,
    payments: [
      pay("p2", "monthly", 100000, { hour: 22 }),
      pay("p3", "session", 35000, { hour: 22 }),
    ],
    attendances: [
      { player_id: "p1", session: "2026-09-03 22hs" },
      { player_id: "p2", session: "2026-09-03 22hs" },
      { player_id: "p3", session: "2026-09-03 22hs" },
      { player_id: "p3", session: "2026-09-10 22hs" },
    ],
    players: PLAYERS,
    extras: new Map([
      // Went once, paid nothing: owes one session now, the month if they buy it.
      ["p1", extras({ owed_now: 35000, cur_attended: 1, month_preset: 110000 })],
      // Paid 100k of a 110k month: the other 10k either way.
      ["p2", extras({ owed_now: 10000, cur_attended: 1, month_preset: 110000 })],
      // Paid one session, went twice: the second one, either way.
      ["p3", extras({ owed_now: 35000, cur_attended: 2, month_preset: 110000 })],
    ]),
    monthSlots: SLOTS,
  });
  const s22 = a.collections.slots.find((s) => s.slot === "jue 22hs")!;
  expect(s22.pessimistic).toBe(80000);
  expect(s22.optimistic).toBe(155000);
  expect(s22.owing.map((o) => [o.player, o.kind, o.pessimistic, o.optimistic])).toEqual([
    ["Dos, Beto", "partial", 10000, 10000],
    ["Tres, Cami", "session", 35000, 35000],
    ["Uno, Ana", "unpaid", 35000, 110000],
  ]);
  expect(a.collections.pessimistic).toBe(80000);
  expect(a.collections.optimistic).toBe(155000);
  // A slot that held trainings but has nothing to say is still listed.
  expect(a.collections.slots.map((s) => s.slot)).toEqual(["jue 21hs", "jue 22hs"]);
});

test("deuda anterior: por el horario del mes que la generó, neta de lo cobrado; el mes saldado no figura", () => {
  const a = buildAnalysis({
    month: M,
    payments: [
      pay("p4", "debt settlement", 30000, { hour: 22, collector: "Laionel" }),
      pay("p1", "session", 30000, { hour: 21, month: "2026-08" }),
    ],
    attendances: [
      { player_id: "p1", session: "2026-08-13 21hs" },
      { player_id: "p2", session: "2026-08-13 23hs" },
    ],
    players: PLAYERS,
    extras: new Map([
      ["p1", extras({
        debt: 30000, debt_outstanding: 30000,
        debt_months: [{ month: "2026-08", charge: 60000, paid: 30000, settled: 0, outstanding: 30000 }],
      })],
      ["p2", extras({
        debt: 60000, debt_outstanding: 60000,
        debt_months: [{ month: "2026-08", charge: 60000, paid: 0, settled: 0, outstanding: 60000 }],
      })],
      // Paid off this month: nothing left to list, only the payment.
      ["p4", extras({
        debt: 30000, debt_outstanding: 0,
        debt_months: [{ month: "2026-08", charge: 30000, paid: 0, settled: 30000, outstanding: 0 }],
      })],
    ]),
    monthSlots: SLOTS,
  });
  expect(a.debt.outstanding).toBe(90000);
  expect(a.debt.settled).toBe(30000);
  expect(a.debt.settledByCollector).toEqual([{ label: "Laionel", amount: 30000 }]);
  expect(a.debt.slots.map((s) => [s.slot, s.outstanding, s.settled])).toEqual([
    ["jue 21hs", 30000, 0],
    ["jue 22hs", 0, 30000],
    ["jue 23hs", 60000, 0],
  ]);
  expect(a.debt.slots[0].debtors).toEqual([{ player: "Uno, Ana", month: "2026-08", amount: 30000 }]);
  // August's session payment is August's: not among this month's collections.
  expect(a.collections.total).toBe(0);
});

test("un pago sin horario cae en su propio grupo", () => {
  const a = buildAnalysis({
    month: M,
    payments: [pay("p1", "session", 35000, { hour: null })],
    attendances: [],
    players: PLAYERS,
    extras: new Map(),
    monthSlots: SLOTS,
  });
  expect(a.collections.slots.find((s) => s.slot === NoSlot)?.collected).toBe(35000);
});

test("la pantalla abre en el mes actual, navega hacia atrás y vuelve", async ({ page }) => {
  await page.request.post("/api/auth/dev");
  await page.goto("/analisis");

  const current = todayBA().slice(0, 7);
  const res = await page.request.get(`/api/analisis?month=${current}`);
  expect(res.status(), await res.text()).toBe(200);
  const body = await res.json();
  expect(body.month).toBe(current);
  expect(body.analysis).not.toBeNull();
  expect(typeof body.analysis.collections.total).toBe("number");

  const title = page.getByTestId("analysis-month");
  await expect(title).toBeVisible();
  const currentTitle = await title.textContent();
  await expect(page.getByTestId("analysis-today")).toHaveCount(0);

  await page.getByRole("button", { name: "Mes anterior" }).click();
  await expect(title).not.toHaveText(currentTitle!);
  await page.getByTestId("analysis-today").click();
  await expect(title).toHaveText(currentTitle!);
  await expect(page.getByTestId("analysis-today")).toHaveCount(0);
});
