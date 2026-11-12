// What a WhatsApp message that is not text becomes in the inbox topic: the
// file itself, re-uploaded to Telegram, or a line saying what it was. And a
// reaction, as a reply to the message it reacts to. Pure, so the tests
// exercise it directly; index.ts does the downloading and posting.

/** A file attached to an inbound message, as WhatsApp describes it. */
export type InboundMedia = {
    kind: "image" | "audio" | "video" | "document" | "sticker";
    /** Media id: the Graph API hands out a download URL for it. */
    id: string;
    mime: string;
    caption: string | null;
    filename: string | null;
    /** A voice note recorded in the app, rather than an audio file. */
    voice: boolean;
};

export const MediaKinds = ["image", "audio", "video", "document", "sticker"] as const;

// deno-lint-ignore no-explicit-any
export function mediaOf(message: any): InboundMedia | null {
    const kind = message?.type;
    if (!(MediaKinds as readonly string[]).includes(kind)) return null;
    const m = message[kind];
    if (!m?.id) return null;
    return {
        kind,
        id: String(m.id),
        mime: String(m.mime_type ?? ""),
        caption: typeof m.caption === "string" && m.caption.trim() ? m.caption.trim() : null,
        filename: typeof m.filename === "string" && m.filename.trim() ? m.filename.trim() : null,
        voice: m.voice === true,
    };
}

/** Telegram's limit for a file a bot uploads. */
export const TelegramUploadLimit = 50 * 1024 * 1024;

/** Telegram caps a caption at this many characters. */
const CaptionLimit = 1024;

export type TelegramUpload = {
    method: "sendPhoto" | "sendVoice" | "sendAudio" | "sendVideo" | "sendDocument" | "sendSticker";
    /** The form field the file goes in. */
    field: "photo" | "voice" | "audio" | "video" | "document" | "sticker";
};

const Document: TelegramUpload = { method: "sendDocument", field: "document" };

/**
 * How Telegram takes the file, so it plays or shows in place: a voice note
 * as a voice message, a photo as a photo. What Telegram would not play goes
 * as a document, which always works.
 */
export function uploadFor(media: InboundMedia): TelegramUpload {
    const mime = media.mime.toLowerCase();
    switch (media.kind) {
        case "image":
            return /^image\/(jpeg|png)/.test(mime) ? { method: "sendPhoto", field: "photo" } : Document;
        case "audio":
            if (mime.includes("ogg")) return { method: "sendVoice", field: "voice" };
            return /^audio\/(mpeg|mp3|mp4|aac|m4a|x-m4a)/.test(mime) ? { method: "sendAudio", field: "audio" } : Document;
        case "video":
            return /^video\/mp4/.test(mime) ? { method: "sendVideo", field: "video" } : Document;
        case "sticker":
            return { method: "sendSticker", field: "sticker" };
        case "document":
            return Document;
    }
}

const Extensions: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/aac": "aac",
    "audio/amr": "amr",
    "video/mp4": "mp4",
    "video/3gpp": "3gp",
    "application/pdf": "pdf",
};

/** The file's name in Telegram: the sender's for a document, otherwise one
 * made up from the type. */
export function uploadName(media: InboundMedia): string {
    if (media.filename) return media.filename;
    const ext = Extensions[media.mime.split(";")[0].trim().toLowerCase()] ?? "bin";
    return `${media.kind}.${ext}`;
}

/** The caption that marks the file as theirs, with what they wrote on it. A
 * sticker takes no caption. */
export function mediaCaption(media: InboundMedia): string | null {
    if (media.kind === "sticker") return null;
    const text = media.caption ? `📩 ${media.caption}` : "📩";
    return text.length <= CaptionLimit ? text : `${text.slice(0, CaptionLimit - 1)}…`;
}

// ////////////////////////////////////
// LOCATIONS AND CONTACTS
// ////////////////////////////////////

/** A shared location or contact card, as text: neither is a file. */
// deno-lint-ignore no-explicit-any
export function sharedText(message: any): string | null {
    if (message?.type === "location") {
        const l = message.location ?? {};
        if (typeof l.latitude !== "number" || typeof l.longitude !== "number") return null;
        const label = [l.name, l.address].filter((x) => typeof x === "string" && x.trim()).join(", ");
        return `📍 ${label ? `${label}: ` : ""}https://maps.google.com/?q=${l.latitude},${l.longitude}`;
    }
    if (message?.type === "contacts") {
        // deno-lint-ignore no-explicit-any
        const cards = (message.contacts ?? []).map((c: any) => {
            const name = c?.name?.formatted_name ?? "Sin nombre";
            // deno-lint-ignore no-explicit-any
            const phones = (c?.phones ?? []).map((p: any) => p?.phone).filter(Boolean);
            return phones.length ? `${name}: ${phones.join(", ")}` : name;
        });
        return cards.length ? `👤 ${cards.join("\n👤 ")}` : null;
    }
    return null;
}

// ////////////////////////////////////
// REACTIONS
// ////////////////////////////////////

export type InboundReaction = {
    /** The WhatsApp message reacted to. */
    messageId: string;
    /** Empty when they took their reaction back. */
    emoji: string;
};

// deno-lint-ignore no-explicit-any
export function reactionOf(message: any): InboundReaction | null {
    if (message?.type !== "reaction") return null;
    const r = message.reaction ?? {};
    if (!r.message_id) return null;
    return { messageId: String(r.message_id), emoji: typeof r.emoji === "string" ? r.emoji : "" };
}

/** What the reaction was on, when it was not on a message in the topic. */
export type ReactionTarget =
    | { kind: "topic" }
    | { kind: "reminder"; sentOn: string }
    | { kind: "receipt"; sentOn: string }
    | { kind: "other" };

/** YYYY-MM-DD → DD/MM. */
function shortDate(date: string): string {
    return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

/**
 * The line the topic shows. On a message that is in the topic, it is posted
 * as a reply to it and needs to say no more; otherwise it names what it was.
 */
export function reactionPost(reaction: InboundReaction, target: ReactionTarget): string {
    const what = !reaction.emoji ? "📩 sacó su reacción" : `📩 reaccionó ${reaction.emoji}`;
    switch (target.kind) {
        case "topic":
            return what;
        case "reminder":
            return `${what} al recordatorio del ${shortDate(target.sentOn)}`;
        case "receipt":
            return `${what} al aviso de pago del ${shortDate(target.sentOn)}`;
        case "other":
            return `${what} a un mensaje automático del club`;
    }
}
