// Integration tests for the money-movements schema: expenses, cash handoffs
// and the caja balance math. Run against the local Supabase stack:
//
//     supabase start
//     deno test -A supabase/functions/tests/money-movements.test.ts

import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { assert, assertEquals } from "jsr:@std/assert";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

function createAdmin(): SupabaseClient {
    return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
            detectSessionInUrl: false,
        },
    });
}

const TestName = "__test-money";
const PlayerDni = "99000301";

type Ids = { userA: string; userB: string; playerId: string };

async function cleanup(admin: SupabaseClient) {
    const { data: users } = await admin.from("users").select("id").eq("first_name", TestName);
    const userIds = (users ?? []).map((u) => u.id);
    if (userIds.length > 0) {
        await admin.from("cash_handoffs").delete().in("from_user", userIds);
        await admin.from("expenses").delete().in("paid_by", userIds);
        await admin.from("payments").delete().in("registered_by_user_id", userIds);
        await admin.from("users").delete().in("id", userIds);
    }
    await admin.from("players").delete().eq("dni", PlayerDni);
}

async function setup(admin: SupabaseClient): Promise<Ids> {
    await cleanup(admin);
    const { data: users, error: usersError } = await admin.from("users")
        .insert([
            { first_name: TestName, last_name: "A", groups: ["WHEEL"] },
            { first_name: TestName, last_name: "B", groups: ["WHEEL"] },
        ])
        .select("id,last_name");
    if (usersError) throw new Error(JSON.stringify(usersError));

    const { data: player, error: playerError } = await admin.from("players")
        .insert([{
            name: "__test",
            last_name: "Money",
            dni: PlayerDni,
            categories: ["cat-c"],
            player_type: "player",
            trains: true,
            invitee: false,
        }])
        .select("id")
        .single();
    if (playerError) throw new Error(JSON.stringify(playerError));

    return {
        userA: users!.find((u) => u.last_name === "A")!.id,
        userB: users!.find((u) => u.last_name === "B")!.id,
        playerId: player!.id,
    };
}

Deno.test("membership dues cannot be registered as cash", async () => {
    const admin = createAdmin();
    try {
        const ids = await setup(admin);
        const { error } = await admin.from("payments").insert([{
            id: crypto.randomUUID(),
            player_id: ids.playerId,
            registered_by: TestName,
            registered_by_user_id: ids.userA,
            concept: "membership dues",
            month: "2026-08",
            amount: 1000,
            is_cash: true,
        }]);
        assert(error, "cash membership dues must be rejected");
        assert(
            error!.message.includes("payments_dues_not_cash"),
            "unexpected error: " + error!.message,
        );
    } finally {
        await cleanup(admin);
    }
});

Deno.test("a handoff to oneself is rejected", async () => {
    const admin = createAdmin();
    try {
        const ids = await setup(admin);
        const { error } = await admin.from("cash_handoffs").insert([{
            amount: 100,
            from_user: ids.userA,
            to_user: ids.userA,
        }]);
        assert(error, "self handoff must be rejected");
    } finally {
        await cleanup(admin);
    }
});

// The same aggregation /api/caja runs: cash income minus cash expenses minus
// given plus received handoffs — accepted only, dues and bank payments never.
Deno.test("caja balances add up", async () => {
    const admin = createAdmin();
    try {
        const ids = await setup(admin);

        const insert = async (table: string, rows: unknown[]) => {
            const { error } = await admin.from(table).insert(rows);
            if (error) throw new Error(`${table}: ${JSON.stringify(error)}`);
        };

        await insert("payments", [
            // Cash session payment: counts for A.
            {
                id: crypto.randomUUID(),
                player_id: ids.playerId,
                registered_by: TestName,
                registered_by_user_id: ids.userA,
                concept: "session",
                session: "2026-08-13 22hs",
                month: "2026-08",
                amount: 5000,
                is_cash: true,
            },
            // Bank dues: counts for nobody.
            {
                id: crypto.randomUUID(),
                player_id: ids.playerId,
                registered_by: TestName,
                registered_by_user_id: ids.userA,
                concept: "membership dues",
                month: "2026-08",
                amount: 9999,
                is_cash: false,
            },
        ]);
        await insert("expenses", [
            { amount: 2000, concept: "alquiler pista", payee: "pista", paid_by: ids.userA, is_cash: true },
            // Bank expense: touches no caja.
            { amount: 7777, concept: "alquiler pista", payee: "pista", paid_by: ids.userA, is_cash: false },
        ]);
        await insert("cash_handoffs", [
            { amount: 1000, from_user: ids.userA, to_user: ids.userB, accepted_at: new Date().toISOString() },
            // Pending: moves nothing yet.
            { amount: 500, from_user: ids.userA, to_user: ids.userB },
        ]);

        const [payments, expenses, handoffs] = await Promise.all([
            admin.from("payments").select("registered_by_user_id,amount")
                .eq("is_cash", true).not("registered_by_user_id", "is", null),
            admin.from("expenses").select("paid_by,amount").eq("is_cash", true),
            admin.from("cash_handoffs").select("amount,from_user,to_user,accepted_at"),
        ]);

        const balance = new Map<string, number>([[ids.userA, 0], [ids.userB, 0]]);
        const add = (id: string | null, delta: number) => {
            if (id && balance.has(id)) balance.set(id, balance.get(id)! + delta);
        };
        for (const p of payments.data ?? []) add(p.registered_by_user_id, Number(p.amount));
        for (const e of expenses.data ?? []) add(e.paid_by, -Number(e.amount));
        for (const h of handoffs.data ?? []) {
            if (!h.accepted_at) continue;
            add(h.from_user, -Number(h.amount));
            add(h.to_user, Number(h.amount));
        }

        assertEquals(balance.get(ids.userA), 5000 - 2000 - 1000);
        assertEquals(balance.get(ids.userB), 1000);
    } finally {
        await cleanup(admin);
    }
});
