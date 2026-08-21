"use client";

import Link from "next/link";

/**
 * Working on the wrong session is easy to do and hard to notice: the screen
 * looks identical whichever date is open. This calls it out whenever the
 * session on screen is not the one the club is currently working on.
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
  // inverted block is what actually stops the eye.
  return (
    <div
      data-testid="session-date-warning"
      style={{
        marginTop: 12,
        padding: "12px 14px",
        borderRadius: 10,
        border: "2px solid #b45309",
        background: "#fde68a",
        color: "#1c1508",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <span style={{ fontSize: "1.4rem", lineHeight: 1 }}>⚠️</span>
      <span style={{ flex: 1, fontSize: "0.9rem", lineHeight: 1.4 }}>
        {/* The global `strong` rule paints light-on-dark; this block is the
            other way round, so the color is set explicitly. */}
        <strong style={{ display: "block", fontSize: "1rem", color: "#1c1508" }}>
          Estás en una sesión {when}
        </strong>
        {format(sessionDate)} — la sesión actual es la del {format(currentDate)}.{" "}
        <Link
          href={`/training-sessions?date=${currentDate}`}
          style={{ color: "#7c2d12", fontWeight: 700, textDecoration: "underline" }}
        >
          Ir a la actual
        </Link>
      </span>
    </div>
  );
}
