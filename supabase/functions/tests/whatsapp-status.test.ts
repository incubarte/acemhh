// Tests for the WhatsApp auto-reply status: the months window over the
// agenda, the ledger rules (bundle, bonified sessions, debt), the wording,
// and the DB aggregation. The pure parts need no stack; the last tests run
// against local Supabase:
//
//     supabase start
//     deno test -A supabase/functions/tests/whatsapp-status.test.ts

import { createClient } from "jsr:@supabase/supabase-js@2";
import { assertEquals } from "jsr:@std/assert";
import {
    activeMonths,
    buildPlayerSection,
    computeLedger,
    fetchMonthStatuses,
    fetchPrices,
    fetchTrainingSlots,
    formatMonthLine,
    monthsWindow,
    periodMonths,
    priceFor,
    trainingsFor,
} from "../whatsapp-webhook/status.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const AGENDA_2026_S2 = ["2026-08", "2026-09", "2026-10", "2026-11", "2026-12"];

Deno.test("monthsWindow: first active month shows only itself", () => {
    assertEquals(monthsWindow("2026-08", AGENDA_2026_S2), ["2026-08"]);
});

Deno.test("monthsWindow: mid-semester shows the last three active months", () => {
    assertEquals(monthsWindow("2026-11", AGENDA_2026_S2), ["2026-09", "2026-10", "2026-11"]);
    assertEquals(monthsWindow("2026-12", AGENDA_2026_S2), ["2026-10", "2026-11", "2026-12"]);
});

Deno.test("monthsWindow: months without activity yield an empty window", () => {
    // July: the semester's activity has not started.
    assertEquals(monthsWindow("2026-07", AGENDA_2026_S2), []);
    // A first-semester month never reaches into the previous semester's agenda.
    assertEquals(monthsWindow("2026-03", AGENDA_2026_S2), []);
});

Deno.test("monthsWindow: never crosses into the previous period", () => {
    const agenda = ["2026-03", "2026-04", "2026-05", "2026-06", ...AGENDA_2026_S2];
    // August only sees August, even with active months in the first period.
    assertEquals(monthsWindow("2026-08", agenda), ["2026-08"]);
    assertEquals(monthsWindow("2026-05", agenda), ["2026-03", "2026-04", "2026-05"]);
});

Deno.test("los períodos son marzo–julio y agosto–diciembre, no semestres", () => {
    // The club trains in two five-month stretches, so the halves of the year
    // are not where the line falls.
    const first = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07"];
    assertEquals(periodMonths("2026-03"), first);
    assertEquals(periodMonths("2026-07"), first);
    assertEquals(periodMonths("2026-08"), AGENDA_2026_S2);
    assertEquals(periodMonths("2026-12"), AGENDA_2026_S2);

    // Summer break: a period of its own, and always empty — nobody trains.
    assertEquals(periodMonths("2026-01"), ["2026-01", "2026-02"]);
    assertEquals(periodMonths("2026-02"), ["2026-01", "2026-02"]);
});

Deno.test("monthsWindow: julio cierra el primer período y agosto abre el segundo", () => {
    // Regression: July used to be bundled with August–December, so a debt from
    // June vanished in July while July's followed the player into August.
    const agenda = ["2026-06", "2026-07", "2026-08"];
    assertEquals(monthsWindow("2026-07", agenda), ["2026-06", "2026-07"]);
    assertEquals(monthsWindow("2026-08", agenda), ["2026-08"]);
});

Deno.test("priceFor picks the newest tariff at or before the month", () => {
    const prices = [
        { valid_from: "2026-01-01", session_price: 25000, prepaid_session_price: 20000 },
        { valid_from: "2026-09-01", session_price: 30000, prepaid_session_price: 25000 },
    ];
    assertEquals(priceFor(prices, "2026-08").session_price, 25000);
    assertEquals(priceFor(prices, "2026-09").session_price, 30000);
    // Months before every tariff fall back to the oldest known one.
    assertEquals(priceFor(prices, "2025-06").session_price, 25000);
});

// ////////////////////////////////////
// LEDGER RULES
// ////////////////////////////////////

const VOS = { voice: "vos" as const, fullScholarship: false };
const EL = { voice: "el" as const, fullScholarship: false };
const BECA = { voice: "vos" as const, fullScholarship: true };

