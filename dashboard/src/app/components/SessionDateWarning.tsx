"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Overlay from "./Overlay";

/**
 * Working on the wrong session is easy to do and hard to notice: the screen
 * looks identical whichever date is open. This pins a warning bar to the top
 * of the viewport for as long as that session stays open.
 *
 * It renders through a portal because the app shell has backdrop-filter —
 * which makes it the containing block for position:fixed descendants — and
 * because the shell's max-width and padding would keep a bar inside it from
 * spanning the screen. Body padding is pushed down by the bar's height so it
 * never covers the app header.
 */
export default function SessionDateWarning({
  sessionDate,
  currentDate,
}: {
  sessionDate: string;
  currentDate: string | null;
}) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState(0);
  const show = Boolean(currentDate && sessionDate && sessionDate !== currentDate);

  useEffect(() => {
    const el = barRef.current;
    if (!show || !el) return;
    const measure = () => setHeight(el.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [show, sessionDate, currentDate]);

  useEffect(() => {
    if (!show || height === 0) return;
    const previous = document.body.style.paddingTop;
    document.body.style.paddingTop = `${height}px`;
    return () => {
      document.body.style.paddingTop = previous;
    };
  }, [show, height]);

  if (!show || !currentDate) return null;

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
    <Overlay>
      <div
        ref={barRef}
        data-testid="session-date-warning"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 60,
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
