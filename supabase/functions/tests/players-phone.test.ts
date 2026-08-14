// Integration tests for resolving a WhatsApp sender to players: by their own
// phone or as guardian of one or several minors. Mirrors the lookupPlayers
// query in the whatsapp-webhook. Run against the local Supabase stack:
//
//     supabase start
//     deno test -A supabase/functions/tests/players-phone.test.ts

import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { assertEquals } from "jsr:@std/assert";

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

// A parent who plays (self) and is also the guardian of a minor.
const SenderPhone = "5491199000201";
const OtherPhone = "5491199000209";

const Parent = {
    name: "__test-parent",
    last_name: "PhoneLookup",
    dni: "99000201",
    categories: ["cat-c"],
    phone: SenderPhone,
};
const Minor = {
    name: "__test-minor",
    last_name: "PhoneLookup",
    dni: "99000202",
    categories: ["youth"],
    guardian_phone: SenderPhone,
};
const Unrelated = {
    name: "__test-unrelated",
    last_name: "PhoneLookup",
    dni: "99000203",
    categories: ["cat-b"],
    phone: OtherPhone,
};
const AllDnis = [Parent.dni, Minor.dni, Unrelated.dni];

async function deleteTestPlayers(admin: SupabaseClient) {
    await admin.from("players").delete().in("dni", AllDnis);
}

// The exact query lookupPlayers runs in the whatsapp-webhook.
async function lookupByPhone(admin: SupabaseClient, waId: string) {
    const { data, error } = await admin
        .from("players")
        .select("id,name,last_name,categories,invitee,phone,guardian_phone")
        .or(`phone.eq.${waId},guardian_phone.eq.${waId}`);

    assertEquals(error, null);
    return (data ?? []).map((p) => ({
        name: p.name,
        relation: p.phone === waId ? "self" : "guardian",
    })).sort((a, b) => a.name.localeCompare(b.name));
}

Deno.test("a phone resolves to own player and guarded minors, and nothing else", async () => {
    const admin = createAdmin();
    try {
        await deleteTestPlayers(admin);
        const { error } = await admin.from("players").insert(
            [Parent, Minor, Unrelated].map((p) => ({
                ...p,
                player_type: "player",
                trains: true,
                invitee: false,
            })),
        );
        assertEquals(error, null);

        assertEquals(await lookupByPhone(admin, SenderPhone), [
            { name: Minor.name, relation: "guardian" },
            { name: Parent.name, relation: "self" },
        ]);

        // A number nobody registered resolves to no players at all.
        assertEquals(await lookupByPhone(admin, "5491199000299"), []);
    } finally {
        await deleteTestPlayers(admin);
    }
});