// Raw month builder: single 30000 / prepaid 25000, 4 trainings by default.
function raw(
    month: string,
    attended: number,
    totalPaid: number,
    opts: { paidMonthly?: boolean; trainings?: number } = {},
) {
    return {
        month,
        attended,
        paidMonthly: opts.paidMonthly ?? false,
        totalPaid,
        sessionPrice: 30000,
        prepaidPrice: 25000,
        trainings: opts.trainings ?? 4,
    };
}

Deno.test("ledger: the prepaid month is use-it-or-lose-it", () => {
    // Paid the 4-training month, attended 2: the 2 absences earn nothing.
    const [m] = computeLedger([raw("2026-08", 2, 100000, { paidMonthly: true })], 0);
    assertEquals(m.charge, 100000);
    assertEquals(m.carryoverOut, 0);
    assertEquals(m.debtAfter, 0);
    assertEquals(formatMonthLine(m, VOS), "- Agosto: asististe 2 veces / pagaste el mes ✅");
});

Deno.test("ledger: paying beyond the month's capacity is the club's fault and bonifies sessions", () => {
    // A holiday left the month with 3 trainings but the player was charged 4
    // sessions (100k): bundle is 75k, the extra 25k becomes 1 bonified session.
    const [m] = computeLedger([raw("2026-08", 3, 100000, { trainings: 3 })], 0);
    assertEquals(m.charge, 75000);
    assertEquals(m.carryoverOut, 1);
    assertEquals(m.debtAfter, 0);
});

Deno.test("ledger: unpaid attendance owes singles, uncapped", () => {
    // Attended 1 of 4: owes 1 single (30k).
    assertEquals(computeLedger([raw("2026-08", 1, 0)], 0)[0].debtAfter, 30000);
    // Attended all 4 unpaid: 4 singles (120k) — the prepaid rate is only for
    // paying the month upfront, not an entitlement.
    assertEquals(computeLedger([raw("2026-08", 4, 0)], 0)[0].debtAfter, 120000);
    // 3-training month, attended all 3 unpaid: 3 singles too (90k).
    assertEquals(
        computeLedger([raw("2026-08", 3, 0, { trainings: 3 })], 0)[0].debtAfter,
        90000,
    );
});

Deno.test("ledger: a payment close to the bundle is an incomplete bundle purchase", () => {
    // >= (n-1) prepaid sessions reads as a partial bundle: the whole bundle
    // (100k) is owed and the rest is debt...
    assertEquals(computeLedger([raw("2026-08", 4, 80000)], 0)[0].debtAfter, 20000);
    // ...but never worse than paying singles: 3 attendances at 90k are clear.
    assertEquals(computeLedger([raw("2026-08", 3, 90000)], 0)[0].debtAfter, 0);
    // Below the partial-bundle threshold it is plain singles: owes 60k.
    assertEquals(computeLedger([raw("2026-08", 4, 60000)], 0)[0].debtAfter, 60000);
});

Deno.test("ledger: debt composes month by month, payments settle it", () => {
    // The enero-mayo walkthrough: 4/3/4/-/4 trainings, paid 75/75/75/0/125.
    const ledger = computeLedger([
        raw("2026-08", 4, 75000), // partial bundle: owes 100k, debt 25k
        raw("2026-09", 3, 75000, { trainings: 3 }), // bundle paid in full
        raw("2026-10", 4, 75000), // partial bundle again, debt grows to 50k
        raw("2026-11", 0, 0), // no attendance: no new debt
        raw("2026-12", 4, 125000), // bundle + 25k against the oldest debt
    ], 0);

    assertEquals(ledger.map((l) => l.debtAfter), [25000, 25000, 50000, 50000, 25000]);
    // Extra money settles debt, so it never becomes a bonified session.
    assertEquals(ledger[4].carryoverOut, 0);
});

Deno.test("ledger: payments settle the current month first, then old debt", () => {
    // The marzo/abril example: 1 unpaid attendance (30k debt), then a
    // 3-training month paid with 100k: 75k buys the month, 25k goes to the
    // debt, 5k of it remain — and no carryover while debt exists.
    const ledger = computeLedger([
        raw("2026-08", 1, 0),
        raw("2026-09", 3, 100000, { trainings: 3 }),
    ], 0);

    assertEquals(ledger[0].debtAfter, 30000);
    assertEquals(ledger[1].charge, 75000);
    assertEquals(ledger[1].debtAfter, 5000);
    assertEquals(ledger[1].carryoverOut, 0);
});

