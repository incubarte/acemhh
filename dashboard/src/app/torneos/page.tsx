"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import ProtectedPage from "../components/ProtectedPage";
import { usePageTitle } from "../components/PageTitleContext";
import { formatArs } from "@/lib/tournamentFees";
import type { TournamentSummary, TeamSummary } from "../api/torneos/route";

// Los torneos activos y sus equipos. Cada equipo dice cuántos jugadores tiene
// y cuántos están al día; el detalle jugador por jugador está adentro.

const heading: React.CSSProperties = {
  marginTop: 18,
  marginBottom: 6,
  fontSize: "0.7rem",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  opacity: 0.55,
};

// La tarjeta va en filas, no en columnas: arriba el nombre entero y cómo
// está el equipo, abajo los jugadores y una barra con lo cobrado. En dos
// columnas, el nombre y los montos se pisaban en un celular de 360px.
function TeamCard({ team }: { team: TeamSummary }) {
  // Sólo los titulares tienen cuota: los arqueros no pagan y los suplentes
  // pagan suelto, sin obligación. Ni unos ni otros son deudores.
  const payers = team.players - team.exempt - team.substitutes;
  const owing = payers - team.upToDate;
  const allGood = payers > 0 && owing === 0;
  const roles = [
    team.starters > 0 ? `${team.starters} ${team.starters === 1 ? "titular" : "titulares"}` : null,
    team.substitutes > 0 ? `${team.substitutes} ${team.substitutes === 1 ? "suplente" : "suplentes"}` : null,
  ].filter(Boolean).join(" · ");
  const statusColor = allGood ? "var(--acemhh-green-3)" : owing > 0 ? "#f2c14e" : "inherit";
  const progress = team.dueSoFar > 0 ? Math.min(1, team.collected / team.dueSoFar) : 0;

  return (
    <Link
      href={`/torneos/equipos/${team.id}`}
      data-testid="team-card"
      data-team={team.id}
      style={{ textDecoration: "none", display: "block", color: "inherit" }}
    >
      <div
        className="card"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 12px 12px 14px",
          lineHeight: 1.35,
          marginTop: 8,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0, fontWeight: 600, overflowWrap: "anywhere" }}>
              {team.name}
            </div>
            {payers > 0 && (
              <div
                data-testid="team-up-to-date"
                style={{
                  flexShrink: 0,
                  fontWeight: 600,
                  fontSize: "0.85rem",
                  whiteSpace: "nowrap",
                  color: statusColor,
                }}
              >
                {allGood ? "todos al día" : `${owing} ${owing === 1 ? "debe" : "deben"}`}
              </div>
            )}
          </div>
          <div style={{ fontSize: "0.8rem", opacity: 0.7, marginTop: 2 }}>
            {team.players === 0 ? "Sin jugadores cargados" : roles}
          </div>
          {payers > 0 && (
            <>
              <div
                aria-hidden="true"
                style={{
                  height: 4,
                  borderRadius: 2,
                  background: "rgba(255,255,255,0.12)",
                  marginTop: 10,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${progress * 100}%`,
                    height: "100%",
                    borderRadius: 2,
                    background: allGood ? "var(--acemhh-green-3)" : "#f2c14e",
                  }}
                />
              </div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  justifyContent: "space-between",
                  columnGap: 12,
                  fontSize: "0.75rem",
                  marginTop: 6,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                <span style={{ opacity: 0.75, whiteSpace: "nowrap" }}>
                  ${formatArs(team.collected)} de ${formatArs(team.dueSoFar)}
                </span>
                {team.substitutesPaid > 0 && (
                  <span style={{ opacity: 0.55, whiteSpace: "nowrap" }}>
                    suplentes ${formatArs(team.substitutesPaid)}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
        <span aria-hidden="true" style={{ opacity: 0.5, fontSize: "1.2rem", flexShrink: 0 }}>›</span>
      </div>
    </Link>
  );
}

function TorneosContent() {
  usePageTitle("Torneos");
  const [tournaments, setTournaments] = useState<TournamentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/torneos")
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        return res.json() as Promise<{ tournaments: TournamentSummary[] }>;
      })
      .then((data) => {
        if (cancelled) return;
        setTournaments(data.tournaments);
        setCurrent(data.tournaments[0]?.id ?? null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => { cancelled = true; };
  }, []);

  if (error) return <p style={{ color: "crimson" }}>{error}</p>;
  if (tournaments === null) return <p>Cargando…</p>;
  if (tournaments.length === 0) {
    return <p data-testid="no-tournaments">No hay torneos activos.</p>;
  }

  const selected = tournaments.find((t) => t.id === current) ?? tournaments[0];

  return (
    <div>
      {tournaments.length > 1 ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
          {tournaments.map((t) => (
            <button
              key={t.id}
              data-testid="tournament-tab"
              onClick={() => setCurrent(t.id)}
              className={t.id === selected.id ? "btnPrimary" : undefined}
              style={{ padding: "8px 14px", borderRadius: 999 }}
            >
              {t.name}
            </button>
          ))}
        </div>
      ) : (
        <h2 data-testid="tournament-name" style={{ fontSize: "1.05rem", marginTop: 4 }}>
          {selected.name}
        </h2>
      )}

      {selected.categories.map((c) => (
        <section key={c.id} data-testid="category-section" data-category={c.name}>
          <div style={heading}>{c.name}</div>
          {c.teams.length === 0 ? (
            <p style={{ margin: 0, fontSize: "0.85rem", opacity: 0.6 }}>Sin equipos</p>
          ) : (
            c.teams.map((team) => <TeamCard key={team.id} team={team} />)
          )}
        </section>
      ))}
    </div>
  );
}

export default function TorneosPage() {
  return (
    <ProtectedPage requiredPage="/torneos">
      <Suspense fallback={<p>Cargando…</p>}>
        <TorneosContent />
      </Suspense>
    </ProtectedPage>
  );
}
