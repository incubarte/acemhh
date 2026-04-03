"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import { usePageTitle } from "../components/PageTitleContext";

type Player = {
  id: string;
  name: string;
  last_name: string;
};

type CredentialData = {
  player: {
    id: string;
    name: string;
    last_name: string;
    dni: string | null;
    category: string;
    invitee: boolean;
  };
  year: number;
  upToDate: boolean;
  totalPaid: number;
  payments: { amount: number; month: string; date: string }[];
};

function formatArs(amount: number) {
  const s = String(amount);
  const parts: string[] = [];
  for (let i = s.length; i > 0; i -= 3) {
    parts.unshift(s.substring(Math.max(0, i - 3), i));
  }
  return parts.join(".");
}

const CATEGORY_LABELS: Record<string, string> = {
  "u-14": "Sub-14",
  "cat-c": "Cat. C",
  "cat-b": "Cat. B",
  "cat-a": "Cat. A",
};

function CredencialContent() {
  usePageTitle("Credencial de Socio");
  const [step, setStep] = useState<"search" | "credential">("search");
  const [q, setQ] = useState("");
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [credential, setCredential] = useState<CredentialData | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (step !== "search") return;
      if (q.trim().length < 2) {
        setPlayers([]);
        return;
      }
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch(`/api/credencial/search?query=${encodeURIComponent(q.trim())}`);
        if (!res.ok) {
          setLoading(false);
          setErr(await res.text());
          return;
        }
        const data = (await res.json()) as { players: Player[] };
        if (cancelled) return;
        setPlayers(data.players);
        setLoading(false);
      } catch (e: unknown) {
        if (cancelled) return;
        setLoading(false);
        setErr(e instanceof Error ? e.message : String(e));
      }
    };

    run();
    return () => { cancelled = true; };
  }, [q, step]);

  const selectPlayer = async (player: Player) => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/credencial/check?player_id=${encodeURIComponent(player.id)}`);
      if (!res.ok) {
        setLoading(false);
        setErr(await res.text());
        return;
      }
      const data = (await res.json()) as CredentialData;
      setCredential(data);
      setStep("credential");
      setLoading(false);
    } catch (e: unknown) {
      setLoading(false);
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  if (step === "search") {
    return (
      <div>

        <h2 style={{ fontSize: "1.1rem", fontWeight: 500, marginTop: 16, marginBottom: 8 }}>
          Buscar jugador
        </h2>

        <div style={{ marginTop: 12 }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nombre o apellido"
            style={{ width: "100%" }}
          />
        </div>

        {loading ? <p style={{ marginTop: 12 }}>Buscando...</p> : null}
        {err ? <p style={{ marginTop: 12, color: "crimson" }}>{err}</p> : null}

        {players.length > 0 && (
          <div style={{
            marginTop: 12,
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: "12px",
            overflow: "hidden",
            background: "rgba(255,255,255,0.03)",
          }}>
            {players.map((p, idx) => (
              <button
                key={p.id}
                onClick={() => selectPlayer(p)}
                style={{
                  textAlign: "left",
                  width: "100%",
                  borderRadius: 0,
                  border: "none",
                  borderTop: idx > 0 ? "1px solid rgba(255,255,255,0.08)" : "none",
                  background: "transparent",
                  padding: "12px 14px",
                }}
              >
                <div style={{ fontWeight: 600 }}>{p.last_name}, {p.name}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (step === "credential" && credential) {
    const { player, year, upToDate, totalPaid, payments } = credential;
    const validThrough = `03/${year + 1}`;

    return (
      <div>


        {/* Physical card */}
        <div style={{
          marginTop: 20,
          aspectRatio: "1.586",
          maxWidth: 420,
          borderRadius: 18,
          overflow: "hidden",
          position: "relative",
          background: upToDate
            ? "linear-gradient(145deg, #0a2e1a 0%, #0f4a2c 30%, #1a6b3f 60%, #0d3d24 100%)"
            : "linear-gradient(145deg, #2e1a0a 0%, #4a2c0f 30%, #6b3f1a 60%, #3d240d 100%)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5), 0 8px 20px rgba(0,0,0,0.3)",
          border: "1px solid rgba(255,255,255,0.1)",
        }}>
          {/* Decorative circle pattern */}
          <div style={{
            position: "absolute",
            top: -60,
            right: -60,
            width: 200,
            height: 200,
            borderRadius: "50%",
            background: upToDate
              ? "radial-gradient(circle, rgba(36,179,91,0.15) 0%, transparent 70%)"
              : "radial-gradient(circle, rgba(243,108,33,0.15) 0%, transparent 70%)",
          }} />
          <div style={{
            position: "absolute",
            bottom: -40,
            left: -40,
            width: 160,
            height: 160,
            borderRadius: "50%",
            background: upToDate
              ? "radial-gradient(circle, rgba(163,223,128,0.1) 0%, transparent 70%)"
              : "radial-gradient(circle, rgba(243,108,33,0.08) 0%, transparent 70%)",
          }} />

          {/* Card content */}
          <div style={{
            position: "relative",
            zIndex: 1,
            padding: "20px 22px",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}>
            {/* Top row: org name + year */}
            <div>
              <div style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
              }}>
                <div>
                  <div style={{
                    fontSize: "1.1rem",
                    fontWeight: 800,
                    letterSpacing: "0.12em",
                    color: upToDate ? "#a3df80" : "#f3a06c",
                  }}>
                    ACEMHH
                  </div>
                  <div style={{
                    fontSize: "0.6rem",
                    letterSpacing: "0.08em",
                    opacity: 0.5,
                    marginTop: 2,
                    textTransform: "uppercase",
                  }}>
                    Credencial de Socio
                  </div>
                </div>
                {/* Status chip */}
                <div style={{
                  padding: "4px 10px",
                  borderRadius: 20,
                  fontSize: "0.65rem",
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  background: upToDate
                    ? "rgba(36, 179, 91, 0.25)"
                    : "rgba(243, 108, 33, 0.25)",
                  border: upToDate
                    ? "1px solid rgba(36, 179, 91, 0.4)"
                    : "1px solid rgba(243, 108, 33, 0.4)",
                  color: upToDate ? "#a3df80" : "#f3a06c",
                }}>
                  {upToDate ? "Al dia" : "Pendiente"}
                </div>
              </div>
            </div>

            {/* Middle: member name */}
            <div style={{ marginTop: "auto", marginBottom: "auto" }}>
              <div style={{
                fontSize: "1.35rem",
                fontWeight: 700,
                lineHeight: 1.15,
                letterSpacing: "-0.01em",
                textShadow: "0 2px 4px rgba(0,0,0,0.3)",
              }}>
                {player.name}
              </div>
              <div style={{
                fontSize: "1.35rem",
                fontWeight: 700,
                lineHeight: 1.15,
                letterSpacing: "-0.01em",
                textTransform: "uppercase",
                textShadow: "0 2px 4px rgba(0,0,0,0.3)",
              }}>
                {player.last_name}
              </div>
            </div>

            {/* Bottom row: details */}
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-end",
            }}>
              <div style={{ display: "flex", gap: 24 }}>
                {player.dni && (
                  <div>
                    <div style={{ fontSize: "0.55rem", opacity: 0.45, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 2 }}>
                      DNI
                    </div>
                    <div style={{ fontSize: "0.85rem", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                      {player.dni}
                    </div>
                  </div>
                )}
                <div>
                  <div style={{ fontSize: "0.55rem", opacity: 0.45, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 2 }}>
                    Categoria
                  </div>
                  <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>
                    {CATEGORY_LABELS[player.category] || player.category}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "0.55rem", opacity: 0.45, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 2 }}>
                    Valida hasta
                  </div>
                  <div style={{ fontSize: "0.85rem", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                    {validThrough}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Subtle holographic stripe */}
          <div style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: 3,
            background: upToDate
              ? "linear-gradient(90deg, transparent, #24b35b, #a3df80, #24b35b, transparent)"
              : "linear-gradient(90deg, transparent, #f36c21, #f3a06c, #f36c21, transparent)",
            opacity: 0.6,
          }} />
        </div>

        {/* Payment details below the card */}
        {upToDate && payments.length > 0 && (
          <div style={{
            marginTop: 16,
            padding: "12px 16px",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.03)",
          }}>
            <div style={{ fontSize: "0.75rem", opacity: 0.4, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Pagos registrados &middot; ${formatArs(totalPaid)} total
            </div>
            {payments.map((p, idx) => (
              <div key={idx} style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "5px 0",
                fontSize: "0.85rem",
                borderTop: idx > 0 ? "1px solid rgba(255,255,255,0.06)" : "none",
              }}>
                <span style={{ opacity: 0.6 }}>
                  {new Date(p.date).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })}
                </span>
                <span style={{ fontWeight: 600 }}>
                  ${formatArs(p.amount)}
                </span>
              </div>
            ))}
          </div>
        )}

        {!upToDate && (
          <div style={{
            marginTop: 16,
            padding: "12px 16px",
            borderRadius: 12,
            border: "1px solid rgba(243,108,33,0.2)",
            background: "rgba(243,108,33,0.06)",
            fontSize: "0.9rem",
            color: "var(--acemhh-orange)",
            textAlign: "center",
          }}>
            No se registran pagos de cuota social para {year}
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <button onClick={() => {
            setStep("search");
            setCredential(null);
            setQ("");
            setPlayers([]);
          }}>
            Buscar otro jugador
          </button>
        </div>
      </div>
    );
  }

  return null;
}

export default function CredencialPage() {
  return (
    <Suspense fallback={<div style={{ padding: "20px", textAlign: "center" }}>Cargando...</div>}>
      <CredencialContent />
    </Suspense>
  );
}
