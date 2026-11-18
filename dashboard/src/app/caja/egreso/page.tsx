"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ProtectedPage from "../../components/ProtectedPage";
import { usePageTitle } from "../../components/PageTitleContext";
import { EXPENSE_CONCEPTS, MATCH_AMOUNTS } from "@/lib/expenses";
import type { TournamentSummary } from "@/app/api/torneos/route";
import { todayBA } from "@/lib/trainingDay";
import { postMoney } from "@/lib/postMoney";
import { Card, LowAmountDialog, formatArs } from "../ui";

function EgresoContent() {
  usePageTitle("Registrar egreso");
  const router = useRouter();

  const [amount, setAmount] = useState("");
  const [concept, setConcept] = useState<string>(EXPENSE_CONCEPTS[0]);
  const [notes, setNotes] = useState("");
  const [isCash, setIsCash] = useState(true);
  const [teamId, setTeamId] = useState("");
  const [matchDate, setMatchDate] = useState("");
  const [tournaments, setTournaments] = useState<TournamentSummary[] | null>(null);
  const [confirmingLow, setConfirmingLow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const notesRequired = concept === "otros";
  const isMatch = concept === "partidos";

  // Los equipos sólo hacen falta para un partido; se traen la primera vez.
  useEffect(() => {
    if (!isMatch || tournaments) return;
    fetch("/api/torneos")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((d) => setTournaments(d.tournaments ?? []))
      .catch(() => setErr("No se pudieron traer los equipos"));
  }, [isMatch, tournaments]);
  const parsedAmount = Number(amount);

  const save = async () => {
    setConfirmingLow(false);
    setLoading(true);
    setErr(null);
    const res = await postMoney("/api/expenses", {
      amount: parsedAmount,
      concept,
      notes: notes.trim() || null,
      is_cash: isCash,
      team_id: isMatch ? teamId : null,
      match_date: isMatch ? matchDate : null,
    });
    setLoading(false);
    // Not sent: it was the same expense registered twice.
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
    if (notesRequired && !notes.trim()) {
      setErr("Para el concepto 'otros', contá en las notas qué se pagó");
      return;
    }
    if (isMatch && !teamId) {
      setErr("Elegí qué equipo jugó el partido");
      return;
    }
    if (isMatch && !matchDate) {
      setErr("Elegí qué día se jugó el partido");
      return;
    }
    // Un egreso por partido: otro monto suele ser varios partidos sumados.
    if (
      isMatch &&
      !(MATCH_AMOUNTS as readonly number[]).includes(parsedAmount) &&
      !window.confirm(
        `Un partido sale ${MATCH_AMOUNTS.map(formatArs).join(", ")}. ` +
          `Si ${formatArs(parsedAmount)} son varios partidos, registrá uno por partido. ¿Guardarlo igual?`,
      )
    ) {
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

          {isMatch && (
            <label>
              Equipo
              <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                <option value="">{tournaments ? "¿Qué equipo jugó?" : "Cargando…"}</option>
                {(tournaments ?? []).flatMap((t) => t.categories).map((c) => (
                  <optgroup key={c.id} label={c.name}>
                    {c.teams.map((team) => (
                      <option key={team.id} value={team.id}>{team.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          )}

          {isMatch && (
            <label>
              Día del partido
              <input
                type="date"
                value={matchDate}
                max={todayBA()}
                onChange={(e) => setMatchDate(e.target.value)}
              />
            </label>
          )}

          {isMatch && (
            <p style={{ fontSize: "0.8rem", opacity: 0.7, margin: 0 }}>
              Uno por partido. Si jugaron dos equipos del club entre sí, uno por cada equipo.
            </p>
          )}

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
