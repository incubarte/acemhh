// The payment receipt's template, as approved in WhatsApp Manager. Like the
// reminder's, this copy is what the inbox shows the club: change it only
// together with the template in Meta.

/** A fixed text header; the send passes nothing for it. */
export const ReceiptTemplateHeader = "Pago registrado";

export const ReceiptTemplateBody =
    "Hola! Te escribimos del club para avisarte que registramos en {{1}} un pago de {{2}}. " +
    "Saldo pendiente de entrenamientos: {{3}}. " +
    "Si algo no coincide, respondé este mensaje y lo revisamos.";

/** The receipt exactly as the phone showed it: header, then body. */
export function renderReceipt(params: string[]): string {
    const body = ReceiptTemplateBody.replace(/\{\{(\d+)\}\}/g, (m, n) => params[Number(n) - 1] ?? m);
    return `${ReceiptTemplateHeader}\n${body}`;
}
