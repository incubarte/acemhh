// Tests for the WhatsApp auto-reply status: the months window over the
// activity agenda, the per-month wording, and the DB aggregation. The pure
// parts need no stack; the last test runs against local Supabase:
//
//     supabase start
//     deno test -A supabase/functions/tests/whatsapp-status.test.ts

import { createClient } from "jsr:@supabase/supabase-js@2";
import { assertEquals } from "jsr:@std/assert";
import {
    buildPlayerSection,
    fetchMonthStatuses,
    formatMonthLine,
    monthsWindow,
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

Deno.test("monthsWindow: never crosses into the previous semester", () => {
    const agenda = ["2026-03", "2026-04", "2026-05", "2026-06", ...AGENDA_2026_S2];
    // August only sees August, even with active months in the first semester.
    assertEquals(monthsWindow("2026-08", agenda), ["2026-08"]);
    assertEquals(monthsWindow("2026-05", agenda), ["2026-03", "2026-04", "2026-05"]);
});

const VOS = { voice: "vos" as const, fullScholarship: false };
const EL = { voice: "el" as const, fullScholarship: false };
const BECA = { voice: "vos" as const, fullScholarship: true };

Deno.test("formatMonthLine: attendance and payment as separate parts", () => {
    const base = { month: "2026-08", attended: 0, paidMonthly: false, totalPaid: 0 };

    // Monthly payment always checks, whatever the attendance.
    assertEquals(
        formatMonthLine({ ...base, attended: 2, paidMonthly: true, totalPaid: 45000 }, VOS),
        "- Agosto: asististe 2 veces / pagaste el mes ✅",
    );
    assertEquals(
        formatMonthLine({ ...base, paidMonthly: true, totalPaid: 45000 }, VOS),
        "- Agosto: no asististe / pagaste el mes ✅",
    );
    // A partial payment covers floor(total / 30k) sessions.
    assertEquals(
        formatMonthLine({ ...base, attended: 1, totalPaid: 30000 }, VOS),
        "- Agosto: asististe 1 vez / pagaste 1 sesión ✅",
    );
    assertEquals(
        formatMonthLine({ ...base, attended: 3, totalPaid: 60000 }, VOS),
        "- Agosto: asististe 3 veces / pagaste 2 sesiones ❌",
    );
    // Below one session's worth, the raw amount is shown and covers nothing.
    assertEquals(
        formatMonthLine({ ...base, attended: 1, totalPaid: 15000 }, VOS),
        "- Agosto: asististe 1 vez / pagaste $15.000 ❌",
    );
    // No payment: cross only if they actually attended.
    assertEquals(
        formatMonthLine({ ...base, attended: 2 }, VOS),
        "- Agosto: asististe 2 veces / no pagaste ❌",
    );
    assertEquals(formatMonthLine(base, VOS), "- Agosto: no asististe");
});

Deno.test("formatMonthLine: full scholarship reports attendance only", () => {
    const base = { month: "2026-08", attended: 0, paidMonthly: false, totalPaid: 0 };

    assertEquals(
        formatMonthLine({ ...base, attended: 2 }, BECA),
        "- Agosto: asististe 2 veces y tenés beca ✅",
    );
    assertEquals(
        formatMonthLine(base, BECA),
        "- Agosto: no asististe aunque tenés beca",
    );
});

Deno.test("formatMonthLine: third person for guardians", () => {
    const base = { month: "2026-09", attended: 1, paidMonthly: true, totalPaid: 45000 };

    assertEquals(
        formatMonthLine(base, EL),
        "- Septiembre: asistió 1 vez / pagó el mes ✅",
    );
    assertEquals(
        formatMonthLine({ ...base, paidMonthly: false, totalPaid: 0 }, EL),
        "- Septiembre: asistió 1 vez / no pagó ❌",
    );
    assertEquals(
        formatMonthLine({ ...base, attended: 0, paidMonthly: false, totalPaid: 0 }, {
            voice: "el",
            fullScholarship: true,
        }),
        "- Septiembre: no asistió aunque tiene beca",
    );
});

Deno.test("buildPlayerSection: empty window means no section at all", () => {
    assertEquals(buildPlayerSection([], "Registro:", VOS), null);
});

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
                amount: 40000,
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

        const statuses = await fetchMonthStatuses(
            admin,
            playerId,
            ["2026-08", "2026-09", "2026-10"],
        );

        assertEquals(
            buildPlayerSection(statuses, "Registro de tus pagos en los últimos meses:", VOS),
            [
                "Registro de tus pagos en los últimos meses:",
                "- Agosto: asististe 2 veces / no pagaste ❌",
                "- Septiembre: no asististe / pagaste el mes ✅",
                "- Octubre: asististe 1 vez / pagaste 1 sesión ✅",
            ].join("\n"),
        );
    } finally {
        await cleanup();
    }
});
