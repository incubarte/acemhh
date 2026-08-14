// Integration tests for the players.categories migration (multi-category,
// ordered by priority). They run against the local Supabase stack:
//
//     supabase start
//     deno test -A supabase/functions/tests/players-categories.test.ts
//
// Each test inserts its own players (marked with __test names and reserved
// DNIs) and removes them in finally, so they can run against a seeded DB.

import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { assert, assertEquals } from "jsr:@std/assert";

// Fall back to the well-known local dev credentials so `deno test -A` works
// out of the box; env vars still win if set.
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

type TestPlayer = {
    name: string;
    last_name: string;
    dni: string;
    categories: string[];
};

function testPlayer(dni: string, categories: string[]): TestPlayer {
    return { name: "__test", last_name: `dni-${dni}`, dni, categories };
}

async function insertPlayers(admin: SupabaseClient, players: TestPlayer[]) {
    const { error } = await admin.from("players").insert(
        players.map((p) => ({
            ...p,
            player_type: "player",
            trains: true,
            invitee: false,
        })),
    );
    if (error) throw new Error("Insert failed: " + JSON.stringify(error));
}

async function deletePlayers(admin: SupabaseClient, players: TestPlayer[]) {
    await admin.from("players").delete().in("dni", players.map((p) => p.dni));
}

Deno.test("categories keep their priority order", async () => {
    const admin = createAdmin();
    const player = testPlayer("99000001", ["cat-b", "cat-c", "youth"]);
    try {
        await insertPlayers(admin, [player]);

        const { data, error } = await admin.from("players")
            .select("categories")
            .eq("dni", player.dni)
            .single();

        assertEquals(error, null);
        assertEquals(data!.categories, ["cat-b", "cat-c", "youth"]);
    } finally {
        await deletePlayers(admin, [player]);
    }
});

// Mirrors /api/players?category=... : .contains("categories", [cat])
Deno.test("contains finds a player by any of their categories", async () => {
    const admin = createAdmin();
    const multi = testPlayer("99000002", ["cat-a", "cat-b"]);
    const single = testPlayer("99000003", ["cat-c"]);
    try {
        await insertPlayers(admin, [multi, single]);

        for (const cat of ["cat-a", "cat-b"]) {
            const { data, error } = await admin.from("players")
                .select("dni")
                .contains("categories", [cat]);

            assertEquals(error, null);
            const dnis = data!.map((p) => p.dni);
            assert(dnis.includes(multi.dni), `expected match for ${cat}`);
            assert(!dnis.includes(single.dni), `cat-c player must not match ${cat}`);
        }
    } finally {
        await deletePlayers(admin, [multi, single]);
    }
});

// Mirrors the training-session roster: .overlaps("categories", slotCats).
// A player shows up in the sessions of every category they belong to.
Deno.test("overlaps builds the roster for a slot with several categories", async () => {
    const admin = createAdmin();
    const multi = testPlayer("99000004", ["cat-a", "cat-b"]);
    const catC = testPlayer("99000005", ["cat-c"]);
    const catBAndC = testPlayer("99000006", ["cat-b", "cat-c"]);
    const all = [multi, catC, catBAndC];
    try {
        await insertPlayers(admin, all);

        // Slot "jue 22hs" in the new schedule: cat-a + cat-b.
        const { data, error } = await admin.from("players")
            .select("dni")
            .overlaps("categories", ["cat-a", "cat-b"])
            .in("dni", all.map((p) => p.dni));

        assertEquals(error, null);
        const dnis = data!.map((p) => p.dni).sort();
        // multi matches both slot categories but must appear exactly once.
        assertEquals(dnis, [multi.dni, catBAndC.dni].sort());

        // Slot "jue 23hs": cat-c only.
        const { data: dataC, error: errorC } = await admin.from("players")
            .select("dni")
            .overlaps("categories", ["cat-c"])
            .in("dni", all.map((p) => p.dni));

        assertEquals(errorC, null);
        assertEquals(dataC!.map((p) => p.dni).sort(), [catC.dni, catBAndC.dni].sort());
    } finally {
        await deletePlayers(admin, all);
    }
});

Deno.test("a player without categories is rejected by the DB", async () => {
    const admin = createAdmin();
    const player = testPlayer("99000007", []);
    try {
        const { error } = await admin.from("players").insert([{
            ...player,
            player_type: "player",
            trains: true,
            invitee: false,
        }]);

        assert(error, "insert with empty categories must fail");
        assert(
            error!.message.includes("players_categories_not_empty"),
            "unexpected error: " + error!.message,
        );
    } finally {
        await deletePlayers(admin, [player]);
    }
});

Deno.test("a blank category is rejected by the DB", async () => {
    const admin = createAdmin();
    const player = testPlayer("99000008", ["cat-b", ""]);
    try {
        const { error } = await admin.from("players").insert([{
            ...player,
            player_type: "player",
            trains: true,
            invitee: false,
        }]);

        assert(error, "insert with a blank category must fail");
        assert(
            error!.message.includes("players_categories_no_blanks"),
            "unexpected error: " + error!.message,
        );
    } finally {
        await deletePlayers(admin, [player]);
    }
});

// The old column was renamed on purpose so stale queries fail loudly instead
// of silently excluding multi-category players. This pins that guarantee.
Deno.test("querying the old category column fails loudly", async () => {
    const admin = createAdmin();

    const { error: selectError } = await admin.from("players")
        .select("id,category")
        .limit(1);
    assert(selectError, "selecting players.category must error");

    const { error: filterError } = await admin.from("players")
        .select("id")
        .eq("category", "cat-b")
        .limit(1);
    assert(filterError, "filtering by players.category must error");
});

Deno.test("no player is left in the retired u-14 category", async () => {
    const admin = createAdmin();

    const { data, error } = await admin.from("players")
        .select("dni")
        .contains("categories", ["u-14"]);

    assertEquals(error, null);
    assertEquals(data, []);
});
