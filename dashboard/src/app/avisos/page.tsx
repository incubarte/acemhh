"use client";

// Pausing the WhatsApp payment receipts while trying something out with real
// payments. The pause ends on its own.

import { useCallback, useEffect, useState } from "react";
import ProtectedPage from "../components/ProtectedPage";
import { usePageTitle } from "../components/PageTitleContext";

const Options = [15, 30, 60, 120];

function untilLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function AvisosContent() {
  usePageTitle("Avisos de pago");
  const [until, setUntil] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [, tick] = useState(0);

  const load = useCallback(async () => {
    const res = await fetch("/api/receipts-pause");
    if (res.ok) setUntil((await res.json()).until);
    else setErr(await res.text());
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
    // Re-render every 20s so the remaining time, and the end, show up.
    const t = setInterval(() => tick((n) => n + 1), 20_000);
    return () => clearInterval(t);
  }, [load]);

  const set = async (minutes: number) => {
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/receipts-pause", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ minutes }),
    });
    setBusy(false);
    if (res.ok) setUntil((await res.json()).until);
    else setErr(await res.text());
  };

  const paused = until !== null && new Date(until).getTime() > Date.now();
  const left = paused ? Math.ceil((new Date(until!).getTime() - Date.now()) / 60_000) : 0;
  const button = {
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.2)",
    background: "rgba(255,255,255,0.06)",
    color: "inherit",
    fontSize: "1rem",
  } as const;

  return (
    <div style={{ padding: "8px 0" }}>
      <p style={{ opacity: 0.8, marginTop: 0 }}>
        Cada cobro registrado le manda un aviso por WhatsApp al jugador. Para probar algo
        con cobros de verdad, pausalo un rato: los cobros que se registren mientras
        tanto no mandan aviso, ni después. La pausa se termina sola.
      </p>

      {loaded && (
        <div data-testid="receipts-state" style={{
          padding: 12,
          borderRadius: 8,
          marginBottom: 14,
          background: paused ? "rgba(234,179,8,0.15)" : "rgba(34,197,94,0.12)",
        }}>
          {paused
            ? <>🔕 <b>Pausados</b> hasta las {untilLabel(until!)} (faltan {left} min)</>
            : <>🔔 <b>Activos</b>: cada cobro manda su aviso</>}
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {Options.map((m) => (
          <button key={m} style={button} disabled={busy} onClick={() => void set(m)}>
            Pausar {m < 60 ? `${m} min` : `${m / 60} h`}
          </button>
        ))}
        {paused && (
          <button style={{ ...button, borderColor: "rgba(34,197,94,0.6)" }} disabled={busy} onClick={() => void set(0)}>
            Reanudar ya
          </button>
        )}
      </div>
      {err && <p style={{ color: "crimson" }}>{err}</p>}
    </div>
  );
}

export default function AvisosPage() {
  return (
    <ProtectedPage requiredPage="/avisos">
      <AvisosContent />
    </ProtectedPage>
  );
}
