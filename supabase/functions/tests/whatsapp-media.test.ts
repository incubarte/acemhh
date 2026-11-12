// What the inbox topic shows of WhatsApp messages that are not text: files,
// locations, contact cards and reactions. Pure, no stack needed:
//
//     deno test -A supabase/functions/tests/whatsapp-media.test.ts

import { assertEquals } from "jsr:@std/assert";
import {
    mediaCaption,
    mediaOf,
    reactionOf,
    reactionPost,
    sharedText,
    uploadFor,
    uploadName,
} from "../whatsapp-webhook/media.ts";
import { inboundPost } from "../whatsapp-webhook/inbox.ts";

const voice = { type: "audio", audio: { id: "m1", mime_type: "audio/ogg; codecs=opus", voice: true } };
const photo = { type: "image", image: { id: "m2", mime_type: "image/jpeg", caption: "  el comprobante " } };
const pdf = { type: "document", document: { id: "m3", mime_type: "application/pdf", filename: "transferencia.pdf" } };

Deno.test("mediaOf: el archivo y lo que trae", () => {
    assertEquals(mediaOf(voice), { kind: "audio", id: "m1", mime: "audio/ogg; codecs=opus", caption: null, filename: null, voice: true });
    assertEquals(mediaOf(photo)?.caption, "el comprobante");
    assertEquals(mediaOf(pdf)?.filename, "transferencia.pdf");
    assertEquals(mediaOf({ type: "text", text: { body: "hola" } }), null);
    assertEquals(mediaOf({ type: "image", image: {} }), null);
});

Deno.test("uploadFor: cada cosa como Telegram la muestra, y lo raro como documento", () => {
    const of = (type: string, mime: string) => uploadFor(mediaOf({ type, [type]: { id: "x", mime_type: mime } })!).method;
    assertEquals(of("audio", "audio/ogg; codecs=opus"), "sendVoice");
    assertEquals(of("audio", "audio/mpeg"), "sendAudio");
    assertEquals(of("audio", "audio/amr"), "sendDocument");
    assertEquals(of("image", "image/jpeg"), "sendPhoto");
    assertEquals(of("video", "video/mp4"), "sendVideo");
    assertEquals(of("video", "video/3gpp"), "sendDocument");
    assertEquals(of("sticker", "image/webp"), "sendSticker");
    assertEquals(of("document", "application/pdf"), "sendDocument");
});

Deno.test("uploadName y mediaCaption: el nombre del archivo y la marca de que es suyo", () => {
    assertEquals(uploadName(mediaOf(pdf)!), "transferencia.pdf");
    assertEquals(uploadName(mediaOf(voice)!), "audio.ogg");
    assertEquals(mediaCaption(mediaOf(photo)!), "📩 el comprobante");
    assertEquals(mediaCaption(mediaOf(voice)!), "📩");
    assertEquals(mediaCaption(mediaOf({ type: "sticker", sticker: { id: "s", mime_type: "image/webp" } })!), null);
});

Deno.test("sharedText: ubicación y contactos, como texto", () => {
    assertEquals(
        sharedText({ type: "location", location: { latitude: -34.6, longitude: -58.4, name: "Pista" } }),
        "📍 Pista: https://maps.google.com/?q=-34.6,-58.4",
    );
    assertEquals(
        sharedText({ type: "contacts", contacts: [{ name: { formatted_name: "Mamá" }, phones: [{ phone: "+54 9 11 1234" }] }] }),
        "👤 Mamá: +54 9 11 1234",
    );
    assertEquals(sharedText({ type: "text" }), null);
});

Deno.test("reactionPost: la reacción, y a qué fue", () => {
    const r = reactionOf({ type: "reaction", reaction: { message_id: "wamid.1", emoji: "👍" } })!;
    assertEquals(r, { messageId: "wamid.1", emoji: "👍" });
    assertEquals(reactionPost(r, { kind: "topic" }), "📩 reaccionó 👍");
    assertEquals(reactionPost(r, { kind: "reminder", sentOn: "2026-11-12" }), "📩 reaccionó 👍 al recordatorio del 12/11");
    assertEquals(reactionPost(r, { kind: "receipt", sentOn: "2026-11-13" }), "📩 reaccionó 👍 al aviso de pago del 13/11");
    assertEquals(reactionPost(r, { kind: "earlier" }), "📩 reaccionó 👍 a un mensaje anterior de la conversación");
    assertEquals(reactionPost(r, { kind: "other" }), "📩 reaccionó 👍 a un mensaje automático del club");
    const removed = reactionOf({ type: "reaction", reaction: { message_id: "wamid.1" } })!;
    assertEquals(reactionPost(removed, { kind: "topic" }), "📩 sacó su reacción");
});

Deno.test("inboundPost: lo que no llegó dice por qué", () => {
    assertEquals(inboundPost("video", null, "es demasiado grande para reenviar"), "📩 (mandó un video, que es demasiado grande para reenviar)");
});
