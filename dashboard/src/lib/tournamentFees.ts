// La cuota de un torneo, leída desde los pagos. Pura: la importan las rutas y
// la prueba dashboard/e2e/tournament-fees.spec.ts.
//
// Cada mes del torneo es una cuota. Los pagos no dicen a qué mes van: se
// admite cualquier monto, y lo pagado se va aplicando a las cuotas en orden.
// Lo que importa es cuánto lleva pagado contra cuánto debería llevar pagado
// a esta altura del torneo.

export const TournamentConcepts = ["tournament", "tournament upfront"] as const;
export type TournamentConcept = (typeof TournamentConcepts)[number];

export type Installment = { month: string; amount: number };

export type FeePayment = { amount: number; concept: TournamentConcept };

/**
 * paid: cubierta entera. partial: algo, no todo. due: nada, y el mes ya
 * llegó. upcoming: nada, pero todavía no hace falta.
 */
export type InstallmentStatus = "paid" | "partial" | "due" | "upcoming";

export type InstallmentStanding = Installment & {
  paid: number;
  status: InstallmentStatus;
};

export type FeeStanding = {
  installments: InstallmentStanding[];
  /** Lo que el torneo le cuesta: la suma de las cuotas, o el precio
   * anticipado si lo tomó. */
  total: number;
  paid: number;
  /** Lo que debería llevar pagado: las cuotas hasta el mes actual inclusive. */
  dueSoFar: number;
  /** Lo que falta de lo que ya venció. */
  outstandingNow: number;
  /** Lo que falta del torneo entero. */
  remaining: number;
  upfrontTaken: boolean;
  /** Puede pagar el torneo entero con descuento: no pagó nada y la primera
   * cuota todavía no venció. */
  upfrontAvailable: boolean;
  /** Qué conviene ofrecerle: completar lo vencido, o si está al día la
   * próxima cuota entera. null cuando no debe nada más. */
  nextSuggested: number | null;
};

/** Las cuotas escaladas a `total`, en pesos enteros; la última absorbe el
 * redondeo. Sólo para un anticipado que quedó corto — algo que el servicio no
 * deja registrar, pero que un pago cargado a mano podría producir. */
function scaledTo(installments: Installment[], total: number): Installment[] {
  const sum = installments.reduce((acc, i) => acc + i.amount, 0);
  if (sum === 0 || sum === total) return installments;
  const scaled = installments.map((i) => ({
    month: i.month,
    amount: Math.round((i.amount * total) / sum),
  }));
  const partial = scaled.slice(0, -1).reduce((acc, i) => acc + i.amount, 0);
  scaled[scaled.length - 1].amount = total - partial;
  return scaled;
}

export function feeStanding(
  nominal: Installment[],
  upfrontPrice: number | null,
  payments: FeePayment[],
  todayMonth: string,
): FeeStanding {
  const ordered = [...nominal].sort((a, b) => a.month.localeCompare(b.month));
  const paid = payments.reduce((acc, p) => acc + p.amount, 0);
  const upfrontTaken = payments.some((p) => p.concept === "tournament upfront");
  const nominalTotal = ordered.reduce((acc, i) => acc + i.amount, 0);
  const total = upfrontTaken && upfrontPrice !== null ? upfrontPrice : nominalTotal;
  // El anticipado pagó todo: las cuotas se muestran con su valor nominal y
  // todas cubiertas. Sólo si quedó corto se leen a escala de lo que pagó.
  const settledUpfront = upfrontTaken && paid >= total;
  const effective = settledUpfront ? ordered : scaledTo(ordered, total);

  let left = settledUpfront ? nominalTotal : paid;
  let dueSoFar = 0;
  const installments: InstallmentStanding[] = effective.map((i) => {
    const applied = Math.min(left, i.amount);
    left -= applied;
    const isDue = i.month <= todayMonth;
    if (isDue) dueSoFar += i.amount;
    const status: InstallmentStatus = applied >= i.amount
      ? "paid"
      : applied > 0
      ? "partial"
      : isDue
      ? "due"
      : "upcoming";
    return { ...i, paid: applied, status };
  });

  // Quien tomó el anticipado debía todo de una: así el "cobrado X de Y" del
  // equipo suma pesos redondos y no la escala de una cuota.
  if (upfrontTaken) dueSoFar = total;
  const outstandingNow = Math.max(0, dueSoFar - paid);
  const remaining = Math.max(0, total - paid);
  const first = ordered[0]?.month;
  const upfrontAvailable = upfrontPrice !== null && paid === 0 &&
    first !== undefined && todayMonth <= first;

  let nextSuggested: number | null = null;
  if (outstandingNow > 0) nextSuggested = outstandingNow;
  else {
    const next = installments.find((i) => i.paid < i.amount);
    if (next) nextSuggested = next.amount - next.paid;
  }

  return {
    installments,
    total,
    paid,
    dueSoFar,
    outstandingNow,
    remaining,
    upfrontTaken,
    upfrontAvailable,
    nextSuggested,
  };
}

const MONTH_NAMES_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

export function monthNameEs(month: string): string {
  return MONTH_NAMES_ES[Number(month.slice(5)) - 1] ?? month;
}

/** La inicial del mes, para el punto de cada cuota. */
export function monthInitialEs(month: string): string {
  return monthNameEs(month).charAt(0);
}

export const RoleLabels: Record<string, string> = {
  starter: "Titular",
  substitute: "Suplente",
};

/** Pesos como los abrevian las pantallas: 30000 se lee "30k", y un millón
 * "1.000k" para que los miles se cuenten de un vistazo. */
export function formatArs(amount: number): string {
  if (amount >= 1000 && amount % 1000 === 0) {
    return `${new Intl.NumberFormat("es-AR").format(amount / 1000)}k`;
  }
  return new Intl.NumberFormat("es-AR").format(amount);
}
