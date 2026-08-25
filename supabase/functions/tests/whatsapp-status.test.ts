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
    type MonthStatus,
    periodMonths,
    priceFor,
    trainingsFor,
} from "../whatsapp-webhook/status.ts";
import { slotKey } from "../_shared/tokens.ts";

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
        { valid_from: "2026-01-01", session_price: 25000, prepaid_session_price: 20000, goalkeeper_session_price: 20000 },
        { valid_from: "2026-09-01", session_price: 30000, prepaid_session_price: 25000, goalkeeper_session_price: 25000 },
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

const PRICES = [{
    valid_from: "2026-01-01",
    session_price: 30000,
    prepaid_session_price: 25000,
    goalkeeper_session_price: 25000,
}];
const PLAYER = { goalkeeper: false, scholarship: 0 };
const SLOT = slotKey(4, 22);

/** A month of one slot: `trainings` sessions held, `attended` of them
 * attended, and the money as one payment of the given kind. The ledger rules
 * themselves live in tokens.test.ts; what is checked here is the wording. */
function raw(
    month: string,
    attended: number,
    totalPaid: number,
    opts: { paidMonthly?: boolean; trainings?: number } = {},
): MonthStatus {
    return {
        month,
        attended,
        totalPaid,
        sessionPrice: 30000,
        input: {
            attendances: Array.from({ length: attended }, () => ({ slot: SLOT })),
            payments: totalPaid > 0
                ? [{
                    concept: opts.paidMonthly ? "monthly" as const : "session" as const,
                    amount: totalPaid,
                    slot: SLOT,
                }]
                : [],
            sessionsPerSlot: new Map([[SLOT, opts.trainings ?? 4]]),
        },
    };
}

/** The ledger over a run of months, as the reply sees it. */
function ledgerOf(...statuses: MonthStatus[]) {
    return computeLedger(statuses, PRICES, PLAYER);
}

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
    const ledger = ledgerOf(
        raw("2026-08", 1, 0), // 30k de deuda
        // Le cobraron 4 sesiones y el mes tuvo 3: paga el mes y le queda una
        // bonificada. Lo pagado de más NO salda la deuda vieja — para eso hay
        // un concepto propio.
        raw("2026-09", 3, 100000, { trainings: 3, paidMonthly: true }),
    );

    assertEquals(buildPlayerSection(ledger, "Registro:", VOS), [
        "Registro:",
        "- Agosto: asististe 1 vez / no pagaste ❌",
        "- Septiembre: asististe 3 veces / pagaste el mes ❌",
        "Tenés 1 sesión bonificada para el mes que viene",
        "Deuda pendiente: $30.000",
    ].join("\n"));
});

Deno.test("buildPlayerSection: bonified sessions for the coming month", () => {
    const ledger = ledgerOf(
        raw("2026-08", 3, 100000, { trainings: 3, paidMonthly: true }),
    );

    assertEquals(buildPlayerSection(ledger, "Registro:", VOS), [
        "Registro:",
        "- Agosto: asististe 3 veces / pagaste el mes ✅",
        "Tenés 1 sesión bonificada para el mes que viene",
    ].join("\n"));
});

Deno.test("buildPlayerSection: bonified sessions still usable this month", () => {
    const ledger = ledgerOf(
        raw("2026-08", 3, 100000, { trainings: 3, paidMonthly: true }),
        raw("2026-09", 0, 0),
    );

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
                slot_weekday: 4,
                slot_hour: 22,
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
                slot_weekday: 4,
                slot_hour: 22,
                session: "2026-10-08 22hs",
                month: "2026-10",
                amount: 30000,
                is_cash: true,
            },
        ]);
        if (payError) throw new Error(JSON.stringify(payError));

        // Tariff and agenda both come from the database, the same way the
        // reply builds them.
        const prices = await fetchPrices(admin);
        const slots = await fetchTrainingSlots(admin);
        const billing = { goalkeeper: false, categories: ["cat-b"], scholarship: 0 };
        const statuses = await fetchMonthStatuses(
            admin,
            playerId,
            ["2026-08", "2026-09", "2026-10"],
            prices,
            slots,
            billing,
        );

        // August's unpaid sessions stay as debt: September's prepaid month
        // covers only itself (use-it-or-lose-it) and October's session covers
        // October.
        assertEquals(
            buildPlayerSection(
                computeLedger(statuses, prices, billing),
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

    // Every Thursday of the season: 4 in September, 5 in October — for every
    // category and for goalkeepers (the 21hs slot is goalie-friendly).
    for (const group of [["cat-a"], ["cat-c"], ["youth"]]) {
        const trainings = trainingsFor(slots, group, false);
        assertEquals(trainings.get("2026-09"), 4, group.join());
        assertEquals(trainings.get("2026-10"), 5, group.join());
    }
    const goalies = trainingsFor(slots, [], true);
    assertEquals(goalies.get("2026-09"), 4);

    // July is a training month — the winter break falls inside it, not around
    // it: the season stops after Thursday the 9th and resumes on August 6th.
    // So cat-c trains once in July and goalkeepers twice, and July closes the
    // first period, so none of it follows anybody into August.
    assertEquals(activeMonths(slots).includes("2026-07"), true);
    assertEquals(trainingsFor(slots, ["cat-c"], false).get("2026-07"), 1);
    assertEquals(trainingsFor(slots, [], true).get("2026-07"), 2);
    assertEquals(monthsWindow("2026-08", activeMonths(slots)), ["2026-08"]);
});
