// What every route that registers money shares: the optional note, and the
// guard against the same movement registered twice.

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/** A note as the database takes it: trimmed, and absent rather than empty. */
export function cleanNotes(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** How far back an identical movement counts as the same one registered
 * twice. A second tap is seconds; reopening the form because the first one
 * "did not go through" is a minute or two. */
export const DuplicateWindowMinutes = 10;

/**
 * Whether a row matching `match` was registered in the last few minutes. Two
 * identical movements that close together are almost always one typed twice —
 * and the copy silently inflates somebody's caja. It is not forbidden: the
 * route answers `duplicateResponse` and the screen asks before sending it
 * again with `confirm_duplicate`.
 */
export async function recentDuplicate(
  s: SupabaseClient,
  table: "payments" | "expenses" | "cash_handoffs" | "incomes",
  match: Record<string, string | number | null>,
): Promise<boolean> {
  const since = new Date(Date.now() - DuplicateWindowMinutes * 60_000).toISOString();
  let q = s.from(table).select("id").gte("created_at", since);
  for (const [column, value] of Object.entries(match)) {
    q = value === null ? q.is(column, null) : q.eq(column, value);
  }
  const { data, error } = await q.limit(1);
  // A failed lookup must not block the money: the guard is a convenience.
  if (error) {
    console.error("Duplicate lookup failed:", error);
    return false;
  }
  return (data ?? []).length > 0;
}

/** The refusal the screens recognize (see lib/postMoney.ts). */
export function duplicateResponse(what: string): NextResponse {
  return NextResponse.json({
    duplicate: true,
    message: `Hace menos de ${DuplicateWindowMinutes} minutos se registró ${what} igual. ` +
      "¿Es otro y hay que registrarlo de nuevo?",
  }, { status: 409 });
}

/**
 * The answer to ROOT registering a payment for a session that is already
 * closed: the screen asks, and on "yes" sends it again with `confirm_closed`.
 */
export function closedSessionResponse(isoDate: string, hour: string): NextResponse {
  const [y, m, d] = isoDate.split("-");
  return NextResponse.json({
    closed: true,
    message: `La sesión del ${d}/${m}/${y} ${Number(hour)}hs ya está cerrada. ` +
      "¿Registrar el cobro igual?",
  }, { status: 409 });
}
