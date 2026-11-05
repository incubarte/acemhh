// What the Telegram group sees when someone writes to the WhatsApp number.
//
//     deno test -A supabase/functions/tests/whatsapp-inbox.test.ts

import { assertEquals } from "jsr:@std/assert";
import { inboxMessage, senderLine } from "../whatsapp-webhook/inbox.ts";

const JUAN = { kind: "player" as const, name: "Juan", lastName: "Pérez" };

Deno.test("inboxMessage: quién escribió, el link para contestarle y lo que dijo", () => {
    assertEquals(
        inboxMessage({ waId: "5491111111111", sender: JUAN, kind: "text", text: "ya pagué", reminders: [] }),
        "📩 WhatsApp de Juan Pérez\nhttps://wa.me/5491111111111\n\nya pagué",
    );
});

Deno.test("inboxMessage: el recordatorio que probablemente está contestando", () => {
    const text = inboxMessage({
        waId: "5492222222222",
        sender: { kind: "guardian", of: [{ name: "Elias", lastName: "Gómez" }, { name: "Ana", lastName: "Gómez" }] },
        kind: "text",
        text: "lo transferí ayer",
        reminders: [
            { sent_on: "2026-11-12", player_name: "Elias", closed_debt: 70000, month_debt: 0 },
            { sent_on: "2026-11-12", player_name: "Ana", closed_debt: 30000, month_debt: 35000 },
        ],
    });
    assertEquals(text.split("\n"), [
        "📩 WhatsApp de tutor de Elias Gómez y Ana Gómez",
        "https://wa.me/5492222222222",
        "Recordatorio del 12/11 por Elias: $70.000 de meses anteriores",
        "Recordatorio del 12/11 por Ana: $30.000 de meses anteriores y $35.000 del mes",
        "",
        "lo transferí ayer",
    ]);
});

Deno.test("inboxMessage: un audio o una imagen se avisa, no se reenvía", () => {
    const text = inboxMessage({ waId: "549", sender: JUAN, kind: "audio", text: null, reminders: [] });
    assertEquals(text.split("\n").at(-1), "(mandó un audio, que no se puede reenviar)");
    const odd = inboxMessage({ waId: "549", sender: JUAN, kind: "reaction", text: null, reminders: [] });
    assertEquals(odd.split("\n").at(-1), "(mandó un mensaje de tipo reaction, que no se puede reenviar)");
});

Deno.test("senderLine: un número que no está en ninguna tabla", () => {
    assertEquals(senderLine({ kind: "unknown" }), "número que no conocemos");
});
