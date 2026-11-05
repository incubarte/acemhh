// The WhatsApp inbox as Telegram topics: what each topic shows, and what the
// club's messages in it do.
//
//     deno test -A supabase/functions/tests/whatsapp-inbox.test.ts

import { assertEquals } from "jsr:@std/assert";
import {
    clubIsAnswering,
    conversationSeparator,
    inboundPost,
    relayDecision,
    reminderPost,
    reminderSummary,
    senderLine,
    startsNewConversation,
    topicName,
} from "../whatsapp-webhook/inbox.ts";
import { renderReminder, reminderWho } from "../_shared/reminderTemplate.ts";

const JUAN = { kind: "player" as const, name: "Juan", lastName: "Pérez" };
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = new Date("2026-11-12T15:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

Deno.test("topicName: el jugador, el tutor, o el número", () => {
    assertEquals(topicName(JUAN, "549111"), "Juan Pérez");
    assertEquals(
        topicName({ kind: "guardian", of: [{ name: "Elias", lastName: "Gómez" }, { name: "Ana", lastName: "Gómez" }] }, "549111"),
        "Tutor de Elias Gómez y Ana Gómez",
    );
    assertEquals(topicName({ kind: "unknown" }, "5491100000000"), "+5491100000000");
    assertEquals(senderLine({ kind: "unknown" }), "número que no conocemos");
});

Deno.test("reminderPost: el recordatorio tal como le llegó al teléfono", () => {
    const text = renderReminder([reminderWho("guardian", "Elias"), "$70.000 de meses anteriores"]);
    assertEquals(
        reminderPost("2026-11-12", text),
        "📤 Recordatorio que le mandó el club el 12/11:\n\n" +
            "Hola! Te escribimos del club porque la cuenta de Elias tiene un saldo pendiente de " +
            "$70.000 de meses anteriores. Hoy hay entrenamiento y se puede regularizar ahí. " +
            "Si ya está pago, respondé este mensaje y lo revisamos.",
    );
});

Deno.test("inboundPost: el texto, o el aviso de lo que no se puede reenviar", () => {
    assertEquals(inboundPost("text", "ya pagué"), "📩 ya pagué");
    assertEquals(inboundPost("audio", null), "📩 (mandó un audio, que no se puede reenviar)");
    assertEquals(inboundPost("reaction", null), "📩 (mandó un mensaje de tipo reaction, que no se puede reenviar)");
});

Deno.test("relayDecision: sale el texto dentro de las 24h", () => {
    const base = { fromBot: false, text: "hola, lo vemos", hasMedia: false, lastInboundAt: ago(HOUR), now: NOW, windowMs: DAY };
    assertEquals(relayDecision(base), "send");
    assertEquals(relayDecision({ ...base, lastInboundAt: ago(DAY + 1) }), "window");
    assertEquals(relayDecision({ ...base, lastInboundAt: null }), "window");
});

Deno.test("relayDecision: los comentarios con // quedan en el grupo", () => {
    const base = { fromBot: false, hasMedia: false, lastInboundAt: ago(HOUR), now: NOW, windowMs: DAY };
    assertEquals(relayDecision({ ...base, text: "// este ya pagó, fijate la caja" }), "ignore");
    assertEquals(relayDecision({ ...base, text: "  //ojo" }), "ignore");
    // Two slashes further in are just text.
    assertEquals(relayDecision({ ...base, text: "mirá https://x.com" }), "send");
});

Deno.test("relayDecision: adjuntos se avisan, los del bot y los de servicio se ignoran", () => {
    const base = { fromBot: false, lastInboundAt: ago(HOUR), now: NOW, windowMs: DAY };
    assertEquals(relayDecision({ ...base, text: null, hasMedia: true }), "not-text");
    assertEquals(relayDecision({ ...base, text: null, hasMedia: false }), "ignore");
    assertEquals(relayDecision({ ...base, text: "hola", hasMedia: false, fromBot: true }), "ignore");
});

Deno.test("clubIsAnswering: la respuesta automática calla mientras el club habla", () => {
    assertEquals(clubIsAnswering(ago(HOUR), NOW, DAY), true);
    assertEquals(clubIsAnswering(ago(DAY), NOW, DAY), false);
    assertEquals(clubIsAnswering(null, NOW, DAY), false);
});

Deno.test("startsNewConversation: después de 24h sin movimiento va el separador", () => {
    assertEquals(startsNewConversation(ago(2 * DAY), ago(DAY + HOUR), NOW, DAY), true);
    // The club wrote an hour ago: same conversation, whatever the person did.
    assertEquals(startsNewConversation(ago(2 * DAY), ago(HOUR), NOW, DAY), false);
    assertEquals(startsNewConversation(ago(HOUR), null, NOW, DAY), false);
    // A topic with nothing on record has nothing to separate from.
    assertEquals(startsNewConversation(null, null, NOW, DAY), false);
    assertEquals(conversationSeparator("2026-11-12"), "━━━━━━━━  12/11  ━━━━━━━━");
});

Deno.test("reminderSummary: enviados y fallidos, para el General", () => {
    assertEquals(
        reminderSummary("2026-11-12", [
            { player: "Juan Pérez", relation: "self", detail: "$35.000 de noviembre", ok: true },
            { player: "Elias Gómez", relation: "guardian", detail: "$70.000 de meses anteriores", ok: true },
            { player: "Ana Ruiz", relation: "self", detail: "$30.000 de meses anteriores", ok: false, error: "400 template not found" },
        ]).split("\n"),
        [
            "📤 Recordatorios del 12/11: 2 enviados, 1 fallido",
            "",
            "- Juan Pérez: $35.000 de noviembre",
            "- Elias Gómez (al tutor): $70.000 de meses anteriores",
            "",
            "No llegaron:",
            "- Ana Ruiz: $30.000 de meses anteriores",
            "  400 template not found",
        ],
    );
});
