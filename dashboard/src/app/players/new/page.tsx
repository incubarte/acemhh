"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

export default function NewPlayerPage() {
  const sp = useSearchParams();
  const returnTo = sp.get("returnTo") || "/payments";

  const [name, setName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dni, setDni] = useState("");
  const [fechaNac, setFechaNac] = useState("");
  const [category, setCategory] = useState("cat-b");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const categories = useMemo(() => ["esc-2", "u-14", "cat-c", "cat-b", "cat-a"], []);

  const submit = async () => {
    setLoading(true);
    setErr(null);
    const res = await fetch("/api/players", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        last_name: lastName,
        dni,
        fecha_nac: fechaNac || null,
        category,
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
      <h1>Nuevo jugador</h1>

      <div className="grid" style={{ marginTop: 12 }}>
        <label>
          Nombre
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        <label>
          Apellido
          <input value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </label>

        <label>
          DNI
          <input value={dni} onChange={(e) => setDni(e.target.value)} />
        </label>

        <label>
          Fecha nac. (YYYY-MM-DD)
          <input value={fechaNac} onChange={(e) => setFechaNac(e.target.value)} placeholder="2000-01-31" />
        </label>

        <label>
          Categoría
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
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
