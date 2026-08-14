// Integration tests for users.phone, the column that correlates a
// dashboard/Telegram admin with a WhatsApp sender (wa_id). Run against the
// local Supabase stack:
//
//     supabase start
//     deno test -A supabase/functions/tests/users-phone.test.ts

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

// Real Telegram ids are currently ~10 digits; 14 digits keeps these clear of
// any real users row.
const TEST_IDS = [99000000000001, 99000000000002];

async function deleteTestUsers(admin: SupabaseClient) {
    await admin.from("users").delete().in("id", TEST_IDS);
}

Deno.test("a WhatsApp sender resolves to the dashboard admin by phone", async () => {
    const admin = createAdmin();
    const waId = "5491199000001"; // what Meta sends as wa_id: E.164 without +
    try {
        await deleteTestUsers(admin);
        const { error } = await admin.from("users").insert([
            { id: TEST_IDS[0], first_name: "__test-admin", phone: waId },
        ]);
        assertEquals(error, null);

        // Same query the whatsapp-webhook lookupAdmin runs.
        const { data, error: lookupError } = await admin.from("users")
            .select("id,first_name")
            .eq("phone", waId)
            .maybeSingle();

        assertEquals(lookupError, null);
        assertEquals(data!.id, TEST_IDS[0]);
        assertEquals(data!.first_name, "__test-admin");
    } finally {
        await deleteTestUsers(admin);
    }
});

Deno.test("two admins cannot share a phone", async () => {
    const admin = createAdmin();
    const waId = "5491199000002";
    try {
        await deleteTestUsers(admin);
        const { error: firstError } = await admin.from("users").insert([
            { id: TEST_IDS[0], first_name: "__test-admin", phone: waId },
        ]);
        assertEquals(firstError, null);

        const { error } = await admin.from("users").insert([
            { id: TEST_IDS[1], first_name: "__test-admin-2", phone: waId },
        ]);
        assert(error, "duplicate phone must fail");
        assertEquals(error!.code, "23505");
    } finally {
        await deleteTestUsers(admin);
    }
});

Deno.test("a phone that is not wa_id-shaped is rejected", async () => {
    const admin = createAdmin();
    try {
        await deleteTestUsers(admin);
        const { error } = await admin.from("users").insert([
            // Leading + is not stored: wa_id comes without it.
            { id: TEST_IDS[0], first_name: "__test-admin", phone: "+5491199000003" },
        ]);
        assert(error, "insert with a + prefixed phone must fail");
        assert(
            error!.message.includes("users_phone_check"),
            "unexpected error: " + error!.message,
        );
    } finally {
        await deleteTestUsers(admin);
    }
});
