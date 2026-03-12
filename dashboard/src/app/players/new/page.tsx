"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useState, Suspense } from "react";
import ProtectedPage from "../../components/ProtectedPage";

function NewPlayerPageContent() {
  const sp = useSearchParams();
  const returnTo = sp.get("returnTo") || "/";
  const inviteeParam = sp.get("invitee");
  const categoryParam = sp.get("category");

  const [playerType, setPlayerType] = useState<'member' | 'invitee' | null>(
    inviteeParam === 'true' ? 'invitee' : inviteeParam === 'false' ? 'member' : null
  );

  if (playerType === null) {
    return (
      <ProtectedPage requiredPage="/players/new">
        <div>
          <h1>Nuevo jugador</h1>
          <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 12 }}>
            <button className="btnPrimary" onClick={() => setPlayerType('member')} style={{ width: "100%" }}>
              Socio
            </button>
            <button className="btnPrimary" onClick={() => setPlayerType('invitee')} style={{ width: "100%" }}>
              Invitado
            </button>
          </div>
          <div style={{ marginTop: 16 }}>
            <button onClick={() => window.location.href = returnTo}>← Volver</button>
          </div>
        </div>
      </ProtectedPage>
    );
  }

  return (
    <ProtectedPage requiredPage="/players/new">
      <NewPlayerForm returnTo={returnTo} invitee={playerType === 'invitee'} defaultCategory={categoryParam} />
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

function NewPlayerForm({ returnTo, invitee, defaultCategory }: { returnTo: string; invitee: boolean; defaultCategory: string | null }) {

  const [name, setName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dni, setDni] = useState("");
  const [fechaNac, setFechaNac] = useState("");
  const [category, setCategory] = useState(defaultCategory || "cat-b");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const categories = useMemo(() => [
    { value: "u-14", label: "Menores" },
    { value: "cat-c", label: "Categoría C" },
    { value: "cat-b", label: "Categoría B" },
    { value: "cat-a", label: "Categoría A" },
  ], []);

  const submit = async () => {
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
      }),
    });
    setLoading(false);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    const data = (await res.json()) as { player: { id: string } };
    window.location.href = `${returnTo}?player=${encodeURIComponent(data.player.id)}`;
  };

  return (
    <div>
      <h1>{invitee ? "Agregar Invitado" : "Nuevo jugador"}</h1>

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
            {categories.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </label>
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
