// Meta's delivery statuses for the messages the club sent from a topic,
// shown on the club's message in Telegram: the reaction moves from sent to
// delivered to read, and a late failure gets a warning in the topic.

import type { SupabaseClient } from "@supabase/supabase-js";
import { telegramCall } from "../_shared/telegram.ts";
import { advancesStatus, type DeliveryStatus, relayRefusal, StatusReaction } from "./inbox.ts";

// deno-lint-ignore no-explicit-any
export async function applyStatus(s: SupabaseClient, token: string, status: any) {
    const wamid = status?.id;
    const incoming = String(status?.status ?? "");
    if (!wamid) return;

    const { data: mark, error } = await s.from("whatsapp_relay_marks")
        .select("chat_id,thread_id,message_id,status")
        .eq("wamid", wamid)
        .maybeSingle();
    if (error) {
        console.error("Relay mark lookup failed:", error);
        return;
    }
    // Not a message relayed from a topic: the bot's own replies, reminders.
    if (!mark || !advancesStatus(mark.status as DeliveryStatus, incoming)) return;

    // Conditional on the status read, so two statuses racing cannot both win.
    const { data: moved, error: moveError } = await s.from("whatsapp_relay_marks")
        .update({ status: incoming, updated_at: new Date().toISOString() })
        .eq("wamid", wamid)
        .eq("status", mark.status)
        .select("wamid");
    if (moveError) {
        console.error("Relay mark update failed:", moveError);
        return;
    }
    if ((moved ?? []).length === 0) return;

    const where = { chat_id: mark.chat_id, message_id: Number(mark.message_id) };
    if (incoming === "failed") {
        // deno-lint-ignore no-explicit-any
        const reason = (status?.errors ?? []).map((e: any) => e?.title ?? e?.message).filter(Boolean).join("; ");
        await telegramCall(token, "setMessageReaction", {
            ...where,
            reaction: [{ type: "emoji", emoji: StatusReaction.failed }],
        });
        const res = await telegramCall(token, "sendMessage", {
            chat_id: mark.chat_id,
            message_thread_id: Number(mark.thread_id),
            reply_parameters: { message_id: Number(mark.message_id) },
            text: relayRefusal("failed", reason || undefined),
        });
        if (!res.ok) console.error("Relay failure notice failed:", res.description);
        return;
    }

    const res = await telegramCall(token, "setMessageReaction", {
        ...where,
        reaction: [{ type: "emoji", emoji: StatusReaction[incoming as DeliveryStatus] }],
    });
    if (!res.ok) console.error("Relay reaction failed:", res.description);
}
