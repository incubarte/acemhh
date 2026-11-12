// Sending through the WhatsApp Cloud API, for the functions that are not the
// webhook. It reads its credentials from Deno.env.
//
// _lib is for the edge functions only. The dashboard compiles _shared, so
// anything that touches Deno or the network lives here instead.

export type WhatsappOutcome =
    | { ok: true; wamid: string | null }
    | { ok: false; error: string; code: number | null };

const GraphVersionDefault = "v23.0";

/** Meta's code for a free-form message outside the 24h window. */
export const OutsideWindowCode = 131047;

/** How long after a person's last message the club may write freely. */
export const CustomerWindowMs = 24 * 60 * 60 * 1000;

/** WhatsApp rejects a text body over this many characters. */
export const WhatsappTextLimit = 4096;

export async function sendWhatsapp(payload: Record<string, unknown>): Promise<WhatsappOutcome> {
    const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
    const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
    const version = (Deno.env.get("WHATSAPP_GRAPH_VERSION") ?? GraphVersionDefault).trim();
    if (!token || !phoneNumberId) {
        return { ok: false, error: "WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID not configured", code: null };
    }
    try {
        const res = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
            method: "POST",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
        });
        const text = await res.text();
        if (!res.ok) {
            let code: number | null = null;
            try {
                code = Number(JSON.parse(text)?.error?.code) || null;
            } catch { /* not JSON */ }
            return { ok: false, error: `${res.status} ${text}`.slice(0, 1000), code };
        }
        let wamid: string | null = null;
        try {
            wamid = JSON.parse(text)?.messages?.[0]?.id ?? null;
        } catch { /* not JSON */ }
        return { ok: true, wamid };
    } catch (e) {
        return { ok: false, error: String(e).slice(0, 1000), code: null };
    }
}

export function sendWhatsappText(to: string, body: string): Promise<WhatsappOutcome> {
    return sendWhatsapp({
        to,
        type: "text",
        text: {
            body: body.length <= WhatsappTextLimit ? body : `${body.slice(0, WhatsappTextLimit - 1)}…`,
            preview_url: false,
        },
    });
}

/** Flat rather than a union, like TelegramResult: strict is off. */
export type DownloadedMedia = { ok: boolean; blob?: Blob; error?: string; tooLarge?: boolean };

/**
 * Downloads a file someone sent: the Graph API gives a short-lived URL for
 * the media id, and the URL itself wants the token too. Gives up before
 * downloading what would not fit under `maxBytes`.
 */
export async function downloadWhatsappMedia(mediaId: string, maxBytes: number): Promise<DownloadedMedia> {
    const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
    const version = (Deno.env.get("WHATSAPP_GRAPH_VERSION") ?? GraphVersionDefault).trim();
    if (!token) return { ok: false, error: "WHATSAPP_ACCESS_TOKEN not configured", tooLarge: false };
    const auth = { authorization: `Bearer ${token}` };
    try {
        const meta = await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(mediaId)}`, { headers: auth });
        const info = await meta.json().catch(() => null);
        if (!meta.ok || !info?.url) {
            return { ok: false, error: `media ${meta.status}: ${JSON.stringify(info)?.slice(0, 300)}`, tooLarge: false };
        }
        if (Number(info.file_size) > maxBytes) {
            return { ok: false, error: `media of ${info.file_size} bytes`, tooLarge: true };
        }
        const file = await fetch(info.url, { headers: auth });
        if (!file.ok) return { ok: false, error: `download ${file.status}`, tooLarge: false };
        const blob = await file.blob();
        if (blob.size > maxBytes) return { ok: false, error: `media of ${blob.size} bytes`, tooLarge: true };
        return { ok: true, blob };
    } catch (e) {
        return { ok: false, error: String(e).slice(0, 300), tooLarge: false };
    }
}
