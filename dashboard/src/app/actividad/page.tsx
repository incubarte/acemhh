"use client";

// The activity log, a day at a time: what each person did in the dashboard,
// what the service answered, and what changed in the tables. Tapping a line
// that belongs to a submit shows only that submit's chain.

import { useCallback, useEffect, useMemo, useState } from "react";
import ProtectedPage from "../components/ProtectedPage";
import { usePageTitle } from "../components/PageTitleContext";
import { type ActivityRow, formatLine, gapsOf, type Names } from "@/lib/activityFormat";

function todayBA(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
}

const SourceColor: Record<string, string> = {
  UI: "#93c5fd",
  API: "#fcd34d",
  DB: "#86efac",
};

function ActividadContent() {
  usePageTitle("Actividad");
  const [day, setDay] = useState(todayBA());
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [names, setNames] = useState<Names>({ users: {}, players: {} });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [who, setWho] = useState("");
  const [player, setPlayer] = useState("");
  const [sources, setSources] = useState<Record<string, boolean>>({ UI: true, API: true, DB: true });
  const [onlyWarn, setOnlyWarn] = useState(false);
  const [hideNoise, setHideNoise] = useState(false);
  const [trace, setTrace] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/activity?day=${day}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setRows(data.lines ?? []);
      setNames({ users: data.users ?? {}, players: data.players ?? {} });
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, [day]);

  useEffect(() => {
    void load();
  }, [load]);

  const gaps = useMemo(() => gapsOf(rows), [rows]);
  const lines = useMemo(() => rows.map((r) => formatLine(r, names)), [rows, names]);

  const people = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of lines) m.set(l.actorKey, l.who);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [lines]);

  const needle = player.trim().toLowerCase();
  const shown = lines.filter((l) => {
    if (trace) return l.trace === trace;
    if (!sources[l.source]) return false;
    if (who && l.actorKey !== who) return false;
    if (onlyWarn && !l.warn && !gaps.has(l.id)) return false;
    if (hideNoise && l.source === "UI" && (l.what === "nav" || l.what.startsWith("tap "))) return false;
    if (needle) {
      const hit = l.playerIds.some((id) => (names.players[id] ?? "").toLowerCase().includes(needle)) ||
        l.context.toLowerCase().includes(needle);
      if (!hit) return false;
    }
    return true;
  });

  const control = { background: "rgba(255,255,255,0.06)", color: "inherit", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 6, padding: "6px 8px", fontSize: "0.9rem" } as const;

  const check = { display: "inline-flex", alignItems: "center", gap: 4 } as const;
  const box = { width: "auto", margin: 0 } as const;

  return (
    <div style={{ padding: "8px 0" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <input type="date" value={day} onChange={(e) => { setTrace(null); setDay(e.target.value); }} style={control} data-activity="actividad.día" />
        <select value={who} onChange={(e) => setWho(e.target.value)} style={control} data-activity="actividad.persona">
          <option value="">Todos</option>
          {people.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
        </select>
        <input placeholder="Jugador" value={player} onChange={(e) => setPlayer(e.target.value)} style={{ ...control, width: 130 }} data-activity="actividad.jugador" />
        <button onClick={() => void load()} style={control} disabled={loading}>{loading ? "…" : "↻"}</button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: "0.85rem", marginBottom: 10 }}>
        {(["UI", "API", "DB"] as const).map((s) => (
          <label key={s} style={{ ...check, color: SourceColor[s] }}>
            <input type="checkbox" style={box} checked={sources[s]} onChange={(e) => setSources({ ...sources, [s]: e.target.checked })} /> {s}
          </label>
        ))}
        <label style={check}><input type="checkbox" style={box} checked={onlyWarn} onChange={(e) => setOnlyWarn(e.target.checked)} /> solo lo raro</label>
        <label style={check}><input type="checkbox" style={box} checked={hideNoise} onChange={(e) => setHideNoise(e.target.checked)} /> sin nav ni taps</label>
      </div>

      {trace && (
        <div style={{ marginBottom: 8, fontSize: "0.85rem" }}>
          Mostrando un solo envío y lo que dejó ({trace}). <button onClick={() => setTrace(null)} style={control}>ver todo</button>
        </div>
      )}
      {err && <p style={{ color: "crimson" }}>{err}</p>}
      {!loading && shown.length === 0 && <p style={{ opacity: 0.6 }}>Nada para mostrar.</p>}

      <div data-testid="activity-lines" style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.78rem", lineHeight: 1.45 }}>
        {shown.map((l) => (
          <div key={l.id}>
            {gaps.has(l.id) && (
              <div style={{ color: "#f87171", padding: "2px 0" }}>
                ⚠ faltan {gaps.get(l.id)} línea{gaps.get(l.id)! > 1 ? "s" : ""} de esta pestaña: nunca llegaron
              </div>
            )}
            <div
              data-testid="activity-line"
              onClick={l.trace ? () => setTrace(l.trace) : undefined}
              style={{
                padding: "3px 0",
                borderBottom: "1px solid rgba(255,255,255,0.05)",
                cursor: l.trace ? "pointer" : undefined,
                background: l.warn ? "rgba(248,113,113,0.12)" : undefined,
                overflowWrap: "anywhere",
              }}
            >
              <span style={{ opacity: 0.6 }}>{l.time}</span>
              {" · "}<b>{l.who}</b>
              {" · "}<span style={{ color: SourceColor[l.source] }}>{l.source}</span>
              {l.where && <>{" · "}<span style={{ opacity: 0.75 }}>{l.where}</span></>}
              {" · "}{l.what}
              {l.context && <>{" · "}<span style={{ opacity: 0.85 }}>{l.context}</span></>}
              {l.delivery && (
                <>{" · "}<span style={{ color: l.delivery === "en vivo" ? "rgba(255,255,255,0.45)" : "#fca5a5" }}>{l.delivery}</span></>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ActividadPage() {
  return (
    <ProtectedPage requiredPage="/actividad">
      <ActividadContent />
    </ProtectedPage>
  );
}
