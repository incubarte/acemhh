// The client side of lib/moneyWrites.ts: POST a movement and, if the service
// refuses with something the admin can overrule, ask before sending it again.
// While it is on its way the screen is blocked by the save overlay, which then
// says how it went (lib/saveFeedback.ts).

import { saveFeedback } from "@/lib/saveFeedback";

/** What a refusal the admin can overrule asks, and the flag that overrules it. */
const Overrulable = [
  { key: "duplicate", flag: "confirm_duplicate", fallback: "Ya se registró uno igual. ¿Registrarlo de nuevo?" },
  { key: "closed", flag: "confirm_closed", fallback: "La sesión ya está cerrada. ¿Registrar el cobro igual?" },
] as const;

/**
 * Sends `body` to `url`. When the service refuses with something the admin
 * can overrule — the same movement registered moments ago, or (ROOT) a
 * session already closed — asks; on "yes" it is sent again with the flag
 * that says so, on "no" nothing is registered and this returns null. Both
 * can come up for one payment, one after the other.
 * Any other answer comes back as is, for the caller to handle.
 */
export async function postMoney(url: string, body: object): Promise<Response | null> {
  saveFeedback.saving();
  let res: Response | null;
  try {
    res = await sendConfirming(url, body);
  } catch (e) {
    saveFeedback.fail("No hubo conexión con el servidor. Probá de nuevo.");
    throw e;
  }
  if (res === null) saveFeedback.clear();
  else if (res.ok) saveFeedback.ok();
  else saveFeedback.fail(await failureText(res));
  return res;
}

/** What the service said, short enough for the overlay. */
async function failureText(res: Response): Promise<string | null> {
  try {
    const text = (await res.clone().text()).trim();
    if (!text) return null;
    try {
      const json = JSON.parse(text);
      if (typeof json?.message === "string") return json.message;
    } catch {
      // Plain text, as most routes answer.
    }
    return text.length > 160 ? text.slice(0, 160) + "…" : text;
  } catch {
    return null;
  }
}

async function sendConfirming(url: string, body: object): Promise<Response | null> {
  const extra: Record<string, boolean> = {};
  const send = () => fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, ...extra }),
  });

  for (;;) {
    const res = await send();
    if (res.status !== 409) return res;

    let refusal: Record<string, unknown> | null = null;
    try {
      refusal = await res.clone().json();
    } catch {
      // A plain-text 409 is some other rule: the caller shows it.
    }
    const rule = Overrulable.find((r) => refusal?.[r.key] === true && !extra[r.flag]);
    if (!rule) return res;

    const message = typeof refusal?.message === "string" ? refusal.message : rule.fallback;
    // The question is the admin's to answer: the overlay steps aside for it.
    saveFeedback.clear();
    if (!window.confirm(message)) return null;
    saveFeedback.saving();
    extra[rule.flag] = true;
  }
}
