"use client";

import { useCallback, useEffect, useState } from "react";
import ProtectedPage from "../components/ProtectedPage";
import { usePageTitle } from "../components/PageTitleContext";
import { Card, formatArs } from "../caja/ui";
import type { AnalysisResponse } from "../api/analisis/route";
import type { Line, Owing, SlotCollections, SlotDebt } from "@/lib/analysis";

const MONTH_NAMES_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function monthTitle(month: string) {
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_NAMES_ES[m - 1]} ${y}`;
}

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + by;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

const rowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  padding: "5px 0",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
};
const num: React.CSSProperties = { fontVariantNumeric: "tabular-nums", textAlign: "right", whiteSpace: "nowrap" };
const subhead: React.CSSProperties = {
  marginTop: 14,
  marginBottom: 4,
  fontSize: "0.7rem",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  opacity: 0.55,
};

function Row({ label, amount, strong, muted }: { label: React.ReactNode; amount: number; strong?: boolean; muted?: boolean }) {
  return (
    <div style={{ ...rowStyle, fontWeight: strong ? 600 : 400, opacity: muted ? 0.75 : 1 }}>
      <span>{label}</span>
      <span style={num}>{formatArs(amount)}</span>
    </div>
  );
}

function Lines({ lines }: { lines: Line[] }) {
  if (lines.length === 0) return <p style={{ margin: "4px 0", opacity: 0.6 }}>Nada todavía.</p>;
  return <>{lines.map((l) => <Row key={l.label} label={l.label} amount={l.amount} />)}</>;
}

/** Collected / short (two ways) / projected (two ways), for one slot or the total. */
function Scenarios({ collected, pessimistic, optimistic, strong }: {
  collected: number;
  pessimistic: number;
  optimistic: number;
  strong?: boolean;
}) {
  return (
    <>
      <Row label="Cobrado" amount={collected} strong={strong} />
      <Row label="Faltante pesimista" amount={pessimistic} muted />
      <Row label="Faltante optimista" amount={optimistic} muted />
      <Row label="Proyección pesimista" amount={collected + pessimistic} strong={strong} />
      <Row label="Proyección optimista" amount={collected + optimistic} strong={strong} />
    </>
  );
}

function owingLabel(o: Owing) {
  const went = o.attended === 1 ? "fue 1 vez" : `fue ${o.attended} veces`;
  const paid = o.paid > 0 ? `, pagó ${formatArs(o.paid)}` : "";
  const how = o.kind === "partial" ? " · parcial del mes" : o.kind === "session" ? " · pagó sesión" : "";
  return `${o.player} (${went}${paid}${how})`;
}

function SlotBlock({ slot }: { slot: SlotCollections }) {
  return (
    <details style={{ marginTop: 10 }} data-testid="analysis-slot">
      <summary style={{ cursor: "pointer", fontWeight: 600, padding: "4px 0" }}>
        {slot.slot}
        <span style={{ float: "right", ...num }}>
          {formatArs(slot.collected)}
          <span style={{ opacity: 0.6 }}> / {formatArs(slot.collected + slot.pessimistic)} – {formatArs(slot.collected + slot.optimistic)}</span>
        </span>
      </summary>
      <div style={{ paddingLeft: 8 }}>
        <Scenarios collected={slot.collected} pessimistic={slot.pessimistic} optimistic={slot.optimistic} />
        <div style={subhead}>Por cobrador</div>
        <Lines lines={slot.byCollector} />
        <div style={subhead}>Deben</div>
        {slot.owing.length === 0
          ? <p style={{ margin: "4px 0", opacity: 0.6 }}>Nadie.</p>
          : slot.owing.map((o) => (
            <div key={o.player} style={rowStyle}>
              <span style={{ fontSize: "0.9rem" }}>{owingLabel(o)}</span>
              <span style={{ ...num, fontSize: "0.9rem" }}>
                {formatArs(o.pessimistic)}
                {o.optimistic !== o.pessimistic && <span style={{ opacity: 0.6 }}> – {formatArs(o.optimistic)}</span>}
              </span>
            </div>
          ))}
      </div>
    </details>
  );
}

function DebtSlotBlock({ slot }: { slot: SlotDebt }) {
  return (
    <details style={{ marginTop: 10 }} data-testid="analysis-debt-slot">
      <summary style={{ cursor: "pointer", fontWeight: 600, padding: "4px 0" }}>
        {slot.slot}
        <span style={{ float: "right", ...num }}>
          debe {formatArs(slot.outstanding)}
          <span style={{ opacity: 0.6 }}> · cobrado {formatArs(slot.settled)}</span>
        </span>
      </summary>
      <div style={{ paddingLeft: 8 }}>
        <div style={subhead}>Deben</div>
        {slot.debtors.length === 0
          ? <p style={{ margin: "4px 0", opacity: 0.6 }}>Nadie.</p>
          : slot.debtors.map((d) => (
            <Row key={`${d.player}|${d.month}`} label={`${d.player} · ${monthTitle(d.month)}`} amount={d.amount} />
          ))}
        <div style={subhead}>Cobros de deuda, por cobrador</div>
        <Lines lines={slot.settledByCollector} />
      </div>
    </details>
  );
}

function AnalysisContent() {
  usePageTitle("Análisis");
  const [month, setMonth] = useState<string | null>(null);
  const [data, setData] = useState<AnalysisResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (m: string | null) => {
    setLoading(true);
    setErr(null);
    const res = await fetch(`/api/analisis${m ? `?month=${m}` : ""}`);
    setLoading(false);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    const body = (await res.json()) as AnalysisResponse;
    setData(body);
    setMonth(body.month);
  }, []);

  useEffect(() => {
    load(null);
  }, [load]);

  if (!data) {
    return err
      ? <p style={{ color: "crimson", marginTop: 16 }}>{err}</p>
      : <p style={{ marginTop: 16 }}>Cargando...</p>;
  }

  const shown = month ?? data.month;
  const isCurrent = shown === data.current_month;
  const canGoBack = shown > data.available_from;
  const a = data.analysis;

  return (
    <div style={{ paddingBottom: 40 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
        <button onClick={() => load(shiftMonth(shown, -1))} disabled={loading || !canGoBack} aria-label="Mes anterior">◀</button>
        <span data-testid="analysis-month" style={{ flex: 1, textAlign: "center", fontWeight: 600, fontSize: "1.05rem" }}>
          {monthTitle(shown)}
        </span>
        <button onClick={() => load(shiftMonth(shown, 1))} disabled={loading || isCurrent} aria-label="Mes siguiente">▶</button>
      </div>
      {!isCurrent && (
        <button
          data-testid="analysis-today"
          onClick={() => load(data.current_month)}
          disabled={loading}
          style={{ width: "100%", marginTop: 8 }}
        >
          Volver a {monthTitle(data.current_month)}
        </button>
      )}

      {a === null ? (
        <p style={{ marginTop: 16, opacity: 0.8 }}>
          El análisis arranca en {monthTitle(data.available_from)}: antes no hay libro con qué calcularlo.
        </p>
      ) : (
        <>
          <Card title={`Cobros de ${monthTitle(shown)}`}>
            <Scenarios
              collected={a.collections.total}
              pessimistic={a.collections.pessimistic}
              optimistic={a.collections.optimistic}
              strong
            />
            <p style={{ margin: "8px 0 0", fontSize: "0.75rem", opacity: 0.55 }}>
              Pesimista: los que fueron y no pagaron pagan sólo las sesiones que ya hicieron, y los
              parciales se completan. Optimista: los que fueron y no pagaron nada compran el mes.
            </p>
            <div style={subhead}>Por cobrador</div>
            <Lines lines={a.collections.byCollector} />
            <div style={subhead}>Por horario</div>
            {a.collections.slots.map((s) => <SlotBlock key={s.slot} slot={s} />)}
          </Card>

          <Card title="Deuda de meses anteriores">
            <Row label="Deben" amount={a.debt.outstanding} strong />
            <Row label={`Cobrado en ${monthTitle(shown)}`} amount={a.debt.settled} strong />
            <p style={{ margin: "8px 0 0", fontSize: "0.75rem", opacity: 0.55 }}>
              Es plata de otros meses: no entra en los cobros de arriba. Lo que deben es lo que
              queda después de lo cobrado.
            </p>
            <div style={subhead}>Cobros de deuda, por cobrador</div>
            <Lines lines={a.debt.settledByCollector} />
            <div style={subhead}>Por horario</div>
            {a.debt.slots.length === 0
              ? <p style={{ margin: "4px 0", opacity: 0.6 }}>Nada pendiente ni cobrado.</p>
              : a.debt.slots.map((s) => <DebtSlotBlock key={s.slot} slot={s} />)}
          </Card>
        </>
      )}

      {err ? <p style={{ color: "crimson", marginTop: 12 }}>{err}</p> : null}
    </div>
  );
}

export default function AnalysisPage() {
  return (
    <ProtectedPage requiredPage="/analisis">
      <AnalysisContent />
    </ProtectedPage>
  );
}
