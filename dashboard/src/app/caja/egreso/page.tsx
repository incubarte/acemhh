"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ProtectedPage from "../../components/ProtectedPage";
import { usePageTitle } from "../../components/PageTitleContext";
import { EXPENSE_CONCEPTS } from "@/lib/expenses";
import { Card, LowAmountDialog } from "../ui";

function EgresoContent() {
  usePageTitle("Registrar egreso");
  const router = useRouter();

  const [amount, setAmount] = useState("");
  const [concept, setConcept] = useState<string>(EXPENSE_CONCEPTS[0]);
  const [notes, setNotes] = useState("");
  const [isCash, setIsCash] = useState(true);
  const [confirmingLow, setConfirmingLow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const notesRequired = concept === "otros";
  const parsedAmount = Number(amount);

  const save = async () => {
    setConfirmingLow(false);
    setLoading(true);
    setErr(null);
    const res = await fetch("/api/expenses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        amount: parsedAmount,
        concept,
        notes: notes.trim() || null,
        is_cash: isCash,
      }),
    });
    setLoading(false);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    router.push("/caja");
  };

  const submit = () => {
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setErr("Ingresá un monto válido");
      return;
    }
    if (notesRequired && !notes.trim()) {
      setErr("Para el concepto 'otros', contá en las notas qué se pagó");
      return;
    }
    setErr(null);
    if (parsedAmount < 1000) {
      setConfirmingLow(true);
      return;
    }
    save();
  };

  return (
    <div style={{ paddingBottom: 40 }}>
      <Card title="Datos del egreso">
        <div className="grid">
          <label>
            Monto
            <input
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="120000"
            />
          </label>

          <label>
            Concepto
            <select value={concept} onChange={(e) => setConcept(e.target.value)}>
              {EXPENSE_CONCEPTS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>

          <label>
            Notas{notesRequired ? " (obligatorio)" : " (opcional)"}
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={notesRequired ? "¿Qué se pagó?" : ""}
            />
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={isCash}
              onChange={(e) => setIsCash(e.target.checked)}
            />
            Pagado en efectivo (sale de mi caja)
          </label>
        </div>
      </Card>

      {err ? <p style={{ color: "crimson", marginTop: 12 }}>{err}</p> : null}

      <div className="row" style={{ marginTop: 16 }}>
        <button className="btnPrimary" onClick={submit} disabled={loading}>
          Guardar
        </button>
        <button onClick={() => router.push("/caja")} disabled={loading}>
          Cancelar
        </button>
      </div>

      {confirmingLow && (
        <LowAmountDialog
          amount={parsedAmount}
          onConfirm={save}
          onCancel={() => setConfirmingLow(false)}
        />
      )}
    </div>
  );
}

export default function EgresoPage() {
  return (
    <ProtectedPage requiredPage="/caja">
      <EgresoContent />
    </ProtectedPage>
  );
}
