// The debt reminder's template, as approved in WhatsApp Manager. Meta renders
// it on the phone; this copy is what the inbox shows the club, so the two must
// say the same thing. Change it only together with the template in Meta.

/** A fixed text header: Meta's template builder asks for one. Having no
 * variables, the send passes nothing for it — Meta adds it on its own. */
export const ReminderTemplateHeader = "Recordatorio del club";

export const ReminderTemplateBody =
    "Hola! Te escribimos del club porque {{1}} tiene un saldo pendiente de {{2}}. " +
    "Hoy hay entrenamiento y se puede regularizar ahí. " +
    "Si ya está pago, respondé este mensaje y lo revisamos.";

/** "tu cuenta" for the player, "la cuenta de Juan" for a guardian. */
export function reminderWho(relation: "self" | "guardian", playerName: string): string {
    return relation === "self" ? "tu cuenta" : `la cuenta de ${playerName}`;
}

/** The reminder exactly as the phone showed it: header, then body. */
export function renderReminder(params: string[]): string {
    const body = ReminderTemplateBody.replace(/\{\{(\d+)\}\}/g, (m, n) => params[Number(n) - 1] ?? m);
    return `${ReminderTemplateHeader}\n${body}`;
}
