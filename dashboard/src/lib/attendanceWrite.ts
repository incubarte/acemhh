// Writing from a session screen — attendance and payments — with the answers
// the admin needs: before writing, whether the session is closed (the roster
// says so, see lib/sessionLock.ts), and after a failed attendance write,
// which player was left in which state.

import { isoWeekday, slotLabel } from "@shared/slot";
import type { SessionLock } from "@/lib/sessionLock";
import { formatArs } from "@/lib/tournamentFees";

export type AttendancePlayer = { id: string; name: string; last_name?: string | null };

const fullName = (p: AttendancePlayer) => `${p.name}${p.last_name ? ` ${p.last_name}` : ""}`;
const word = (attended: boolean) => (attended ? "presente" : "ausente");

/** "jue 12/11 22hs", from the screen's "2026-11-12-22". */
export function sessionLabel(session: string): string {
  const [y, m, d, h] = session.split("-");
  const [day, hour] = slotLabel(isoWeekday(`${y}-${m}-${d}`), Number(h)).split(" ");
  return `${day} ${Number(d)}/${Number(m)} ${hour}`;
}

/**
 * Whether to go ahead, and with which confirmation. A closed session is
 * settled here, with no request: ROOT is asked whether to change it anyway,
 * anybody else is told it cannot be. null means nothing is to be written.
 */
export function attendanceGate(
  session: string,
  lock: SessionLock | null,
  player: AttendancePlayer,
  attended: boolean,
): { confirmClosed: boolean } | null {
  if (!lock?.closed) return { confirmClosed: false };
  const label = sessionLabel(session);
  if (!lock.can_write_closed) {
    window.alert(
      `La sesión del ${label} ya está cerrada: no se puede cambiar el presente de ${fullName(player)}. ` +
        `Sigue ${word(!attended)}.`,
    );
    return null;
  }
  return window.confirm(
      `La sesión del ${label} ya está cerrada. ` +
        `¿Marcar a ${fullName(player)} como ${word(attended)} igual?`,
    )
    ? { confirmClosed: true }
    : null;
}

/**
 * Sends it, and when it does not go through tells the admin, by name, the
 * state the player was left in. Returns whether it was written.
 */
export async function sendAttendance(
  session: string,
  player: AttendancePlayer,
  attended: boolean,
  confirmClosed: boolean,
): Promise<boolean> {
  let detail: string | null = null;
  try {
    const res = await fetch(`/api/training-sessions/${session}/attendance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        player_id: player.id,
        attended,
        ...(confirmClosed ? { confirm_closed: true } : {}),
      }),
    });
    if (res.ok) return true;
    detail = (await res.text().catch(() => "")).trim().slice(0, 200) || null;
  } catch {
    detail = "No hubo conexión con el servidor.";
  }
  window.alert(
    `No se pudo marcar a ${fullName(player)} como ${word(attended)}: quedó ${word(!attended)}.` +
      (detail ? `\n\n${detail}` : ""),
  );
  return false;
}

/**
 * The same question for a payment, asked from what the roster already says
 * instead of after a refusal: ROOT is asked whether to register it anyway,
 * anybody else is told it cannot be. null means nothing is to be sent.
 * (postMoney still asks if the service refuses anyway — a tab left open
 * across the Monday the session closed on.)
 */
export function paymentGate(
  session: string,
  lock: SessionLock | null,
  player: AttendancePlayer,
  amount: number,
): { confirmClosed: boolean } | null {
  if (!lock?.closed) return { confirmClosed: false };
  const label = sessionLabel(session);
  if (!lock.can_write_closed) {
    window.alert(
      `La sesión del ${label} ya está cerrada: no se le puede cobrar a ${fullName(player)}. ` +
        "Se cobra en la semana actual y la anterior.",
    );
    return null;
  }
  return window.confirm(
      `La sesión del ${label} ya está cerrada. ` +
        `¿Registrar el cobro de $${formatArs(amount)} a ${fullName(player)} igual?`,
    )
    ? { confirmClosed: true }
    : null;
}
