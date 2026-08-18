"use client";

import React, { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import ProtectedPage from "../../components/ProtectedPage";
import Overlay from "../../components/Overlay";
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
  paidMonthlyForSlot: boolean;
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

const rowBorder = "1px solid rgba(255,255,255,0.07)";

// ---- Attendance wheel (horizontal thumb-wheel toggle) ----
// x is the wheel travel in px. Detents at -width, 0 and +width: 0 centers the
// current state, either extreme centers the other one (committing the toggle
// on release) — the wheel turns both ways.
type WheelState = {
  playerId: string;
  attended: boolean;
  x: number;
  width: number;
  /** Set while the committed row shrinks away after the toggle lands. */
  commit?: { height: number; collapsed: boolean };
};

/** Horizontal movement needed before the wheel engages (vs a tap). */
const WheelSlop = 10;
/** Release velocity (px/ms) that flicks to the next detent regardless of position. */
const FlickVelocity = 0.4;
const PresentGreen = "#15803d";
const AbsentRed = "#b91c1c";

/** Solid state color with a ~1-character fade to black at both edges; shared
 * by the wheel cells and the resting row's highlight band. */
const bandBg = (color: string) =>
  `linear-gradient(90deg, #000 0, ${color} 14px, ${color} calc(100% - 14px), #000 100%)`;

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

  // Attendance wheel
  const [wheel, setWheel] = useState<WheelState | null>(null);
  // Live gesture bookkeeping, mutated at pointer-event rate.
  const gestureRef = useRef<{
    playerId: string;
    attended: boolean;
    pointerId: number;
    startX: number;
    startY: number;
    width: number;
    height: number;
    engaged: boolean;
    x: number;
    /** Recent [time, x] samples for release velocity. */
    samples: [number, number][];
  } | null>(null);
  const animRef = useRef<number | null>(null);

  // Scroll blocker while the wheel is engaged: a PERMANENT non-passive
  // touchmove listener, registered at mount and inert otherwise. It must
  // pre-exist the touch — iOS Safari decides at touchstart whether touchmove
  // is cancelable, so a listener added mid-gesture never wins. Horizontal
  // swipes on a touch-action:pan-y row are not the scroller's to take, but
  // once engaged the finger may drift vertically and this keeps the page put.
  useEffect(() => {
    const fn = (e: TouchEvent) => {
      if (gestureRef.current?.engaged) e.preventDefault();
    };
    window.addEventListener("touchmove", fn, { passive: false });
    return () => window.removeEventListener("touchmove", fn);
  }, []);

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

  // ---- Attendance wheel gesture ----

  const settleWheel = useCallback((releaseVx: number) => {
    const g = gestureRef.current;
    gestureRef.current = null;
    if (!g || !g.engaged) {
      setWheel(null);
      return;
    }

    // Magnetic detents at -W, 0, +W: a flick snaps to the next detent in its
    // direction (never past it); otherwise the nearest one — i.e. whichever
    // section covers most of the row — wins.
    const W = g.width;
    const target = releaseVx > FlickVelocity
      ? Math.min(W, (Math.floor(g.x / W) + 1) * W)
      : releaseVx < -FlickVelocity
      ? Math.max(-W, (Math.ceil(g.x / W) - 1) * W)
      : Math.max(-W, Math.min(W, Math.round(g.x / W) * W));

    // Damped spring from the release position with the release velocity, so
    // the wheel keeps its inertia and the magnet reels it into the detent.
    let x = g.x;
    let v = releaseVx;
    let last = performance.now();
    const k = 0.0004;
    const c = 2 * Math.sqrt(k);
    const step = (now: number) => {
      const dt = Math.min(40, now - last);
      last = now;
      v += (target - x) * k * dt - c * v * dt;
      x += v * dt;
      if (Math.abs(target - x) < 1 && Math.abs(v) < 0.05) {
        animRef.current = null;
        if (target === 0) {
          setWheel(null);
          return;
        }
        // Toggle landed: keep the winning word on screen and shrink the row
        // away; the player reappears in their new section after the reload.
        setWheel({
          playerId: g.playerId,
          attended: g.attended,
          x: target,
          width: W,
          commit: { height: g.height, collapsed: false },
        });
        requestAnimationFrame(() =>
          setWheel((w) => w?.commit ? { ...w, commit: { ...w.commit, collapsed: true } } : w)
        );
        window.setTimeout(async () => {
          await setAttendance(g.playerId, !g.attended);
          setWheel(null);
        }, 240);
        return;
      }
      setWheel({ playerId: g.playerId, attended: g.attended, x, width: W });
      animRef.current = requestAnimationFrame(step);
    };
    animRef.current = requestAnimationFrame(step);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rowPressHandlers = (player: RosterPlayer) => ({
    onPointerDown: (e: React.PointerEvent) => {
      // Payment controls keep their own tap semantics, wheel-free.
      if ((e.target as HTMLElement).closest("button,input,select")) return;
      if (animRef.current) {
        cancelAnimationFrame(animRef.current);
        animRef.current = null;
      }
      if (wheel?.commit) return; // a committing row is already on its way out
      const el = e.currentTarget as HTMLElement;
      gestureRef.current = {
        playerId: player.id,
        attended: player.attended,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        width: el.clientWidth,
        height: el.getBoundingClientRect().height,
        engaged: false,
        x: 0,
        samples: [[performance.now(), 0]],
      };
      // The state word shows from the very finger-down.
      setWheel({ playerId: player.id, attended: player.attended, x: 0, width: el.clientWidth });
    },
    onPointerMove: (e: React.PointerEvent) => {
      const g = gestureRef.current;
      if (!g || g.pointerId !== e.pointerId) return;
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;

      if (!g.engaged) {
        // Vertical intent: the scroller's gesture, not ours.
        if (Math.abs(dy) > WheelSlop && Math.abs(dy) >= Math.abs(dx)) {
          gestureRef.current = null;
          setWheel(null);
          return;
        }
        if (Math.abs(dx) > WheelSlop && Math.abs(dx) > Math.abs(dy)) {
          g.engaged = true;
          try {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          } catch { /* capture is best-effort */ }
        } else {
          return;
        }
      }

      // The wheel turns both ways; rubber-band beyond the detents at ±width.
      const W = g.width;
      const x = dx > W ? W + (dx - W) / 4 : dx < -W ? -W + (dx + W) / 4 : dx;
      g.x = x;
      const now = performance.now();
      g.samples.push([now, x]);
      while (g.samples.length > 2 && now - g.samples[0][0] > 90) g.samples.shift();
      setWheel({ playerId: g.playerId, attended: g.attended, x, width: W });
    },
    onPointerUp: () => {
      const g = gestureRef.current;
      if (!g) return;
      if (!g.engaged) {
        gestureRef.current = null;
        setWheel(null);
        return;
      }
      const [t0, x0] = g.samples[0];
      const [t1, x1] = g.samples[g.samples.length - 1];
      // A finger that stopped before lifting releases with no inertia: stale
      // samples must not flick the wheel.
      const stale = performance.now() - t1 > 80;
      settleWheel(!stale && t1 > t0 ? (x1 - x0) / (t1 - t0) : 0);
    },
    onPointerCancel: () => {
      gestureRef.current = null;
      setWheel((w) => (w?.commit ? w : null));
    },
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
  // 2.1: a payment for this session, or the month bundle registered on this
  // slot, links anyone here; 2.2: qualifying by category needs attendance in
  // one of the slot's last 3 trainings.
  const ausentesBase = ausentesTodos.filter((p) =>
    p.hasSessionPayment || p.paidMonthlyForSlot ||
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
    const rowWheel = wheel && wheel.playerId === p.id ? wheel : null;
    const committing = rowWheel?.commit;
    // Three cells — [other][current][other] — so the wheel turns both ways.
    // Each cell is solid state color with the shared ~1-character edge fade;
    // the seam between sections is just where two fades meet.
    const currentWord = p.attended ? "PRESENTE" : "AUSENTE";
    const currentColor = p.attended ? PresentGreen : AbsentRed;
    const otherWord = p.attended ? "AUSENTE" : "PRESENTE";
    const otherColor = p.attended ? AbsentRed : PresentGreen;
    const cellStyle = (word: string, color: string): React.CSSProperties => ({
      width: "33.3333%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontWeight: 700,
      fontSize: "0.85rem",
      letterSpacing: "0.12em",
      color: "#fff",
      background: bandBg(color),
      borderRadius: 6,
    });

    return (
      <React.Fragment key={p.id}>
        <div
          data-player-row={p.id}
          {...rowPressHandlers(p)}
          // The browser's own long-press UI (context menu, iOS callout) must
          // not interfere with the wheel gesture.
          onContextMenu={(e) => e.preventDefault()}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: committing?.collapsed ? "0 8px" : "10px 8px",
            borderBottom: committing?.collapsed ? "none" : rowBorder,
            touchAction: "pan-y",
            userSelect: "none",
            WebkitUserSelect: "none",
            WebkitTouchCallout: "none",
            position: "relative",
            overflow: "hidden",
            // The committed row shrinks away; the reload then drops it for real.
            ...(committing
              ? {
                height: committing.collapsed ? 0 : committing.height,
                transition: "height 180ms ease, padding 180ms ease",
              }
              : {}),
          }}
        >
          {/* Resting highlight (debt / unpaid dues): same colors and gradient
              as the wheel cells. */}
          {hasDebt || (!p.invitee && !p.paidMembershipDues) ? (
            <div style={{
              position: "absolute",
              top: 9,
              bottom: 10,
              left: 0,
              right: 0,
              borderRadius: 6,
              background: bandBg(AbsentRed),
            }} />
          ) : null}
          {rowWheel && (
            <div
              data-testid="attendance-wheel"
              // Inset to the name pill's height: the wheel reads as the row's
              // content sliding, not a full-bleed band swallowing the padding.
              style={{
                position: "absolute",
                top: 9,
                bottom: 10,
                left: 0,
                width: "300%",
                display: "flex",
                zIndex: 5,
                pointerEvents: "none",
                transform: `translateX(${-rowWheel.width + rowWheel.x}px)`,
              }}
            >
              <div style={cellStyle(otherWord, otherColor)}>{otherWord}</div>
              <div style={cellStyle(currentWord, currentColor)}>{currentWord}</div>
              <div style={cellStyle(otherWord, otherColor)}>{otherWord}</div>
            </div>
          )}
          <span
            onClick={hasDebt ? () => setDebtModalPlayer(p) : undefined}
            style={{
              flex: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: "0.9rem",
              padding: "2px 6px",
              cursor: hasDebt ? "pointer" : undefined,
              position: "relative",
            }}
          >
            {p.last_name}, {p.name}
            {dot(p)}
          </span>

          {opts.payments && (
            <>
              {p.payments > 0 && (
                <span style={{ fontSize: "0.85rem", fontVariantNumeric: "tabular-nums", position: "relative" }}>
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

      {/* Search popup: pick a player and mark them present. */}
      {searchOpen && (
        <Overlay>
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
        </Overlay>
      )}

      {/* Debt detail modal. */}
      {debtModalPlayer && (
        <Overlay>
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
        </Overlay>
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
