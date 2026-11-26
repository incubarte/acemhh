// Marking attendance from a session screen, with the two answers the admin
// needs: before writing, whether the session is closed (the roster says so,
// see lib/sessionLock.ts), and after, if the write failed, which player was
// left in which state.

import { isoWeekday, slotLabel } from "@shared/slot";
import type { SessionLock } from "@/lib/sessionLock";

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

/** The gate and the write together, for the screens that have nothing to do
 * in between. */
export async function markAttendance(
  session: string,
  lock: SessionLock | null,
  player: AttendancePlayer,
  attended: boolean,
): Promise<boolean> {
  const go = attendanceGate(session, lock, player, attended);
  if (!go) return false;
  return sendAttendance(session, player, attended, go.confirmClosed);
}
