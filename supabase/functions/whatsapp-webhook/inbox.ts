// What the club's Telegram group shows of the WhatsApp number. Nobody can
// open that number in the WhatsApp app — it lives in the Cloud API — so the
// group is where its conversations are read and answered: one forum topic per
// phone, opened the first time it writes. Pure, so the tests exercise it
// directly; the webhooks do the sending.

export type InboxSender =
    | { kind: "player"; name: string; lastName: string }
    | { kind: "guardian"; of: { name: string; lastName: string }[] }
    | { kind: "unknown" };

/** Telegram caps a topic name at this many characters. */
const TopicNameLimit = 128;

/** What the club writes in a topic starting with this stays in the group. */
export const InternalPrefix = "//";

/** WhatsApp message types we cannot show as text, in words. */
const KIND_WORDS: Record<string, string> = {
    audio: "un audio",
    image: "una imagen",
    video: "un video",
    document: "un documento",
    sticker: "un sticker",
    location: "una ubicación",
    contacts: "un contacto",
};

function full(p: { name: string; lastName: string }): string {
    return `${p.name} ${p.lastName}`.trim();
}

/** YYYY-MM-DD → DD/MM. */
function shortDate(date: string): string {
    return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

export function senderLine(sender: InboxSender): string {
    switch (sender.kind) {
        case "player":
            return full(sender);
        case "guardian":
            return `tutor de ${sender.of.map(full).join(" y ")}`;
        case "unknown":
            return "número que no conocemos";
    }
}

export function topicName(sender: InboxSender, waId: string): string {
    const name = sender.kind === "player"
        ? full(sender)
        : sender.kind === "guardian"
        ? `Tutor de ${sender.of.map(full).join(" y ")}`
        : `+${waId}`;
    return name.length <= TopicNameLimit ? name : `${name.slice(0, TopicNameLimit - 1)}…`;
}

/** The first message of a new topic: who this is, and how the topic works. */
export function topicIntro(sender: InboxSender, waId: string): string {
    return [
        `Conversación por WhatsApp con ${senderLine(sender)} (+${waId}).`,
        "Lo que escriban en este topic le llega por WhatsApp, como un mensaje del club.",
        `Para comentar entre ustedes sin que le llegue, empiecen el mensaje con ${InternalPrefix}`,
        "WhatsApp sólo deja escribirle hasta 24h después de su último mensaje.",
    ].join("\n");
}

/** A reminder the club sent, shown before the reply it got. */
export function reminderPost(sentOn: string, text: string): string {
    return `📤 Recordatorio que le mandó el club el ${shortDate(sentOn)}:\n\n${text}`;
}

/** What the person wrote. */
export function inboundPost(kind: string, text: string | null): string {
    return `📩 ${
        text
            ? text
            : `(mandó ${KIND_WORDS[kind] ?? `un mensaje de tipo ${kind}`}, que no se puede reenviar)`
    }`;
}

/** What the bot says in the topic when the club's message did not go out. */
export function relayRefusal(reason: "window" | "not-text" | "failed", detail?: string): string {
    switch (reason) {
        case "window":
            return "⚠️ No le llegó: pasaron más de 24h desde su último mensaje, y WhatsApp no deja escribirle hasta que vuelva a escribir.";
        case "not-text":
            return "⚠️ No le llegó: por ahora sólo se reenvía texto.";
        case "failed":
            return `⚠️ No le llegó: WhatsApp lo rechazó.${detail ? `\n${detail}` : ""}`;
    }
}

/** Whether the club wrote recently enough that a person is answering, and
 * the bot's automatic reply should stay quiet. */
export function clubIsAnswering(lastClubAt: string | null, now: Date, windowMs: number): boolean {
    return lastClubAt !== null && now.getTime() - new Date(lastClubAt).getTime() < windowMs;
}

export type SummaryRow = {
    player: string;
    relation: "self" | "guardian";
    detail: string;
    ok: boolean;
    error?: string;
};

/** Thursday's report for the group's General topic. */
export function reminderSummary(date: string, rows: SummaryRow[]): string {
    const sent = rows.filter((r) => r.ok);
    const failed = rows.filter((r) => !r.ok);
    const head = `📤 Recordatorios del ${shortDate(date)}: ${sent.length} enviado${sent.length === 1 ? "" : "s"}` +
        (failed.length > 0 ? `, ${failed.length} fallido${failed.length === 1 ? "" : "s"}` : "");
    const line = (r: SummaryRow) =>
        `- ${r.player}${r.relation === "guardian" ? " (al tutor)" : ""}: ${r.detail}`;
    const lines = [head];
    if (sent.length > 0) lines.push("", ...sent.map(line));
    if (failed.length > 0) {
        lines.push("", "No llegaron:");
        for (const r of failed) lines.push(`${line(r)}\n  ${(r.error ?? "").slice(0, 200)}`);
    }
    return lines.join("\n");
}

/** Marks where a new conversation starts in a topic that already had one.
 * Telegram has no rule element; a line of box-drawing characters reads as one. */
export function conversationSeparator(date: string): string {
    return `━━━━━━━━  ${shortDate(date)}  ━━━━━━━━`;
}

/** A topic's last conversation is over once nothing moved in it for the
 * window: the next message starts a new one. */
export function startsNewConversation(
    lastInboundAt: string | null,
    lastClubAt: string | null,
    now: Date,
    windowMs: number,
): boolean {
    const last = [lastInboundAt, lastClubAt]
        .filter((t): t is string => t !== null)
        .map((t) => new Date(t).getTime());
    return last.length > 0 && now.getTime() - Math.max(...last) >= windowMs;
}

export type RelayDecision = "ignore" | "not-text" | "window" | "send";

/**
 * What to do with a message the club wrote in a conversation's topic. Only
 * text written by a person goes out; `//` keeps it in the group; topic
 * housekeeping (renamed, closed, …) has neither text nor media and is
 * ignored; and past the window WhatsApp would refuse it anyway, so it is not
 * even tried.
 */
export function relayDecision(m: {
    fromBot: boolean;
    text: string | null;
    hasMedia: boolean;
    lastInboundAt: string | null;
    now: Date;
    windowMs: number;
}): RelayDecision {
    if (m.fromBot) return "ignore";
    if (m.text === null) return m.hasMedia ? "not-text" : "ignore";
    if (m.text.trimStart().startsWith(InternalPrefix)) return "ignore";
    if (m.text.trim() === "") return "ignore";
    if (m.lastInboundAt === null || m.now.getTime() - new Date(m.lastInboundAt).getTime() >= m.windowMs) {
        return "window";
    }
    return "send";
}