Deno.test("ledger: bonified sessions absorb attendance and discount the next bundle", () => {
    // Month 1 generates 1 bonified session (charged 4, month had 3). Month 2:
    // the bundle for a 4-training month costs (4-1) x 25k = 75k.
    const ledger = computeLedger([
        raw("2026-08", 3, 100000, { trainings: 3 }),
        raw("2026-09", 4, 75000),
    ], 0);

    assertEquals(ledger[1].boughtMonth, true);
    assertEquals(ledger[1].charge, 75000);
    assertEquals(ledger[1].debtAfter, 0);
});

Deno.test("ledger: bonified sessions cover individual attendance too", () => {
    const ledger = computeLedger([
        raw("2026-08", 3, 100000, { trainings: 3 }),
        raw("2026-09", 3, 60000), // 1 bonified + 2 paid singles
    ], 0);

    assertEquals(ledger[1].charge, 60000);
    assertEquals(ledger[1].debtAfter, 0);
    assertEquals(
        formatMonthLine(ledger[1], VOS),
        "- Septiembre: asististe 3 veces (1 bonificada) / pagaste 2 sesiones ✅",
    );
});

Deno.test("ledger: carryover only reaches the following month", () => {
    const ledger = computeLedger([
        raw("2026-08", 3, 100000, { trainings: 3 }), // generates 1
        raw("2026-09", 0, 0), // unused: expires
        raw("2026-10", 1, 0),
    ], 0);

    assertEquals(ledger[1].carryoverIn, 1);
    assertEquals(ledger[2].carryoverIn, 0);
    assertEquals(ledger[2].debtAfter, 30000);
});

Deno.test("ledger: a 1-training month has no bundle", () => {
    // Even a monthly-concept payment cannot buy a 1-training month: the
    // attendance is charged at the single rate.
    const [m] = computeLedger([raw("2026-08", 1, 30000, { trainings: 1, paidMonthly: true })], 0);
    assertEquals(m.boughtMonth, false);
    assertEquals(m.charge, 30000);
    assertEquals(m.debtAfter, 0);
});

Deno.test("ledger: scholarship discounts both rates", () => {
    // Half scholarship: singles at 15k, bundle at 12.5k per training.
    assertEquals(computeLedger([raw("2026-08", 2, 30000)], 50)[0].debtAfter, 0);
    const [bought] = computeLedger([raw("2026-08", 4, 50000)], 50);
    assertEquals(bought.boughtMonth, true); // 4 x 12.5k = 50k
    assertEquals(bought.charge, 50000);
});

// ////////////////////////////////////
// WORDING
// ////////////////////////////////////

Deno.test("formatMonthLine: wording per payment shape and voice", () => {
    const ok = { boughtMonth: false, charge: 0, carryoverIn: 0, carryoverOut: 0, debtAfter: 0 };
    const debt = { ...ok, debtAfter: 1 };

    assertEquals(
        formatMonthLine({ ...raw("2026-08", 1, 30000), ...ok }, VOS),
        "- Agosto: asististe 1 vez / pagaste 1 sesión ✅",
    );
    // Below one session's worth, the raw amount is shown.
    assertEquals(
        formatMonthLine({ ...raw("2026-08", 1, 15000), ...debt }, VOS),
        "- Agosto: asististe 1 vez / pagaste $15.000 ❌",
    );
    assertEquals(
        formatMonthLine(
            { ...raw("2026-09", 1, 100000, { paidMonthly: true }), ...ok, boughtMonth: true },
            EL,
        ),
        "- Septiembre: asistió 1 vez / pagó el mes ✅",
    );
    assertEquals(
        formatMonthLine({ ...raw("2026-09", 1, 0), ...debt }, EL),
        "- Septiembre: asistió 1 vez / no pagó ❌",
    );
    // Attendance fully covered by bonified sessions: nothing to pay.
    assertEquals(
        formatMonthLine({ ...raw("2026-08", 1, 0), ...ok, carryoverIn: 1 }, VOS),
        "- Agosto: asististe 1 vez (1 bonificada) ✅",
    );
    // Nothing happened: neutral line whatever the balance.
    assertEquals(
        formatMonthLine({ ...raw("2026-08", 0, 0), ...debt }, VOS),
        "- Agosto: no asististe",
    );
});

