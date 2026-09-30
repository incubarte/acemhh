"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postMoney } from "@/lib/postMoney";
import ProtectedPage from "../../components/ProtectedPage";
import { usePageTitle } from "../../components/PageTitleContext";
import { Card, LowAmountDialog } from "../ui";

// Money with no player behind it — a colecta, a feria del plato. It goes into
// the caja of whoever registers it.
function IngresoContent() {
  usePageTitle("Registrar ingreso");
  const router = useRouter();

  const [amount, setAmount] = useState("");
  const [concept, setConcept] = useState("");
  const [notes, setNotes] = useState("");
  const [confirmingLow, setConfirmingLow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const parsedAmount = Number(amount);

  const save = async () => {
    setConfirmingLow(false);
    setLoading(true);
    setErr(null);
    const res = await postMoney("/api/incomes", {
      amount: parsedAmount,
      concept: concept.trim(),
      notes: notes.trim() || null,
    });
    setLoading(false);
    // Not sent: it was the same income registered twice.
    if (!res) return;
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
    if (!concept.trim()) {
      setErr("Contá de dónde salió la plata");
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
      <Card title="Datos del ingreso">
        <div className="grid">
          <label>
            Monto
            <input
              data-testid="income-amount"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="120000"
            />
          </label>

          <label>
            Motivo
            <input
              data-testid="income-concept"
              value={concept}
              onChange={(e) => setConcept(e.target.value)}
              placeholder="Colecta, feria del plato..."
            />
          </label>

          <label>
            Notas (opcional)
            <input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>

          <p style={{ margin: 0, fontSize: "0.85rem", opacity: 0.7 }}>
            Entra en efectivo a tu caja.
          </p>
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

export default function IngresoPage() {
  return (
    <ProtectedPage requiredPage="/caja">
      <IngresoContent />
    </ProtectedPage>
  );
}
