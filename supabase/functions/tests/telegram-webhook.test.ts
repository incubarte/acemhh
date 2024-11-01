import "jsr:@std/dotenv/load";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { assertEquals } from "jsr:@std/assert";

function createAdmin(): SupabaseClient {
    return createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
        {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
                detectSessionInUrl: false,
            },
        },
    );
}

Deno.test("test adding a player", async () => {
    const admin = createAdmin();

    // Invoke the 'hello-world' function with a parameter
    const DNI = "30111222";
    try {
        const { error } = await admin.functions
            .invoke("telegram-webhook", {
                body: {
                    "update_id": 331912543,
                    "test": true,
                    "message": {
                        "message_id": 30,
                        "from": {
                            "id": 45669763,
                            "is_bot": false,
                            "first_name": "Alejandro",
                            "last_name": "De Lio",
                            "username": "Migralito",
                            "language_code": "en",
                        },
                        "chat": {
                            "id": 45669763,
                            "first_name": "Alejandro",
                            "last_name": "De Lio",
                            "username": "Migralito",
                            "type": "private",
                        },
                        "date": 1730475323,
                        "text": "/rp  Alex  ,  Delight," + DNI + ",b  ",
                        "entities": [
                            {
                                "offset": 0,
                                "length": 3,
                                "type": "bot_command",
                            },
                        ],
                    },
                },
            });

        if (error) {
            throw new Error("Invalid response: " + error);
        }

        const { data: player_data, error: player_error } = await admin.from("players")
            .select("*")
            .eq('dni', DNI)
            .single();

        if (player_error) {
            throw new Error("Player not found in DB " + JSON.stringify(player_error));
        }

        // TODO pasar a variables
        // TODO ver el tema del alias
        assertEquals(player_data.alias, "alex222");
        assertEquals(player_data.name, "Alex");
        assertEquals(player_data.last_name, "Delight");
        assertEquals(player_data.category, "B");
        assertEquals(player_data.dni, DNI);
    } finally {
        await admin
            .from("players")
            .delete()
            .eq("dni", DNI);
    }
});
