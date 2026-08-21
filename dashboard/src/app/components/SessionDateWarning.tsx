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

  return (
    <div
      data-testid="session-date-warning"
      style={{
        marginTop: 12,
        padding: "12px 14px",
        borderRadius: 10,
        border: "2px solid #facc15",
        background: "rgba(250, 204, 21, 0.18)",
        color: "#fde68a",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <span style={{ fontSize: "1.4rem", lineHeight: 1 }}>⚠️</span>
      <span style={{ flex: 1, fontSize: "0.9rem", lineHeight: 1.4 }}>
        <strong style={{ display: "block", fontSize: "1rem" }}>
          Estás en una sesión {when}
        </strong>
        {format(sessionDate)} — la sesión actual es la del {format(currentDate)}.{" "}
        <Link
          href={`/training-sessions?date=${currentDate}`}
          style={{ color: "#fde68a", textDecoration: "underline" }}
        >
          Ir a la actual
        </Link>
      </span>
    </div>
  );
}
