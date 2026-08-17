"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ProtectedPage from "../../components/ProtectedPage";
import { usePageTitle } from "../../components/PageTitleContext";
import type { CajaUser } from "../../api/caja/route";
import { Card, LowAmountDialog } from "../ui";

function HandoffContent() {
  usePageTitle("Entregar caja");
  const router = useRouter();

  const [admins, setAdmins] = useState<CajaUser[] | null>(null);
  const [amount, setAmount] = useState("");
  const [toUser, setToUser] = useState("");
  const [confirmingLow, setConfirmingLow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      const res = await fetch("/api/caja");
      if (!res.ok) {
        setErr(await res.text());
        return;
      }
      const data = (await res.json()) as { me: string; users: CajaUser[] };
      setAdmins(data.users.filter((u) => u.id !== data.me));
    };
    run();
  }, []);

  const parsedAmount = Number(amount);

  const save = async () => {
    setConfirmingLow(false);
    setLoading(true);
    setErr(null);
    const res = await fetch("/api/handoffs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: parsedAmount, to_user: toUser }),
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
    if (!toUser) {
      setErr("Elegí a quién le entregás la caja");
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
      <Card title="Datos de la entrega">
        <p style={{ marginTop: 0, fontSize: "0.85rem", opacity: 0.7 }}>
          La entrega queda pendiente hasta que quien la recibe la confirme en su Caja.
        </p>
        <div className="grid">
          <label>
            Monto
            <input
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="150000"
            />
          </label>

          <label>
            A quién
            <select value={toUser} onChange={(e) => setToUser(e.target.value)}>
              <option value="" disabled>Elegir admin</option>
              {(admins ?? []).map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      {err ? <p style={{ color: "crimson", marginTop: 12 }}>{err}</p> : null}

      <div className="row" style={{ marginTop: 16 }}>
        <button className="btnPrimary" onClick={submit} disabled={loading || admins === null}>
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

export default function HandoffPage() {
  return (
    <ProtectedPage requiredPage="/caja">
      <HandoffContent />
    </ProtectedPage>
  );
}
