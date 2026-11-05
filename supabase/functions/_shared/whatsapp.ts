// Sending through the WhatsApp Cloud API, for the functions that are not the
// webhook. Imports nothing, like the rest of _shared.

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
