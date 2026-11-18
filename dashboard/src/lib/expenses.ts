// The expense concept dropdown, shared by the form and the API validation.
// "otros" requires notes (also enforced by a DB check); the named concepts
// speak for themselves.
export const EXPENSE_CONCEPTS = ["hora de pista", "seguro", "partidos", "otros"] as const;

// Lo que sale un partido: la mesa y la pista, juntas o por separado. Un egreso
// de partidos por otro monto suele ser varios partidos sumados, y se registra
// uno por partido; el formulario pregunta antes de guardarlo.
export const MATCH_AMOUNTS = [85000, 175000, 260000] as const;
