"use client";

import { useCallback, useEffect, useState } from "react";
import ProtectedPage from "../components/ProtectedPage";
import { usePageTitle } from "../components/PageTitleContext";
import type { CajaUser, PendingHandoff } from "../api/caja/route";

type CajaData = {
  me: string;
  users: CajaUser[];
  pendingIn: PendingHandoff[];
  pendingOut: PendingHandoff[];
};

function formatArs(amount: number) {
  return `$${amount.toLocaleString("es-AR")}`;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ fontSize: "1.05rem", fontWeight: 600, marginTop: 28, marginBottom: 8 }}>
      {children}
    </h2>
  );
}

function CajaContent() {
  usePageTitle("Caja");

  const [data, setData] = useState<CajaData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Expense form
  const [expAmount, setExpAmount] = useState("");
  const [expConcept, setExpConcept] = useState("alquiler pista");
  const [expPayee, setExpPayee] = useState("pista");
  const [expMonth, setExpMonth] = useState("");
  const [expCash, setExpCash] = useState(true);

  // Handoff form
  const [hoAmount, setHoAmount] = useState("");
  const [hoTo, setHoTo] = useState("");

  const reload = useCallback(async () => {
    const res = await fetch("/api/caja");
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    setErr(null);
    setData((await res.json()) as CajaData);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const post = async (url: string, body: unknown) => {
    setBusy(true);
    setErr(null);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      setErr(await res.text());
      return false;
    }
    await reload();
    return true;
  };

  const submitExpense = async () => {
    const ok = await post("/api/expenses", {
      amount: Number(expAmount),
      concept: expConcept,
      payee: expPayee,
      month: expMonth || null,
      is_cash: expCash,
    });
    if (ok) setExpAmount("");
  };

  const submitHandoff = async () => {
    const ok = await post("/api/handoffs", { amount: Number(hoAmount), to_user: hoTo });
    if (ok) {
      setHoAmount("");
      setHoTo("");
    }
  };

  if (!data) {
    return err
      ? <p style={{ color: "crimson", marginTop: 16 }}>{err}</p>
      : <p style={{ marginTop: 16 }}>Cargando...</p>;
  }

  const mine = data.users.find((u) => u.id === data.me);
  const others = data.users.filter((u) => u.id !== data.me);

  return (
    <div style={{ paddingBottom: 40 }}>
      {mine ? (
        <div style={{
          marginTop: 16,
          padding: "14px 16px",
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(255,255,255,0.04)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}>
          <span style={{ opacity: 0.7 }}>Mi caja</span>
          <span style={{ fontSize: "1.4rem", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
            {formatArs(mine.balance)}
          </span>
        </div>
      ) : null}

      {data.pendingIn.length > 0 && (
        <>
          <SectionTitle>Entregas por confirmar</SectionTitle>
          {data.pendingIn.map((h) => (
            <div key={h.id} className="row" style={{ marginTop: 8, alignItems: "center", gap: 10 }}>
              <span style={{ flex: 1 }}>
                {h.from_name} te entregó <strong>{formatArs(h.amount)}</strong>
              </span>
              <button className="btnPrimary" disabled={busy}
                onClick={() => post("/api/handoffs/accept", { id: h.id })}>
                Confirmar
              </button>
            </div>
          ))}
        </>
      )}

      {data.pendingOut.length > 0 && (
        <>
          <SectionTitle>Entregas esperando confirmación</SectionTitle>
          {data.pendingOut.map((h) => (
            <p key={h.id} style={{ marginTop: 6, opacity: 0.8 }}>
              {formatArs(h.amount)} a {h.to_name} — pendiente
            </p>
          ))}
        </>
      )}

      <SectionTitle>Registrar egreso</SectionTitle>
      <div className="grid">
        <label>
          Monto
          <input inputMode="numeric" value={expAmount} onChange={(e) => setExpAmount(e.target.value)} />
        </label>
        <label>
          Concepto
          <input value={expConcept} onChange={(e) => setExpConcept(e.target.value)} />
        </label>
        <label>
          Destinatario
          <input value={expPayee} onChange={(e) => setExpPayee(e.target.value)} />
        </label>
        <label>
          Mes (YYYY-MM, opcional)
          <input value={expMonth} onChange={(e) => setExpMonth(e.target.value)} placeholder="2026-08" />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={expCash} onChange={(e) => setExpCash(e.target.checked)} />
          Pagado en efectivo (sale de mi caja)
        </label>
        <button className="btnPrimary" disabled={busy || !expAmount} onClick={submitExpense}>
          Registrar egreso
        </button>
      </div>

      <SectionTitle>Entregar caja</SectionTitle>
      <div className="grid">
        <label>
          Monto
          <input inputMode="numeric" value={hoAmount} onChange={(e) => setHoAmount(e.target.value)} />
        </label>
        <label>
          A quién
          <select value={hoTo} onChange={(e) => setHoTo(e.target.value)}>
            <option value="" disabled>Elegir admin</option>
            {others.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </label>
        <button className="btnPrimary" disabled={busy || !hoAmount || !hoTo} onClick={submitHandoff}>
          Registrar entrega
        </button>
      </div>

      <SectionTitle>Cajas del club</SectionTitle>
      {data.users.map((u) => (
        <div key={u.id} style={{
          display: "flex",
          justifyContent: "space-between",
          padding: "6px 0",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}>
          <span>{u.name}{u.id === data.me ? " (yo)" : ""}</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatArs(u.balance)}</span>
        </div>
      ))}

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
