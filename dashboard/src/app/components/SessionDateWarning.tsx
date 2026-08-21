"use client";

import Link from "next/link";
import Overlay from "./Overlay";
import { TopStackSlotId } from "./TopStack";

/**
 * Working on the wrong session is easy to do and hard to notice: the screen
 * looks identical whichever date is open. This pins a warning bar directly
 * under the app header, staying put for as long as that session is open.
 *
 * It portals into the fixed top stack, which owns the pinning and pushes the
 * page down by the whole bar's height — so the warning always sits below the
 * header and never covers it.
 */
export default function SessionDateWarning({
  sessionDate,
  currentDate,
}: {
  sessionDate: string;
  currentDate: string | null;
}) {
  if (!currentDate || !sessionDate || sessionDate === currentDate) return null;

  const when = sessionDate < currentDate ? "pasada" : "futura";
  const format = (d: string) =>
    new Date(`${d}T12:00:00`).toLocaleDateString("es-AR", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });

  // Solid light amber with dark type: on a screen that is otherwise dark, an
  // inverted bar is what actually stops the eye.
  return (
    <Overlay targetId={TopStackSlotId}>
      <div
        data-testid="session-date-warning"
        style={{
          padding: "10px 14px",
          borderBottom: "3px solid #b45309",
          background: "#fde68a",
          color: "#1c1508",
          display: "flex",
          alignItems: "center",
          gap: 10,
          boxShadow: "0 6px 18px rgba(0,0,0,0.45)",
        }}
      >
        <span style={{ fontSize: "1.4rem", lineHeight: 1 }}>⚠️</span>
        <span style={{ flex: 1, fontSize: "0.9rem", lineHeight: 1.35 }}>
          {/* The global `strong` rule paints light-on-dark; this bar is the
              other way round, so the color is set explicitly. */}
          <strong style={{ display: "block", fontSize: "1rem", color: "#1c1508" }}>
            Estás en una sesión {when}
          </strong>
          {format(sessionDate)} — la actual es la del {format(currentDate)}.{" "}
          <Link
            href={`/training-sessions?date=${currentDate}`}
            style={{ color: "#7c2d12", fontWeight: 700, textDecoration: "underline" }}
          >
            Ir a la actual
          </Link>
        </span>
      </div>
    </Overlay>
  );
}
