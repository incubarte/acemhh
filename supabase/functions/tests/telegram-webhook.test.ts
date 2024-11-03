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

    const Name = "Alex";
    const LastName = "Delight";
    const Document = "30111222";
    const Category = "B";
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
                        "text": `/rp  ${Name}  ,  ${LastName},` + Document + `,${Category.toLowerCase()}  `,
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
            .eq('dni', Document)
            .single();

        if (player_error) {
            throw new Error("Player not found in DB " + JSON.stringify(player_error));
        }

        assertEquals(player_data.alias, `${Name.toLowerCase()}${Document.slice(-3)}`);
        assertEquals(player_data.name, Name);
        assertEquals(player_data.last_name, LastName);
        assertEquals(player_data.category, Category);
        assertEquals(player_data.dni, Document);
    } finally {
        await admin
            .from("players")
            .delete()
            .eq("dni", Document);
    }
});

Deno.test("test adding a payment", async () => {
    const admin = createAdmin();

    // Invoke the 'hello-world' function with a parameter
    const DNI = "30111888";

    const { data, error } = await admin
        .from("players")
        .insert([{
            name : "Alexis",
            last_name: "Delpe",
            dni: DNI,
            category: "B",
            alias: "Alexis888",
        }])
        .select().single();

    if (error) {
        console.error(error);
        throw new Error(error.message);
    }

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
                        "text": "/pago " + DNI + " , 40k  ",
                        "entities": [
                            {
                                "offset": 0,
                                "length": 5,
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

        const { data: payment_data, error: payment_error } = await admin.from("payments")
            .select("*")
            .eq('player_id', player_data.id)
            .single();

        if (payment_error) {
            throw new Error("Payment not found in DB " + JSON.stringify(player_error));
        }

        // TODO pasar a variables
        // TODO ver el tema del alias
        assertEquals(payment_data.player_id, player_data.id);
        assertEquals(payment_data.amount, 40000);
    } finally {

        const { data: player_data, error: player_error } = await admin.from("players")
            .select("*")
            .eq('dni', DNI)
            .single();

        await admin
            .from("payments")
            .delete()
            .eq("player_id", player_data.id);

        await admin
            .from("players")
            .delete()
            .eq("dni", DNI);
    }
});
