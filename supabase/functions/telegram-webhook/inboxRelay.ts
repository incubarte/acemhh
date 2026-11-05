// The club answering a WhatsApp conversation from its topic in the inbox
// group: what is written there goes to the number, as a message from the
// club, unsigned. The decisions live in whatsapp-webhook/inbox.ts.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { relayDecision, relayRefusal } from "../whatsapp-webhook/inbox.ts";
import { CustomerWindowMs, OutsideWindowCode, sendWhatsappText } from "../_shared/whatsapp.ts";

/** The part of a Telegram message the relay looks at. */
export type TopicMessage = {
    chatId: number;
    threadId: number;
    fromBot: boolean;
    text: string | null;
    hasMedia: boolean;
};

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

    const touched = await s.from("whatsapp_inbox_topics")
        .update({ last_club_at: new Date().toISOString() })
        .eq("wa_id", topic.wa_id);
    if (touched.error) console.error("Topic touch failed:", touched.error);
    return null;
}