Deno.test("formatMonthLine: full scholarship reports attendance only", () => {
    const base = {
        ...raw("2026-08", 0, 0),
        boughtMonth: false,
        charge: 0,
        carryoverIn: 0,
        carryoverOut: 0,
        debtAfter: 0,
    };

    assertEquals(
        formatMonthLine({ ...base, attended: 2 }, BECA),
        "- Agosto: asististe 2 veces y tenés beca ✅",
    );
    assertEquals(
        formatMonthLine(base, BECA),
        "- Agosto: no asististe aunque tenés beca",
    );
    assertEquals(
        formatMonthLine(base, { voice: "el", fullScholarship: true }),
        "- Agosto: no asistió aunque tiene beca",
    );
});

Deno.test("buildPlayerSection: last 3 months plus debt and bonified lines", () => {
    const ledger = computeLedger([
        raw("2026-08", 1, 0), // 30k debt
        raw("2026-09", 3, 100000, { trainings: 3 }), // 75k bundle + 25k to debt
    ], 0);

    assertEquals(buildPlayerSection(ledger, "Registro:", VOS), [
        "Registro:",
        "- Agosto: asististe 1 vez / no pagaste ❌",
        "- Septiembre: asististe 3 veces / pagaste el mes ❌",
        "Deuda pendiente: $5.000",
    ].join("\n"));
});

Deno.test("buildPlayerSection: bonified sessions for the coming month", () => {
    const ledger = computeLedger([
        raw("2026-08", 3, 100000, { trainings: 3 }),
    ], 0);

    assertEquals(buildPlayerSection(ledger, "Registro:", VOS), [
        "Registro:",
        "- Agosto: asististe 3 veces / pagaste el mes ✅",
        "Tenés 1 sesión bonificada para el mes que viene",
    ].join("\n"));
});

Deno.test("buildPlayerSection: bonified sessions still usable this month", () => {
    const ledger = computeLedger([
        raw("2026-08", 3, 100000, { trainings: 3 }),
        raw("2026-09", 0, 0),
    ], 0);

    assertEquals(buildPlayerSection(ledger, "Registro:", VOS), [
        "Registro:",
        "- Agosto: asististe 3 veces / pagaste el mes ✅",
        "- Septiembre: no asististe",
        "Tenés 1 sesión bonificada este mes",
    ].join("\n"));
});

Deno.test("buildPlayerSection: empty window means no section at all", () => {
    assertEquals(buildPlayerSection([], "Registro:", VOS), null);
});

// ////////////////////////////////////
// DB INTEGRATION
// ////////////////////////////////////

Deno.test("fetchMonthStatuses aggregates payments and attendance per month", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    const dni = "99000401";
    const cleanup = async () => {
        const { data } = await admin.from("players").select("id").eq("dni", dni);
        const ids = (data ?? []).map((p) => p.id);
        if (ids.length > 0) {
            await admin.from("payments").delete().in("player_id", ids);
            await admin.from("attendances").delete().in("player_id", ids);
            await admin.from("players").delete().in("id", ids);
        }
    };

    try {
        await cleanup();
        const { data: player, error } = await admin.from("players")
            .insert([{
                name: "__test",
                last_name: "Status",
                dni,
                categories: ["cat-c"],
                player_type: "player",
                trains: true,
                invitee: false,
            }])
            .select("id")
            .single();
        if (error) throw new Error(JSON.stringify(error));
        const playerId = player!.id;

        const att = (session: string) => ({ player_id: playerId, session, attended: true });
        const { error: attError } = await admin.from("attendances").insert([
            // August: attended twice, never paid.
            att("2026-08-06 22hs"),
            att("2026-08-13 22hs"),
            // October: attended once, paid the session.
            att("2026-10-08 22hs"),
        ]);
        if (attError) throw new Error(JSON.stringify(attError));

        const { error: payError } = await admin.from("payments").insert([
            // September: paid the month.
            {
                id: crypto.randomUUID(),
                player_id: playerId,
                registered_by: "__test",
                concept: "monthly",
                month: "2026-09",
                amount: 100000,
                is_cash: true,
            },
            // October: paid one session.
            {
                id: crypto.randomUUID(),
                player_id: playerId,
                registered_by: "__test",
                concept: "session",
                session: "2026-10-08 22hs",
                month: "2026-10",
                amount: 30000,
                is_cash: true,
            },
        ]);
        if (payError) throw new Error(JSON.stringify(payError));

        // Tariff from the migration (single 30000 / prepaid 25000); trainings
        // pinned so the test doesn't drift with the seeded agenda.
        const prices = await fetchPrices(admin);
        const trainings = new Map([["2026-08", 4], ["2026-09", 4], ["2026-10", 5]]);
        const statuses = await fetchMonthStatuses(
            admin,
            playerId,
            ["2026-08", "2026-09", "2026-10"],
            prices,
            trainings,
        );

        // August's unpaid sessions stay as debt: September's prepaid month
        // covers only itself (use-it-or-lose-it) and October's session covers
        // October.
        assertEquals(
            buildPlayerSection(
                computeLedger(statuses, 0),
                "Registro de tus pagos en los últimos meses:",
                VOS,
            ),
            [
                "Registro de tus pagos en los últimos meses:",
                "- Agosto: asististe 2 veces / no pagaste ❌",
                "- Septiembre: no asististe / pagaste el mes ❌",
                "- Octubre: asististe 1 vez / pagaste 1 sesión ❌",
                "Deuda pendiente: $60.000",
            ].join("\n"),
        );
    } finally {
        await cleanup();
    }
});

