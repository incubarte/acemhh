// The club answering a WhatsApp conversation from its topic in the inbox
// group: what is written there goes to the number, as a message from the
// club, unsigned. The decisions live in whatsapp-webhook/inbox.ts.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { relayDecision, relayRefusal, StatusReaction } from "../whatsapp-webhook/inbox.ts";
import { telegramCall } from "../_shared/telegram.ts";
import { CustomerWindowMs, OutsideWindowCode, sendWhatsappText } from "../_shared/whatsapp.ts";

/** The part of a Telegram message the relay looks at. */
export type TopicMessage = {
    chatId: number;
    threadId: number;
    messageId: number;
    fromBot: boolean;
    text: string | null;
    hasMedia: boolean;
};

/**
 * Whether a person wrote the message. An anonymous admin writes through
 * Telegram's GroupAnonymousBot, signed by the group itself: that is a person,
 * writing as the club. Any other bot is not, and neither is a channel posting
 * into the group.
 */
export function writtenByPerson(
    from: { is_bot?: boolean } | undefined,
    senderChat: { id: number } | undefined,
    chatId: number,
): boolean {
    if (senderChat) return senderChat.id === chatId;
    return !from?.is_bot;
}

/** The club's message did not go out: it gets the failure mark, next to
 * the bot's reply saying why. */
export async function markUndelivered(chatId: number, messageId: number) {
    const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!token) return;
    const res = await telegramCall(token, "setMessageReaction", {
        chat_id: chatId,
        message_id: messageId,
        reaction: [{ type: "emoji", emoji: StatusReaction.failed }],
    });
    if (!res.ok) console.error("Relay reaction failed:", res.description);
}

export function inboxChatId(): string | null {
    return Deno.env.get("WHATSAPP_INBOX_TELEGRAM_CHAT_ID") ?? null;
}

/**
 * Relays one topic message. Returns what the bot should say in the topic —
 * only when the message did not go out — or null.
 */
export async function relayFromTopic(s: SupabaseClient, m: TopicMessage): Promise<string | null> {
    const { data: topic, error } = await s.from("whatsapp_inbox_topics")
        .select("wa_id,last_inbound_at")
        .eq("chat_id", String(m.chatId))
        .eq("thread_id", m.threadId)
        .maybeSingle();
    if (error) {
        console.error("Inbox topic lookup failed:", error);
        return relayRefusal("failed", "No se encontró la conversación de este topic.");
    }
    // A topic the bot did not open for a number: club talk, not a conversation.
    if (!topic) return null;

    const decision = relayDecision({
        fromBot: m.fromBot,
        text: m.text,
        hasMedia: m.hasMedia,
        lastInboundAt: topic.last_inbound_at,
        now: new Date(),
        windowMs: CustomerWindowMs,
    });
    if (decision === "ignore") return null;
    if (decision !== "send") return relayRefusal(decision);

    const outcome = await sendWhatsappText(topic.wa_id, m.text!);
    if ("error" in outcome) {
        console.error("Inbox relay failed:", outcome.error);
        return outcome.code === OutsideWindowCode
            ? relayRefusal("window")
            : relayRefusal("failed", outcome.error.slice(0, 300));
    }

    // The first tick, and the link Meta's later statuses use to move it.
    if (outcome.wamid) {
        const marked = await s.from("whatsapp_relay_marks").insert({
            wamid: outcome.wamid,
            chat_id: String(m.chatId),
            thread_id: m.threadId,
            message_id: m.messageId,
            status: "sent",
        });
        if (marked.error) console.error("Relay mark insert failed:", marked.error);
    }
    const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (token) {
        const reacted = await telegramCall(token, "setMessageReaction", {
            chat_id: m.chatId,
            message_id: m.messageId,
            reaction: [{ type: "emoji", emoji: StatusReaction.sent }],
        });
        if (!reacted.ok) console.error("Relay reaction failed:", reacted.description);
    }

    const touched = await s.from("whatsapp_inbox_topics")
        .update({ last_club_at: new Date().toISOString() })
        .eq("wa_id", topic.wa_id);
    if (touched.error) console.error("Topic touch failed:", touched.error);
    return null;
}
