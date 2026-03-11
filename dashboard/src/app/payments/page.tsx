"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type Player = {
  id: string;
  name: string;
  last_name: string;
};

type Step =
  | { kind: "search" }
  | { kind: "concept"; player: Player }
  | { kind: "amount"; player: Player; concept: "membership" }
  | { kind: "summary"; player: Player; concept: "membership"; amount: number; month: string };

function formatArs(amount: number) {
  const s = String(amount);
  const parts: string[] = [];
  for (let i = s.length; i > 0; i -= 3) {
    parts.unshift(s.substring(Math.max(0, i - 3), i));
  }
  return parts.join(".");
}

function currentYearMonth() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function yearMonthFor(month: number) {
  const y = new Date().getUTCFullYear();
  const m = String(month).padStart(2, "0");
  return `${y}-${m}`;
}

export default function PaymentsPage() {
  const sp = useSearchParams();
  const [step, setStep] = useState<Step>({ kind: "search" });
  const [q, setQ] = useState("");
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [showCustomAmount, setShowCustomAmount] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const suggestions = useMemo(
    () => [
      { amount: 70000, label: "(Anual)", month: yearMonthFor(3) },
      { amount: 35000, label: "(1er semestre)", month: yearMonthFor(3) },
      { amount: 35000, label: "(2do semestre)", month: yearMonthFor(7) },
    ],
    [],
  );

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (step.kind !== "search") return;
      if (q.trim().length < 2) {
        setPlayers([]);
        return;
      }
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch(`/api/players?query=${encodeURIComponent(q.trim())}`);
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
        const msg = e instanceof Error ? e.message : String(e);
        setErr(msg);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [q, step.kind]);

  const tryWebAppAutoAuth = async (): Promise<boolean> => {
    const getInitData = () => {
      const tg = (window as unknown as { Telegram?: { WebApp?: { initData?: string } } }).Telegram;
      return tg?.WebApp?.initData;
    };

    let initData = getInitData();
    if (!initData) {
      await new Promise((r) => setTimeout(r, 200));
      initData = getInitData();
    }
    if (!initData) return false;

    const r = await fetch("/api/auth/telegram/webapp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData }),
    });
    return r.ok;
  };

  const ensureAuthed = async () => {
    const res = await fetch("/api/me");
    if (res.status !== 401) return res.ok;

    const ok = await tryWebAppAutoAuth();
    if (ok) {
      const res2 = await fetch("/api/me");
      if (res2.ok) return true;
    }

    window.location.href = "/login";
    return false;
  };

  useEffect(() => {
    ensureAuthed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    const playerId = sp.get("player");
    if (!playerId) return;

    const run = async () => {
      const ok = await ensureAuthed();
      if (!ok) return;
      const res = await fetch(`/api/players?id=${encodeURIComponent(playerId)}`);
      if (!res.ok) return;
      const data = (await res.json()) as { player: Player | null };
      if (cancelled) return;
      if (data.player) {
        setStep({ kind: "concept", player: data.player });
      }
    };

    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);

  if (step.kind === "search") {
    return (
      <div>
        <h1>Registrar Pago</h1>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 500, marginTop: 16, marginBottom: 8 }}>Buscar jugador</h2>

        <div style={{ marginTop: 12 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre o apellido" style={{ width: "100%" }} />
        </div>

        {loading ? <p style={{ marginTop: 12 }}>Buscando…</p> : null}
        {err ? <p style={{ marginTop: 12, color: "crimson" }}>{err}</p> : null}

        {players.length > 0 && (
          <div style={{ 
            marginTop: 12, 
            border: "1px solid rgba(255,255,255,0.12)", 
            borderRadius: "12px", 
            overflow: "hidden",
            background: "rgba(255,255,255,0.03)"
          }}>
            {players.map((p, idx) => (
              <button
                key={p.id}
                onClick={() => setStep({ kind: "concept", player: p })}
                style={{ 
                  textAlign: "left",
                  width: "100%",
                  borderRadius: 0,
                  border: "none",
                  borderTop: idx > 0 ? "1px solid rgba(255,255,255,0.08)" : "none",
                  background: "transparent",
                  padding: "12px 14px"
                }}
              >
                <div style={{ fontWeight: 600 }}>{p.last_name}, {p.name}</div>
              </button>
            ))}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", marginTop: 16, marginBottom: 16 }}>
          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.2)" }} />
          <span style={{ padding: "0 12px", fontSize: "0.9rem", opacity: 0.6 }}>o</span>
          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.2)" }} />
        </div>

        <div style={{ textAlign: "center" }}>
          <Link href={{ pathname: "/players/new", query: { returnTo: "/payments" } }} style={{ textDecoration: "underline", opacity: 0.8 }}>
            Nuevo jugador
          </Link>
        </div>
      </div>
    );
  }

  if (step.kind === "concept") {
    return (
      <div>
        <h1>Registrar Pago</h1>
        <div className="card" style={{ marginTop: 12 }}>
          <div><strong>Jugador:</strong> {step.player.last_name}, {step.player.name}</div>
        </div>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 500, marginTop: 16, marginBottom: 8 }}>Seleccione concepto</h2>

        <div style={{ marginTop: 12 }}>
          <button className="btnPrimary" onClick={() => setStep({ kind: "amount", player: step.player, concept: "membership" })}>
            Cuota social
          </button>
        </div>

        <div style={{ marginTop: 16 }}>
          <button onClick={() => setStep({ kind: "search" })}>
            Volver
          </button>
        </div>
      </div>
    );
  }

  if (step.kind === "amount") {
    const pick = (amt: number, month: string) =>
      setStep({ kind: "summary", player: step.player, concept: step.concept, amount: amt, month });

    return (
      <div>
        <h1>Registrar Pago</h1>
        <div className="card" style={{ marginTop: 12 }}>
          <div><strong>Jugador:</strong> {step.player.last_name}, {step.player.name}</div>
          <div><strong>Concepto:</strong> Cuota social</div>
        </div>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 500, marginTop: 16, marginBottom: 8 }}>Seleccione monto</h2>

        {!showCustomAmount ? (
          <>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
              {suggestions.map((s, idx) => (
                <button
                  key={`${s.amount}-${idx}`}
                  onClick={() => pick(s.amount, s.month)}
                >
                  {formatArs(s.amount)} {s.label}
                </button>
              ))}
            </div>

            <div style={{ marginTop: 16 }}>
              <button
                onClick={() => {
                  setShowCustomAmount(true);
                }}
              >
                Otro monto
              </button>
            </div>
          </>
        ) : (
          <div style={{ marginTop: 16 }}>
            <div className="row">
              <input
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)}
                placeholder="Ej: 50.000"
              />
              <button
                className="btnPrimary"
                onClick={() => {
                  const normalized = customAmount.replaceAll(".", "").replaceAll(",", "").trim();
                  const n = Number(normalized);
                  if (!Number.isFinite(n) || n <= 0) {
                    alert("Monto inválido");
                    return;
                  }
                  pick(n, currentYearMonth());
                }}
              >
                Continuar
              </button>
              <button
                onClick={() => {
                  setCustomAmount("");
                  setShowCustomAmount(false);
                }}
              >
                Volver
              </button>
            </div>
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <button onClick={() => setStep({ kind: "concept", player: step.player })}>
            Volver
          </button>
        </div>
      </div>
    );
  }

  if (step.kind === "summary") {
    const confirm = async () => {
      setLoading(true);
      setErr(null);
      const res = await fetch("/api/payments/dues", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          player_id: step.player.id,
          amount: step.amount,
          month: step.month,
        }),
      });
      setLoading(false);
      if (!res.ok) {
        setErr(await res.text());
        return;
      }
      setShowSuccess(true);
      setTimeout(() => {
        setShowSuccess(false);
        setQ("");
        setPlayers([]);
        setStep({ kind: "search" });
      }, 2000);
    };

    return (
      <div>
        <h1>Registrar Pago</h1>

        {showSuccess && (
          <div style={{
            marginTop: 12,
            padding: 16,
            borderRadius: 12,
            background: "linear-gradient(135deg, rgba(36, 179, 91, 0.2), rgba(15, 122, 68, 0.15))",
            border: "1px solid rgba(36, 179, 91, 0.4)",
            textAlign: "center",
            fontWeight: 600,
            color: "var(--acemhh-green-3)"
          }}>
            ✓ Pago registrado exitosamente
          </div>
        )}

        <div className="card" style={{ marginTop: 12 }}>
          <div><strong>Jugador:</strong> {step.player.last_name}, {step.player.name}</div>
          <div><strong>Concepto:</strong> Cuota social</div>
          <div><strong>Monto:</strong> {formatArs(step.amount)}</div>
        </div>

        {err ? <p style={{ marginTop: 12, color: "crimson" }}>{err}</p> : null}

        <div className="row" style={{ marginTop: 16 }}>
          <button className="btnPrimary" onClick={confirm} disabled={loading}>
            Confirmar
          </button>
          <button onClick={() => setStep({ kind: "amount", player: step.player, concept: step.concept })} disabled={loading}>
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  return null;
}
