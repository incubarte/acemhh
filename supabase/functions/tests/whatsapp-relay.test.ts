// The club writing from a topic: who counts as a person, and how Meta's
// statuses move the tick on the club's message.
//
//     deno test -A supabase/functions/tests/whatsapp-relay.test.ts

import { assertEquals } from "jsr:@std/assert";
import { writtenByPerson } from "../telegram-webhook/inboxRelay.ts";
import { advancesStatus, StatusReaction } from "../whatsapp-webhook/inbox.ts";

const GROUP = -1003997178107;

Deno.test("writtenByPerson: un admin anónimo es una persona escribiendo como el club", () => {
    assertEquals(writtenByPerson({ is_bot: false }, undefined, GROUP), true);
    // GroupAnonymousBot, signed by the group.
    assertEquals(writtenByPerson({ is_bot: true }, { id: GROUP }, GROUP), true);
    // Any other bot, or a channel posting into the group, is not.
    assertEquals(writtenByPerson({ is_bot: true }, undefined, GROUP), false);
    assertEquals(writtenByPerson({ is_bot: true }, { id: -100555 }, GROUP), false);
});

Deno.test("advancesStatus: enviado, entregado, leído, sin volver atrás", () => {
    assertEquals(advancesStatus("sent", "delivered"), true);
    assertEquals(advancesStatus("delivered", "read"), true);
    assertEquals(advancesStatus("sent", "read"), true);
    // Late or repeated statuses do not take the tick back.
    assertEquals(advancesStatus("read", "delivered"), false);
    assertEquals(advancesStatus("delivered", "delivered"), false);
    assertEquals(advancesStatus("sent", "sent"), false);
    // A failure after the fact wins; nothing comes after it.
    assertEquals(advancesStatus("delivered", "failed"), true);
    assertEquals(advancesStatus("failed", "read"), false);
    // Statuses we do not know move nothing.
    assertEquals(advancesStatus("sent", "deleted"), false);
});

Deno.test("StatusReaction: cada estado con su reacción", () => {
    assertEquals(StatusReaction, { sent: "🕊", delivered: "👌", read: "👀", failed: "💔" });
});
