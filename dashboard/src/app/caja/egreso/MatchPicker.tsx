"use client";

import { useEffect, useMemo, useState } from "react";
import type { AgendaMatch } from "@/app/api/matches/route";
import { todayBA } from "@/lib/trainingDay";
import { formatArs } from "../ui";

/** Un pago de partido: a qué partido va y qué equipo del club lo paga. */
export type MatchChoice = { matchId: string; teamId: string };

const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday} ${d}/${m}`;
}

/** El día con el que arranca: hoy si hay partidos, si no el último que ya
 * pasó, y si todavía no se jugó ninguno el primero. */
function startingDay(days: string[], today: string): string | null {
  if (days.length === 0) return null;
  if (days.includes(today)) return today;
  const past = days.filter((d) => d < today);
  return past.length ? past[past.length - 1] : days[0];
}

/**
 * Los partidos de la agenda de a un día; las flechas van al día anterior o
 * siguiente con partidos. Cada opción es un partido y el equipo del club que
 * paga: un partido entre dos equipos del club ofrece las dos.
 */
export default function MatchPicker({ value, onChange }: {
  value: MatchChoice | null;
  onChange: (choice: MatchChoice) => void;
}) {
  const [matches, setMatches] = useState<AgendaMatch[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [day, setDay] = useState<string | null>(null);
  const today = todayBA();

  useEffect(() => {
    fetch("/api/matches")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((d) => setMatches(d.matches ?? []))
      .catch(() => setFailed(true));
  }, []);

  const days = useMemo(
    () => [...new Set((matches ?? []).map((m) => m.played_on))].sort(),
    [matches],
  );
  useEffect(() => {
    if (day === null && days.length) setDay(startingDay(days, today));
  }, [days, day, today]);

  if (failed) return <p style={{ color: "crimson", margin: 0 }}>No se pudo traer la agenda de partidos</p>;
  if (!matches) return <p style={{ opacity: 0.7, margin: 0 }}>Cargando partidos…</p>;
  if (!day) return <p style={{ opacity: 0.7, margin: 0 }}>No hay partidos en la agenda</p>;

  const at = days.indexOf(day);
  const ofDay = matches.filter((m) => m.played_on === day);
  const arrow: React.CSSProperties = { minWidth: 44, fontSize: "1.1rem", padding: "6px 0" };

  return (
    <div data-testid="match-picker">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          aria-label="Día anterior"
          style={arrow}
          disabled={at <= 0}
          onClick={() => setDay(days[at - 1])}
        >
          ‹
        </button>
        <div data-testid="match-day" style={{ flex: 1, textAlign: "center", fontWeight: 600 }}>
          {dayLabel(day)}
          {day === today && <span style={{ opacity: 0.6, fontWeight: 400 }}> · hoy</span>}
        </div>
        <button
          type="button"
          aria-label="Día siguiente"
          style={arrow}
          disabled={at >= days.length - 1}
          onClick={() => setDay(days[at + 1])}
        >
          ›
        </button>
      </div>

      <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
        {ofDay.flatMap((m) => {
          const ours = [m.home, m.away].filter((s) => s.team_id);
          return ours.map((payer) => {
            const teamId = payer.team_id!;
            const selected = value?.matchId === m.id && value.teamId === teamId;
            const paid = m.paid[teamId] ?? 0;
            return (
              <button
                key={`${m.id}|${teamId}`}
                type="button"
                data-testid="match-option"
                aria-pressed={selected}
                onClick={() => onChange({ matchId: m.id, teamId })}
                style={{
                  textAlign: "left",
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: selected ? "2px solid var(--acemhh-green)" : "1px solid rgba(255,255,255,0.18)",
                  background: selected ? "rgba(80,200,120,0.12)" : "transparent",
                }}
              >
                <div style={{ fontSize: "0.75rem", opacity: 0.65 }}>
                  {m.code} · {m.starts_at} · {m.category}
                </div>
                <div>{m.home.name} vs {m.away.name}</div>
                {ours.length > 1 && (
                  <div style={{ fontSize: "0.8rem" }}>Paga <strong>{payer.name}</strong></div>
                )}
                {paid > 0 && (
                  <div style={{ fontSize: "0.75rem", color: "#f2c14e" }}>
                    Ya registrado: {formatArs(paid)}
                  </div>
                )}
              </button>
            );
          });
        })}
      </div>
    </div>
  );
}
