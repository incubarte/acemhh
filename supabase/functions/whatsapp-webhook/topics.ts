// The inbox group's forum topics, one per WhatsApp number: opening, reusing
// and reopening them, and posting into them. The wording lives in inbox.ts.

import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingThread, telegramCall, type TelegramResult, telegramTruncate } from "../_lib/telegram.ts";
import { type InboxSender, topicIntro, topicName } from "./inbox.ts";

export type InboxConfig = { token: string; chatId: string };

export function inboxConfig(): InboxConfig | null {
    const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const chatId = Deno.env.get("WHATSAPP_INBOX_TELEGRAM_CHAT_ID");
    return token && chatId ? { token, chatId } : null;
}

export type TopicRow = {
    wa_id: string;
    chat_id: string;
    thread_id: number;
    last_inbound_at: string | null;
    last_club_at: string | null;
};

export async function findTopic(s: SupabaseClient, waId: string): Promise<TopicRow | null> {
    const { data, error } = await s.from("whatsapp_inbox_topics")
        .select("wa_id,chat_id,thread_id,last_inbound_at,last_club_at")
        .eq("wa_id", waId)
        .maybeSingle();
    if (error) throw new Error("whatsapp_inbox_topics: " + error.message);
    return data ? { ...data, thread_id: Number(data.thread_id) } : null;
}

/** Opens a new topic for the number and records it. When another delivery
 * opened one at the same time, theirs wins and ours is deleted. */
async function openTopic(
    s: SupabaseClient,
    cfg: InboxConfig,
    waId: string,
    sender: InboxSender,
): Promise<number> {
    const created = await telegramCall<{ message_thread_id: number }>(cfg.token, "createForumTopic", {
        chat_id: cfg.chatId,
        name: topicName(sender, waId),
    });
    if (!created.ok) throw new Error("createForumTopic: " + created.description);
    const threadId = created.result!.message_thread_id;

    const inserted = await s.from("whatsapp_inbox_topics")
        .upsert({ wa_id: waId, chat_id: cfg.chatId, thread_id: threadId }, {
            onConflict: "wa_id",
            ignoreDuplicates: true,
        })
        .select("thread_id");
    if (inserted.error) throw new Error("whatsapp_inbox_topics: " + inserted.error.message);
    if ((inserted.data ?? []).length === 0) {
        await telegramCall(cfg.token, "deleteForumTopic", { chat_id: cfg.chatId, message_thread_id: threadId });
        const existing = await findTopic(s, waId);
        if (!existing) throw new Error("whatsapp_inbox_topics: topic vanished");
        return existing.thread_id;
    }

    await telegramCall(cfg.token, "sendMessage", {
        chat_id: cfg.chatId,
        message_thread_id: threadId,
        text: topicIntro(sender, waId),
    });
    return threadId;
}

/**
 * The number's topic, ready to post into: reused when there is one, reopened
 * in case the club closed it, opened when there is none — or when the one on
 * record belongs to another group, after the inbox moved.
 */
export async function ensureTopic(
    s: SupabaseClient,
    cfg: InboxConfig,
    waId: string,
    sender: InboxSender,
    known: TopicRow | null,
): Promise<number> {
    if (known && known.chat_id === cfg.chatId) {
        // Fails harmlessly when it is already open.
        await telegramCall(cfg.token, "reopenForumTopic", {
            chat_id: cfg.chatId,
            message_thread_id: known.thread_id,
        });
        return known.thread_id;
    }
    if (known) await s.from("whatsapp_inbox_topics").delete().eq("wa_id", waId);
    return openTopic(s, cfg, waId, sender);
}

export type Posted = { thread: number; messageId: number | null };

/** One attempt at a post, into the given thread. */
export type TopicSend = (thread: number) => Promise<TelegramResult<{ message_id: number }>>;

/**
 * Posts into the number's topic. If somebody deleted the topic, a new one is
 * opened and the post goes there. Returns the thread it landed in, and the
 * message, so a reaction to it later can answer it.
 */
export async function deliverToTopic(
    s: SupabaseClient,
    cfg: InboxConfig,
    waId: string,
    sender: InboxSender,
    threadId: number,
    send: TopicSend,
): Promise<Posted> {
    const first = await send(threadId);
    if (first.ok) return { thread: threadId, messageId: first.result?.message_id ?? null };
    if (!isMissingThread(first.description)) throw new Error("telegram: " + first.description);

    await s.from("whatsapp_inbox_topics").delete().eq("wa_id", waId).eq("thread_id", threadId);
    const fresh = await openTopic(s, cfg, waId, sender);
    const second = await send(fresh);
    if (!second.ok) throw new Error("telegram: " + second.description);
    return { thread: fresh, messageId: second.result?.message_id ?? null };
}

/** A text post: see deliverToTopic. `replyTo` answers a message in the
 * thread, and is dropped if the thread had to be opened again. */
export function postToTopic(
    s: SupabaseClient,
    cfg: InboxConfig,
    waId: string,
    sender: InboxSender,
    threadId: number,
    text: string,
    replyTo: number | null = null,
): Promise<Posted> {
    return deliverToTopic(s, cfg, waId, sender, threadId, (thread) =>
        telegramCall<{ message_id: number }>(cfg.token, "sendMessage", {
            chat_id: cfg.chatId,
            message_thread_id: thread,
            text: telegramTruncate(text),
            link_preview_options: { is_disabled: true },
            ...(replyTo !== null && thread === threadId
                ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } }
                : {}),
        }));
}
