// The client side of lib/moneyWrites.ts: POST a movement and, if the service
// says an identical one was just registered, ask before sending it again.

/**
 * Sends `body` to `url`. When the service answers that the same movement was
 * registered moments ago, asks the admin; on "yes" it is sent again with
 * `confirm_duplicate`, on "no" nothing is registered and this returns null.
 * Any other answer comes back as is, for the caller to handle.
 */
export async function postMoney(url: string, body: object): Promise<Response | null> {
  const send = (extra: object) => fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, ...extra }),
  });

  const res = await send({});
  if (res.status !== 409) return res;

  let refusal: { duplicate?: boolean; message?: string } | null = null;
  try {
    refusal = await res.clone().json();
  } catch {
    // A plain-text 409 is some other rule: the caller shows it.
  }
  if (!refusal?.duplicate) return res;

  if (!window.confirm(refusal.message ?? "Ya se registró uno igual. ¿Registrarlo de nuevo?")) {
    return null;
  }
  return send({ confirm_duplicate: true });
}
