"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import ProtectedPage from "../components/ProtectedPage";
import { usePageTitle } from "../components/PageTitleContext";
import type { CajaUser, FlowEntry, PendingHandoff } from "../api/caja/route";
import { Card, formatArs, formatWhen } from "./ui";

type CajaData = {
  me: string;
  scope: string | null;
  users: CajaUser[];
  pending: PendingHandoff[];
  opening: number;
  openingCount: number;
  history: FlowEntry[];
};

/** Signed amount, or a dash when the movement does not touch this caja
 * (a bank-paid expense, or a handoff seen from the club's side). */
function deltaLabel(delta: number) {
  if (delta === 0) return "—";
  return `${delta > 0 ? "+" : "-"}${formatArs(Math.abs(delta))}`;
}

function FlowLine({ entry }: { entry: FlowEntry }) {
  const row = (icon: string, text: React.ReactNode) => (
    <div style={{
      display: "flex",
      alignItems: "baseline",
      gap: 8,
      padding: "8px 0",
      borderBottom: "1px solid rgba(255,255,255,0.07)",
    }}>
      <span>{icon}</span>
      <span style={{ flex: 1 }}>
        {text}
        <span style={{ display: "block", fontSize: "0.75rem", opacity: 0.5 }}>
          {formatWhen(entry.at)}
        </span>
      </span>
      <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        <span style={{ fontWeight: 600 }}>{deltaLabel(entry.delta)}</span>
        <span style={{ display: "block", fontSize: "0.75rem", opacity: 0.5 }}>
          {formatArs(entry.balanceAfter)}
        </span>
      </span>
    </div>
  );

  if (entry.kind === "income") {
    return row(
      "💵",
      <>{entry.name} cobró {entry.count === 1 ? "1 pago" : `${entry.count} pagos`}</>,
    );
  }
  if (entry.kind === "expense") {
    return row(
      "📤",
      <>
        {entry.name} pagó {entry.concept}
        {entry.notes ? ` — ${entry.notes}` : ""}
        {entry.is_cash ? "" : " (banco)"}
      </>,
    );
  }
  return row(
    "🔁",
    <>{entry.from_name} le entregó caja a {entry.to_name}</>,
  );
}

function CajaContent() {
  usePageTitle("Caja");

  const [data, setData] = useState<CajaData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // "" = the club's caja; otherwise a single admin's.
  const [scope, setScope] = useState("");

  const reload = useCallback(async () => {
    const res = await fetch(`/api/caja${scope ? `?user=${scope}` : ""}`);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    setErr(null);
    setData((await res.json()) as CajaData);
  }, [scope]);

  useEffect(() => {
    reload();
  }, [reload]);

  const accept = async (id: string) => {
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/handoffs/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setBusy(false);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    await reload();
  };

  if (!data) {
    return err
      ? <p style={{ color: "crimson", marginTop: 16 }}>{err}</p>
      : <p style={{ marginTop: 16 }}>Cargando...</p>;
  }

  const holders = data.users.filter((u) => u.balance !== 0);

  return (
    <div style={{ paddingBottom: 40 }}>
      <Card title="Cajas del club">
        {holders.length === 0
          ? <p style={{ margin: 0, opacity: 0.7 }}>Nadie tiene plata del club.</p>
          : holders.map((u) => (
            <div key={u.id} style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "6px 0",
            }}>
              <span>{u.name}{u.id === data.me ? " (yo)" : ""}</span>
              <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                {formatArs(u.balance)}
              </span>
            </div>
          ))}
      </Card>

      {data.pending.length > 0 && (
        <Card title="Entregas pendientes de confirmación">
          {data.pending.map((h) => (
            <div key={h.id} style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "6px 0",
            }}>
              <span style={{ flex: 1 }}>
                {h.from_name} → {h.to_user === data.me ? "vos" : h.to_name}:{" "}
                <strong>{formatArs(h.amount)}</strong>
              </span>
              {h.to_user === data.me
                ? (
                  <button className="btnPrimary" disabled={busy} onClick={() => accept(h.id)}>
                    Confirmar
                  </button>
                )
                : <span style={{ opacity: 0.6, fontSize: "0.85rem" }}>pendiente</span>}
            </div>
          ))}
        </Card>
      )}

      <Card title="Movimientos">
        <select
          data-testid="caja-scope"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          style={{ width: "100%", marginBottom: 10 }}
        >
          <option value="">Caja del club (todos)</option>
          {data.users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}{u.id === data.me ? " (yo)" : ""}
            </option>
          ))}
        </select>

        {/* The ledger opens with what was already in the caja: everything
            before August, which the movements list does not itemize. */}
        <div
          data-testid="caja-opening"
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            padding: "8px 0",
            borderBottom: "1px solid rgba(255,255,255,0.07)",
          }}
        >
          <span>🏦</span>
          <span style={{ flex: 1 }}>
            Saldo inicial
            <span style={{ display: "block", fontSize: "0.75rem", opacity: 0.5 }}>
              {data.openingCount === 0
                ? "sin movimientos anteriores"
                : data.openingCount === 1
                ? "1 movimiento anterior"
                : `${data.openingCount} movimientos anteriores`}
            </span>
          </span>
          <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
            {formatArs(data.opening)}
          </span>
        </div>

        {data.history.map((e, i) => <FlowLine key={i} entry={e} />)}

        {data.history.length === 0 && (
          <p style={{ margin: "8px 0 0", opacity: 0.7 }}>Sin movimientos desde agosto.</p>
        )}
      </Card>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 20 }}>
        <Link href="/caja/egreso" style={{ textDecoration: "none" }}>
          <button className="btnPrimary" style={{ width: "100%" }}>📤 Registrar egreso</button>
        </Link>
        <Link href="/caja/handoff" style={{ textDecoration: "none" }}>
          <button className="btnPrimary" style={{ width: "100%" }}>🔁 Entregar caja</button>
        </Link>
      </div>

      {err ? <p style={{ color: "crimson", marginTop: 12 }}>{err}</p> : null}
    </div>
  );
}

export default function CajaPage() {
  return (
    <ProtectedPage requiredPage="/caja">
      <CajaContent />
    </ProtectedPage>
  );
}
