// A session's categories and goalies come from training_slot_features,
// resolved as of the session's own date by the training_sessions_resolved
// view. Read dates from training_sessions; read features from the view.

/** A row of training_sessions_resolved. The feature columns are NULL when the
 * slot has no configuration in force at that date. */
export type ResolvedSession = {
  categories: string[] | null;
  goalies: boolean | null;
};

export type SlotFeatures = {
  categories: string[];
  goalies: boolean;
};

/**
 * Reads a resolved row, refusing to continue when the slot has no features.
 *
 * Deliberately loud: defaulting to "no categories" would quietly shrink a
 * month's training count, and guessing them would charge the wrong people.
 * A session on a weekday/hour with no features row is a broken agenda, and
 * fixing it is two inserts — the session and its features.
 */
export function requireFeatures(row: ResolvedSession, where: string): SlotFeatures {
  if (row.categories === null || row.goalies === null) {
    throw new Error(
      `Sin configuración de slot para ${where}: cargá la fila en training_slot_features.`,
    );
  }
  return { categories: row.categories, goalies: row.goalies };
}
