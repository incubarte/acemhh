"use client";

import { useSyncExternalStore } from "react";
import { idlePhase, saveFeedback } from "@/lib/saveFeedback";

// La pantalla mientras se guarda un movimiento de plata: bloquea todo con un
// palo de hockey que le pega al disco una y otra vez, y cuando llega la
// respuesta se convierte en un tilde o una cruz que se va sola.

const css = `
.saveFb-backdrop {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(0,0,0,0.65);
  display: flex; align-items: center; justify-content: center;
  padding: 20px;
}
.saveFb-card {
  width: 100%; max-width: 300px; border-radius: 14px;
  background: #1c2620; border: 1px solid rgba(255,255,255,0.18);
  padding: 22px 20px; text-align: center;
  animation: saveFb-pop 160ms ease-out;
}
.saveFb-title { font-size: 1.05rem; font-weight: 600; margin-top: 10px; }
.saveFb-sub { font-size: 0.85rem; opacity: 0.75; margin-top: 4px; }
.saveFb-stick { transform-origin: 34px 6px; animation: saveFb-swing 1.1s ease-in-out infinite; }
.saveFb-puck { animation: saveFb-shot 1.1s ease-in infinite; }
.saveFb-draw { stroke-dasharray: 60; stroke-dashoffset: 60; animation: saveFb-draw 360ms 80ms ease-out forwards; }
@keyframes saveFb-swing {
  0%   { transform: rotate(-38deg); }
  38%  { transform: rotate(6deg); }
  55%  { transform: rotate(10deg); }
  100% { transform: rotate(-38deg); }
}
@keyframes saveFb-shot {
  0%, 36% { transform: translateX(0); opacity: 1; }
  80%     { transform: translateX(78px); opacity: 0; }
  81%     { transform: translateX(0); opacity: 0; }
  100%    { transform: translateX(0); opacity: 1; }
}
@keyframes saveFb-draw { to { stroke-dashoffset: 0; } }
@keyframes saveFb-pop { from { transform: scale(0.94); opacity: 0; } to { transform: scale(1); opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .saveFb-stick, .saveFb-puck, .saveFb-card { animation: none; }
  .saveFb-draw { animation: none; stroke-dashoffset: 0; }
}
`;

function HockeyShot() {
  return (
    <svg width="150" height="64" viewBox="0 0 150 64" aria-hidden="true">
      {/* El hielo */}
      <line x1="6" y1="56" x2="144" y2="56" stroke="rgba(180,220,255,0.35)" strokeWidth="2" strokeLinecap="round" />
      {/* El palo: caña y pala, gira desde el mango */}
      <g className="saveFb-stick">
        <line x1="34" y1="6" x2="44" y2="50" stroke="#e8e2d0" strokeWidth="4" strokeLinecap="round" />
        <path d="M44 50 L62 53" stroke="#e8e2d0" strokeWidth="5" strokeLinecap="round" />
      </g>
      {/* El disco */}
      <g className="saveFb-puck">
        <ellipse cx="70" cy="52" rx="8" ry="3.5" fill="#0d0d0d" stroke="rgba(255,255,255,0.5)" strokeWidth="1" />
      </g>
    </svg>
  );
}

function ResultMark({ ok }: { ok: boolean }) {
  const color = ok ? "var(--acemhh-green, #3fb950)" : "#e5484d";
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="28" fill="none" stroke={color} strokeWidth="4" />
      {ok ? (
        <path className="saveFb-draw" d="M19 33 L28 42 L46 23" fill="none" stroke={color} strokeWidth="5"
          strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path className="saveFb-draw" d="M22 22 L42 42 M42 22 L22 42" fill="none" stroke={color} strokeWidth="5"
          strokeLinecap="round" />
      )}
    </svg>
  );
}

export default function SaveFeedback() {
  const phase = useSyncExternalStore(saveFeedback.subscribe, saveFeedback.get, () => idlePhase);
  if (phase.kind === "idle") return null;

  const done = phase.kind !== "saving";
  return (
    <div
      className="saveFb-backdrop"
      data-testid="save-feedback"
      data-phase={phase.kind}
      // El resultado se va solo; tocarlo lo despeja antes. Mientras guarda,
      // no se toca nada.
      onClick={done ? saveFeedback.clear : undefined}
    >
      <style>{css}</style>
      <div className="saveFb-card" role="status" aria-live="assertive">
        {phase.kind === "saving" && (
          <>
            <HockeyShot />
            <div className="saveFb-title">Guardando…</div>
            <div className="saveFb-sub">No cierres ni toques nada, estamos registrando la info.</div>
          </>
        )}
        {phase.kind === "ok" && (
          <>
            <ResultMark ok />
            <div className="saveFb-title">¡Guardado!</div>
          </>
        )}
        {phase.kind === "fail" && (
          <>
            <ResultMark ok={false} />
            <div className="saveFb-title">No se pudo guardar</div>
            {phase.message && <div className="saveFb-sub">{phase.message}</div>}
          </>
        )}
      </div>
    </div>
  );
}
