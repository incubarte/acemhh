// A bare Telegram Bot API call, for the functions that post into the WhatsApp
// inbox group without being the Telegram bot themselves.
//
// _lib is for the edge functions only. The dashboard compiles _shared, so
// anything that touches Deno or the network lives here instead.

/** Flat rather than a union: the functions compile with strict off, where
 * `ok` would not narrow it. `result` is set when ok, `description` when not. */
export type TelegramResult<T> = { ok: boolean; result?: T; description: string };

export async function telegramCall<T>(
    token: string,
    method: string,
    body: Record<string, unknown>,
): Promise<TelegramResult<T>> {
    try {
        const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
        });
        const json = await res.json().catch(() => null);
        if (json?.ok) return { ok: true, result: json.result as T, description: "" };
        return { ok: false, description: String(json?.description ?? `HTTP ${res.status}`) };
    } catch (e) {
        return { ok: false, description: String(e) };
    }
}

/** Telegram rejects a message over this many characters. */
export const TelegramTextLimit = 4096;

export function telegramTruncate(text: string): string {
    return text.length <= TelegramTextLimit ? text : `${text.slice(0, TelegramTextLimit - 1)}…`;
}

/** The thread the message was posted to no longer exists: somebody deleted
 * the topic. */
export function isMissingThread(description: string): boolean {
    return /thread not found|TOPIC_DELETED|TOPIC_ID_INVALID/i.test(description);
}

/** A Bot API call that uploads a file: multipart instead of JSON. */
export async function telegramUpload<T>(
    token: string,
    method: string,
    fields: Record<string, string | number | undefined | null>,
    file: { field: string; blob: Blob; name: string },
): Promise<TelegramResult<T>> {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined && v !== null) form.append(k, String(v));
    }
    form.append(file.field, file.blob, file.name);
    try {
        const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", body: form });
        const json = await res.json().catch(() => null);
        if (json?.ok) return { ok: true, result: json.result as T, description: "" };
        return { ok: false, description: String(json?.description ?? `HTTP ${res.status}`) };
    } catch (e) {
        return { ok: false, description: String(e) };
    }
}