Deno.test("trainingsFor counts each slot-group's dates from training_sessions", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });

    const slots = await fetchTrainingSlots(admin);

    // The migration seeds every remaining Thursday of the 2026 second
    // semester: 4 in September, 5 in October — for every category and for
    // goalkeepers (the 21hs slot is goalie-friendly).
    for (const group of [["cat-a"], ["cat-c"], ["youth"]]) {
        const trainings = trainingsFor(slots, group, false);
        assertEquals(trainings.get("2026-09"), 4, group.join());
        assertEquals(trainings.get("2026-10"), 5, group.join());
    }
    const goalies = trainingsFor(slots, [], true);
    assertEquals(goalies.get("2026-09"), 4);

    // July (winter break) has no slots at all.
    assertEquals(activeMonths(slots).includes("2026-07"), false);
});

// ////////////////////////////////////
// THE TWO RUNTIMES AGREE
// ////////////////////////////////////

Deno.test("computeLedger y runLedger dan lo mismo: una sola implementación", async () => {
    // The bot reaches the ledger through computeLedger (month statuses with
    // their tariff already resolved); the dashboard reaches it through
    // runLedger (months plus a price table). Both now sit on the same
    // ledgerStep — this is what stops the bot from telling a player one number
    // while the admin sees another.
    //
    // The scenario characterises the CURRENT model, not the one in
    // docs/modelo-de-cobros.md: there, October's 150k could not be registered
    // as one payment at all — 60k would settle September's debt first and the
    // rest would be a partial month. Expect this test to change with tokens;
    // what must not change is that both entry points agree.
    const { runLedger } = await import("../_shared/ledger.ts");

    const months = ["2026-08", "2026-09", "2026-10"];
    const activity = [
        // Bought the month, a holiday shrank it: leaves a bonified session.
        { attended: 3, paidMonthly: true, totalPaid: 100000, trainings: 3 },
        // Spent the bonified one and underpaid the rest: contracts debt.
        { attended: 4, paidMonthly: false, totalPaid: 30000, trainings: 4 },
        // Overpays: covers the month first, and what is left eats into the
        // old debt without clearing it.
        { attended: 2, paidMonthly: false, totalPaid: 150000, trainings: 4 },
    ];

    const viaBot = computeLedger(
        activity.map((a, i) => raw(months[i], a.attended, a.totalPaid, {
            paidMonthly: a.paidMonthly,
            trainings: a.trainings,
        })),
        0,
    );

    const viaDashboard = runLedger(
        months,
        new Map(months.map((m, i) => [m, {
            attended: activity[i].attended,
            paidMonthly: activity[i].paidMonthly,
            totalPaid: activity[i].totalPaid,
        }])),
        new Map(months.map((m, i) => [m, activity[i].trainings])),
        [{ valid_from: "2026-01-01", session_price: 30000, prepaid_session_price: 25000 }],
        0,
    );

    assertEquals(
        viaBot.map((m) => [m.month, m.charge, m.debtAfter]),
        viaDashboard.rows.map((r) => [r.month, r.charge, r.debtAfter]),
    );
    // And the state each side carries forward matches too.
    assertEquals(viaBot.at(-1)!.carryoverOut, viaDashboard.state.carryoverIn);

    // A run that exercises something, not three no-ops: a bonified session
    // out of August, 60k of debt in September, and October paying 100k for the
    // month plus 50k against that debt — 10k still owing.
    assertEquals(viaBot[0].carryoverOut, 1);
    assertEquals(viaBot[1].debtAfter, 60000);
    assertEquals(viaBot[2].charge, 100000);
    assertEquals(viaBot[2].debtAfter, 10000);
});
