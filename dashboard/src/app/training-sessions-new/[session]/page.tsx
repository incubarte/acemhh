"use client";

import React, { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import ProtectedPage from "../../components/ProtectedPage";
import { usePageTitle } from "../../components/PageTitleContext";

// Redesigned attendance & payments screen. Presence is expressed by the
// section a player sits in; to toggle it, long-press a row (1s), a goal bar
// appears on the free half of the screen, and the player is dragged into it.

type RosterPlayer = {
  id: string;
  name: string;
  last_name: string;
  categories: string[];
  invitee: boolean;
  player_type: "player" | "goalkeeper";
  scholarship: number;
  attended: boolean;
  payments: number;
  hasSessionPayment: boolean;
  paidMonthlyThisMonth: boolean;
  paidMembershipDues: boolean;
  qualifies: boolean;
  recent_attendance: boolean;
  carryover_sessions: number;
  debt: number;
  debt_months: { month: string; charge: number; paid: number }[];
  month_preset: number | null;
  session_preset: number | null;
  owes_now: boolean | null;
  bought_month: boolean;
};

const MONTH_NAMES_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function monthNameEs(month: string) {
  return MONTH_NAMES_ES[Number(month.slice(5)) - 1] ?? month;
}

function formatArs(amount: number) {
  if (amount >= 1000 && amount % 1000 === 0) return `${amount / 1000}k`;
  return new Intl.NumberFormat("es-AR").format(amount);
}

const LongPressMs = 1000;
const FlashMs = 250;
const rowBorder = "1px solid rgba(255,255,255,0.07)";

type DragState = {
  player: RosterPlayer;
  toPresent: boolean;
  goalAt: "top" | "bottom";
  overGoal: boolean;
};

function TrainingSessionNewContent() {
  const params = useParams();
  const session = params.session as string; // YYYY-MM-DD-HH

  const [players, setPlayers] = useState<RosterPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [expandedAbsent, setExpandedAbsent] = useState(false);
  const [debtModalPlayer, setDebtModalPlayer] = useState<RosterPlayer | null>(null);

  // Payment flow
  const [payingId, setPayingId] = useState<string | null>(null);
  const [pendingAmount, setPendingAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [busy, setBusy] = useState(false);

  // Search popup
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ id: string; name: string; last_name: string }[]>([]);

  // Long-press drag
  const [drag, setDrag] = useState<DragState | null>(null);
  const [flash, setFlash] = useState<"ok" | "fail" | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;
  const goalRef = useRef<HTMLDivElement | null>(null);
  const pressRef = useRef<{ timer: number; x: number; y: number } | null>(null);

  const reload = useCallback(async () => {
    const res = await fetch(`/api/training-sessions-new/${session}`);
    if (!res.ok) {
      setErr(await res.text());
      setLoading(false);
      return;
    }
    const data = await res.json();
    setPlayers((data.players ?? []) as RosterPlayer[]);
    setErr(null);
    setLoading(false);
  }, [session]);

  useEffect(() => {
    reload();
  }, [reload]);

  const setAttendance = async (playerId: string, attended: boolean) => {
    const res = await fetch(`/api/training-sessions/${session}/attendance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ player_id: playerId, attended }),
    });
    if (res.ok) await reload();
    return res.ok;
  };

  // ---- Long-press + drag-to-goal ----

  const cancelPress = () => {
    if (pressRef.current) {
      window.clearTimeout(pressRef.current.timer);
      pressRef.current = null;
    }
  };

  const finishDrag = useCallback(async (clientX: number, clientY: number) => {
    const current = dragRef.current;
    setDrag(null);
    if (!current) return;

    const rect = goalRef.current?.getBoundingClientRect();
    const overGoal = !!rect &&
      clientX >= rect.left && clientX <= rect.right &&
      clientY >= rect.top && clientY <= rect.bottom;

    if (overGoal) {
      await setAttendance(current.player.id, current.toPresent);
      setFlash("ok");
    } else {
      setFlash("fail");
    }
    window.setTimeout(() => setFlash(null), FlashMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activateDrag = (player: RosterPlayer, rowMidY: number) => {
    pressRef.current = null;
    const goalAt = rowMidY < window.innerHeight / 2 ? "bottom" : "top";
    setDrag({ player, toPresent: !player.attended, goalAt, overGoal: false });

    const onMove = (e: PointerEvent) => {
      const rect = goalRef.current?.getBoundingClientRect();
      const over = !!rect &&
        e.clientX >= rect.left && e.clientX <= rect.right &&
        e.clientY >= rect.top && e.clientY <= rect.bottom;
      setDrag((prev) => (prev && prev.overGoal !== over ? { ...prev, overGoal: over } : prev));
    };
    // While dragging, the finger must not scroll the page.
    const onTouchMove = (e: TouchEvent) => e.preventDefault();
    const onUp = (e: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("touchmove", onTouchMove);
      finishDrag(e.clientX, e.clientY);
    };
    const onCancel = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("touchmove", onTouchMove);
      setDrag(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
  };

  const rowPressHandlers = (player: RosterPlayer) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (dragRef.current) return;
      cancelPress();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const rowMidY = rect.top + rect.height / 2;
      pressRef.current = {
        x: e.clientX,
        y: e.clientY,
        timer: window.setTimeout(() => activateDrag(player, rowMidY), LongPressMs),
      };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const press = pressRef.current;
      if (!press) return;
      // Moving early means scrolling, not long-pressing.
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 12) cancelPress();
    },
    onPointerUp: () => cancelPress(),
    onPointerLeave: () => cancelPress(),
    onPointerCancel: () => cancelPress(),
  });

  // ---- Payments ----

  const registerPayment = async (playerId: string, amount: number) => {
    setBusy(true);
    const res = await fetch(`/api/training-sessions/${session}/payment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ player_id: playerId, amount }),
    });
    setBusy(false);
    if (!res.ok) {
      const text = await res.text();
      alert(text.includes("duplicate") || text.includes("23505") ? "Pago ya registrado" : "Error al registrar pago");
      return;
    }
    setPayingId(null);
    setPendingAmount(null);
    setCustomAmount("");
    await reload();
  };

  const presetsFor = (p: RosterPlayer) => {
    if (p.month_preset || p.session_preset) {
      return [
        ...(p.month_preset ? [{ label: `Mes ${formatArs(p.month_preset)}`, amount: p.month_preset }] : []),
        ...(p.session_preset ? [{ label: `Sesión ${formatArs(p.session_preset)}`, amount: p.session_preset }] : []),
      ];
    }
    return [100000, 75000, 50000, 30000].map((amount) => ({ label: formatArs(amount), amount }));
  };

  // ---- Grouping ----

  const jugadores = players.filter((p) => p.player_type !== "goalkeeper");
  const arqueros = players.filter((p) => p.player_type === "goalkeeper");

  const presentes = jugadores.filter((p) => p.attended);
  const faltaPagar = presentes.filter((p) => !p.bought_month && p.owes_now === true);
  const pagoMes = presentes.filter((p) => p.bought_month);
  const pagoSesion = presentes.filter((p) => !p.bought_month && p.owes_now !== true);

  const ausentesTodos = jugadores.filter((p) => !p.attended);
  const ausentesBase = ausentesTodos.filter((p) =>
    p.hasSessionPayment || p.bought_month || p.paidMonthlyThisMonth ||
    (p.qualifies && p.recent_attendance)
  );
  const baseIds = new Set(ausentesBase.map((p) => p.id));
  const ausentesExtra = ausentesTodos.filter((p) => p.qualifies && !baseIds.has(p.id));

  // ---- Rendering ----

  const dot = (p: RosterPlayer) =>
    p.carryover_sessions > 0 ? (
      <span
        title={`${p.carryover_sessions} sesión(es) bonificada(s)`}
        style={{ color: "#4ade80", marginLeft: 4, letterSpacing: 2 }}
      >
        {"•".repeat(Math.min(3, p.carryover_sessions))}
      </span>
    ) : null;

  const renderRow = (p: RosterPlayer, opts: { payments?: boolean } = {}) => {
    const hasDebt = (p.debt ?? 0) > 0;
    const dragging = drag?.player.id === p.id;
    const nameBg = hasDebt || (!p.invitee && !p.paidMembershipDues)
      ? "rgba(220, 38, 38, 0.45)"
      : "transparent";

    return (
      <React.Fragment key={p.id}>
        <div
          data-player-row={p.id}
          {...rowPressHandlers(p)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 8px",
            borderBottom: rowBorder,
            touchAction: "pan-y",
            userSelect: "none",
            WebkitUserSelect: "none",
            background: dragging ? "rgba(36, 179, 91, 0.25)" : undefined,
            transform: dragging ? "scale(1.04)" : undefined,
            boxShadow: dragging ? "0 6px 18px rgba(0,0,0,0.5)" : undefined,
            transition: "transform 120ms ease, background 120ms ease",
            position: dragging ? "relative" : undefined,
            zIndex: dragging ? 60 : undefined,
          }}
        >
          <span
            onClick={hasDebt ? () => setDebtModalPlayer(p) : undefined}
            style={{
              flex: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: "0.9rem",
              background: nameBg,
              borderRadius: 4,
              padding: "2px 6px",
              cursor: hasDebt ? "pointer" : undefined,
            }}
          >
            {p.last_name}, {p.name}
            {dot(p)}
          </span>

          {opts.payments && (
            <>
              {p.payments > 0 && (
                <span style={{ fontSize: "0.85rem", fontVariantNumeric: "tabular-nums" }}>
                  ${formatArs(p.payments)}
                </span>
              )}
              <button
                onClick={() => {
                  setPayingId(payingId === p.id ? null : p.id);
                  setPendingAmount(null);
                  setCustomAmount("");
                }}
                style={{
                  padding: "2px 8px",
                  borderRadius: 4,
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "rgba(255,255,255,0.05)",
                  cursor: "pointer",
                }}
              >
                +
              </button>
            </>
          )}
        </div>

        {opts.payments && payingId === p.id && (
          <div style={{ padding: "8px", borderBottom: rowBorder, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {pendingAmount === null ? (
              <>
                {presetsFor(p).map(({ label, amount }) => (
                  <button key={label} onClick={() => setPendingAmount(amount)}
                    style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.05)", cursor: "pointer", fontSize: "0.85rem" }}>
                    {label}
                  </button>
                ))}
                <input
                  type="number"
                  placeholder="Otro..."
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                  style={{ width: 90, padding: "6px 8px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.05)", color: "inherit", fontSize: "0.85rem" }}
                />
                {customAmount && (
                  <button
                    onClick={() => {
                      let amount = parseInt(customAmount, 10);
                      if (isNaN(amount) || amount <= 0) return alert("Monto inválido");
                      if (amount < 1000) amount = amount * 1000;
                      setPendingAmount(amount);
                    }}
                    style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(36,179,91,0.2)", cursor: "pointer", fontSize: "0.85rem" }}
                  >
                    OK
                  </button>
                )}
              </>
            ) : (
              <>
                <span style={{ fontSize: "0.9rem" }}>¿Registrar pago de ${formatArs(pendingAmount)}?</span>
                <button disabled={busy} onClick={() => registerPayment(p.id, pendingAmount)}
                  style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(36,179,91,0.2)", cursor: "pointer", fontSize: "0.85rem" }}>
                  Ok
                </button>
                <button disabled={busy} onClick={() => { setPendingAmount(null); setCustomAmount(""); }}
                  style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.05)", cursor: "pointer", fontSize: "0.85rem" }}>
                  Cancelar
                </button>
              </>
            )}
          </div>
        )}
      </React.Fragment>
    );
  };

  const subheader = (label: string) => (
    <div style={{
      padding: "6px 8px",
      fontSize: "0.7rem",
      letterSpacing: "0.1em",
      textTransform: "uppercase",
      opacity: 0.55,
      borderBottom: rowBorder,
      background: "rgba(255,255,255,0.03)",
    }}>
      {label}
    </div>
  );

  const sectionTitle = (label: string) => (
    <h2 style={{ fontSize: "1.05rem", fontWeight: 600, margin: "24px 0 6px" }}>{label}</h2>
  );

  usePageTitle("Asistencia y Pagos");

  if (loading) return <p style={{ marginTop: 16 }}>Cargando...</p>;
  if (err) return <p style={{ marginTop: 16, color: "crimson" }}>{err}</p>;

  return (
    <div style={{ paddingBottom: 60 }}>

      {sectionTitle(`Presentes — total: ${presentes.length}`)}
      <div data-testid="section-presentes" style={{ border: rowBorder, borderRadius: 10, overflow: "hidden" }}>
        {subheader("Falta pagar")}
        {faltaPagar.length === 0
          ? <p style={{ margin: 0, padding: "8px", fontSize: "0.85rem", opacity: 0.5 }}>Nadie</p>
          : faltaPagar.map((p) => renderRow(p, { payments: true }))}

        {subheader("Pagó sesión individual")}
        {pagoSesion.length === 0
          ? <p style={{ margin: 0, padding: "8px", fontSize: "0.85rem", opacity: 0.5 }}>Nadie</p>
          : pagoSesion.map((p) => renderRow(p, { payments: true }))}

        {subheader("Pagó mes completo")}
        {pagoMes.length === 0
          ? <p style={{ margin: 0, padding: "8px", fontSize: "0.85rem", opacity: 0.5 }}>Nadie</p>
          : pagoMes.map((p) => renderRow(p, { payments: true }))}
      </div>

      {sectionTitle("Ausentes")}
      <div data-testid="section-ausentes" style={{ border: rowBorder, borderRadius: 10, overflow: "hidden" }}>
        {ausentesBase.map((p) => renderRow(p))}
        {expandedAbsent && ausentesExtra.map((p) => renderRow(p))}
        {!expandedAbsent && ausentesExtra.length > 0 && (
          <button
            onClick={() => setExpandedAbsent(true)}
            style={{ width: "100%", padding: "10px", border: "none", borderBottom: rowBorder, background: "rgba(255,255,255,0.04)", cursor: "pointer", fontSize: "0.85rem" }}
          >
            Más jugadores...
          </button>
        )}
        <button
          onClick={() => { setSearchOpen(true); setQuery(""); setSearchResults([]); }}
          style={{ width: "100%", padding: "10px", border: "none", background: "rgba(255,255,255,0.04)", cursor: "pointer", fontSize: "0.85rem" }}
        >
          🔍 Buscar jugador
        </button>
      </div>

      {sectionTitle("Arqueros")}
      <div data-testid="section-arqueros" style={{ border: rowBorder, borderRadius: 10, overflow: "hidden" }}>
        {arqueros.length === 0
          ? <p style={{ margin: 0, padding: "8px", fontSize: "0.85rem", opacity: 0.5 }}>Sin arqueros</p>
          : arqueros.map((p) => (
            <div key={p.id} style={{ display: "flex", alignItems: "center" }}>
              <div style={{ flex: 1 }}>{renderRow(p)}</div>
              <span style={{ padding: "0 10px", opacity: p.attended ? 1 : 0.25 }}>😐</span>
            </div>
          ))}
      </div>

      {/* Goal bar for the drag-to-toggle gesture. */}
      {drag && (
        <div
          ref={goalRef}
          style={{
            position: "fixed",
            left: 10,
            right: 10,
            [drag.goalAt]: 10,
            height: 90,
            zIndex: 50,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 14,
            border: drag.overGoal ? "3px solid #4ade80" : "2px dashed rgba(255,255,255,0.5)",
            background: drag.overGoal ? "rgba(36, 179, 91, 0.35)" : "rgba(20, 30, 24, 0.92)",
            fontSize: "1rem",
            fontWeight: 700,
            letterSpacing: "0.03em",
          } as React.CSSProperties}
        >
          🥅 Cambiar a {drag.toPresent ? "PRESENTE" : "AUSENTE"}
        </div>
      )}

      {/* Full-screen feedback flash. */}
      {flash && (
        <div style={{
          position: "fixed",
          inset: 0,
          zIndex: 90,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: flash === "ok" ? "rgba(22, 101, 52, 0.85)" : "rgba(127, 29, 29, 0.85)",
          fontSize: "min(40vw, 40vh)",
        }}>
          {flash === "ok" ? "✅" : "❌"}
        </div>
      )}

      {/* Search popup: pick a player and mark them present. */}
      {searchOpen && (
        <div
          onClick={() => setSearchOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 80, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 20, paddingTop: 60 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 420, borderRadius: 12, border: "1px solid rgba(255,255,255,0.18)", background: "#1c2620", padding: 16 }}>
            <input
              autoFocus
              placeholder="Nombre o apellido"
              value={query}
              onChange={async (e) => {
                const q = e.target.value;
                setQuery(q);
                if (q.trim().length < 2) return setSearchResults([]);
                const res = await fetch(`/api/players?query=${encodeURIComponent(q.trim())}`);
                if (res.ok) {
                  const data = await res.json();
                  setSearchResults(data.players ?? []);
                }
              }}
              style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.05)", color: "inherit" }}
            />
            <div style={{ marginTop: 8 }}>
              {searchResults.map((r) => (
                <button
                  key={r.id}
                  onClick={async () => {
                    setSearchOpen(false);
                    await setAttendance(r.id, true);
                  }}
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 8px", border: "none", borderBottom: rowBorder, background: "transparent", cursor: "pointer", fontSize: "0.9rem" }}
                >
                  {r.last_name}, {r.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Debt detail modal. */}
      {debtModalPlayer && (
        <div
          onClick={() => setDebtModalPlayer(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 380, width: "100%", borderRadius: 12, border: "1px solid rgba(255,255,255,0.18)", background: "#261c1c", padding: 20 }}>
            <p style={{ fontSize: "1rem", fontWeight: 600, margin: 0 }}>
              {debtModalPlayer.last_name}, {debtModalPlayer.name}
            </p>
            <p style={{ marginTop: 8, fontSize: "1.2rem", fontWeight: 700, color: "#f87171" }}>
              Debe ${formatArs(debtModalPlayer.debt)}
            </p>
            <div style={{ marginTop: 10, fontSize: "0.85rem", opacity: 0.85 }}>
              {debtModalPlayer.debt_months.map((d) => (
                <div key={d.month} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                  <span>{monthNameEs(d.month)}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>
                    pagó ${formatArs(d.paid)} de ${formatArs(d.charge)}
                  </span>
                </div>
              ))}
            </div>
            <button onClick={() => setDebtModalPlayer(null)} style={{ marginTop: 12, width: "100%" }}>
              Cerrar
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

export default function TrainingSessionNewPage() {
  const params = useParams();
  return (
    <ProtectedPage requiredPage={`/training-sessions-new/${params.session}`}>
      <Suspense fallback={<div style={{ padding: 20, textAlign: "center" }}>Cargando...</div>}>
        <TrainingSessionNewContent />
      </Suspense>
    </ProtectedPage>
  );
}
