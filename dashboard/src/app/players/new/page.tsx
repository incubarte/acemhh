"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useState, Suspense } from "react";
import ProtectedPage from "../../components/ProtectedPage";
import { usePageTitle } from "../../components/PageTitleContext";

function NewPlayerPageContent() {
  const sp = useSearchParams();
  const returnTo = sp.get("returnTo") || "/";
  const inviteeParam = sp.get("invitee");
  const categoryParam = sp.get("category");
  const playerTypeParam = sp.get("player_type") as "player" | "goalkeeper" | null;

  const [playerType, setPlayerType] = useState<'member' | 'invitee' | null>(
    inviteeParam === 'true' ? 'invitee' : inviteeParam === 'false' ? 'member' : null
  );

  usePageTitle("Nuevo jugador");

  if (playerType === null) {
    return (
      <ProtectedPage requiredPage="/players/new">
        <div>
          <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 12 }}>
            <button className="btnPrimary" onClick={() => setPlayerType('member')} style={{ width: "100%" }}>
              Socio
            </button>
            <button className="btnPrimary" onClick={() => setPlayerType('invitee')} style={{ width: "100%" }}>
              Invitado
            </button>
          </div>
        </div>
      </ProtectedPage>
    );
  }

  return (
    <ProtectedPage requiredPage="/players/new">
      <NewPlayerForm returnTo={returnTo} invitee={playerType === 'invitee'} defaultCategory={categoryParam} defaultPlayerType={playerTypeParam} />
    </ProtectedPage>
  );
}

export default function NewPlayerPage() {
  return (
    <Suspense fallback={<div style={{ padding: "20px", textAlign: "center" }}>Cargando...</div>}>
      <NewPlayerPageContent />
    </Suspense>
  );
}

function NewPlayerForm({ returnTo, invitee, defaultCategory, defaultPlayerType }: { returnTo: string; invitee: boolean; defaultCategory: string | null; defaultPlayerType: "player" | "goalkeeper" | null }) {

  const [name, setName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dni, setDni] = useState("");
  const [fechaNac, setFechaNac] = useState("");
  const [category, setCategory] = useState(defaultCategory || "");
  const [playerType, setPlayerType] = useState<"player" | "goalkeeper">(defaultPlayerType || "player");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const categories = useMemo(() => [
    { value: "u-14", label: "Menores" },
    { value: "youth", label: "Juveniles" },
    { value: "cat-c", label: "Categoría C" },
    { value: "cat-b", label: "Categoría B" },
    { value: "cat-a", label: "Categoría A" },
  ], []);

  const submit = async () => {
    if (!category) {
      setErr("Seleccioná una categoría");
      return;
    }
    setLoading(true);
    setErr(null);
    const res = await fetch("/api/players", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        last_name: lastName,
        ...(invitee ? {} : { dni }),
        fecha_nac: invitee ? null : (fechaNac || null),
        category,
        invitee,
        player_type: playerType,
      }),
    });
    setLoading(false);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    const data = (await res.json()) as { player: { id: string } };
    window.location.replace(`${returnTo}?player=${encodeURIComponent(data.player.id)}`);
  };

  usePageTitle(invitee ? "Agregar Invitado" : "Nuevo jugador");

  return (
    <div>
      <div className="grid" style={{ marginTop: 12 }}>
        <label>
          Nombre
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        <label>
          Apellido
          <input value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </label>

        {!invitee && (
          <>
            <label>
              DNI
              <input value={dni} onChange={(e) => setDni(e.target.value)} />
            </label>

            <label>
              Fecha nac. (YYYY-MM-DD)
              <input value={fechaNac} onChange={(e) => setFechaNac(e.target.value)} placeholder="2000-01-31" />
            </label>
          </>
        )}

        <label>
          Categoría
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="" disabled>Seleccionar categoría</option>
            {categories.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </label>

        <div>
          <span style={{ fontSize: "0.85rem", opacity: 0.7 }}>Posición</span>
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            {([
              { value: "player", label: "Jugador" },
              { value: "goalkeeper", label: "Arquero" },
            ] as const).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setPlayerType(opt.value)}
                style={{
                  flex: 1,
                  padding: "10px 0",
                  borderRadius: 8,
                  border: playerType === opt.value
                    ? "2px solid var(--acemhh-green-3)"
                    : "1px solid rgba(255,255,255,0.15)",
                  background: playerType === opt.value
                    ? "rgba(36, 179, 91, 0.15)"
                    : "rgba(255,255,255,0.05)",
                  cursor: "pointer",
                  fontSize: "0.9rem",
                  fontWeight: playerType === opt.value ? 600 : 400,
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {err ? <p style={{ color: "crimson", marginTop: 12 }}>{err}</p> : null}

      <div className="row" style={{ marginTop: 16 }}>
        <button className="btnPrimary" onClick={submit} disabled={loading}>
          Guardar
        </button>
        <button onClick={() => window.location.href = returnTo} disabled={loading}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
