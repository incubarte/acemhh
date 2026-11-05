// What the club's Telegram group sees when someone writes to the WhatsApp
// number. Nobody can open that number in the WhatsApp app — it lives in the
// Cloud API — so without this, every reply to a reminder went unread.
// Pure, so the tests exercise it directly; index.ts sends it.

export type InboxSender =
    | { kind: "player"; name: string; lastName: string }
    | { kind: "guardian"; of: { name: string; lastName: string }[] }
    | { kind: "unknown" };

/** A reminder that phone got recently, as whatsapp_reminders logged it. */
export type RecentReminder = {
    sent_on: string; // YYYY-MM-DD
    player_name: string;
    closed_debt: number;
    month_debt: number;
};

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

function formatArs(amount: number): string {
    return `$${amount.toLocaleString("es-AR")}`;
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

/**
 * The Telegram message, plain text. The wa.me link opens a chat with the
 * sender from whoever's own WhatsApp taps it: that is how an admin answers.
 */
export function inboxMessage(opts: {
    waId: string;
    sender: InboxSender;
    /** WhatsApp message type: "text", "audio", "image", … */
    kind: string;
    text: string | null;
    reminders: RecentReminder[];
}): string {
    const lines = [
        `📩 WhatsApp de ${senderLine(opts.sender)}`,
        `https://wa.me/${opts.waId}`,
    ];
    for (const r of opts.reminders) {
        const owed = [
            r.closed_debt > 0 ? `${formatArs(r.closed_debt)} de meses anteriores` : null,
            r.month_debt > 0 ? `${formatArs(r.month_debt)} del mes` : null,
        ].filter(Boolean).join(" y ");
        lines.push(`Recordatorio del ${shortDate(r.sent_on)} por ${r.player_name}: ${owed}`);
    }
    lines.push("");
    lines.push(
        opts.text
            ? opts.text
            : `(mandó ${KIND_WORDS[opts.kind] ?? `un mensaje de tipo ${opts.kind}`}, que no se puede reenviar)`,
    );
    return lines.join("\n");
}
