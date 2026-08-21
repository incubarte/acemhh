"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import ProtectedPage from "../../components/ProtectedPage";
import Overlay from "../../components/Overlay";
import SessionDateWarning from "../../components/SessionDateWarning";
import { usePageTitle } from "../../components/PageTitleContext";

// Redesigned attendance & payments screen. Presence is expressed by the
// section a player sits in, and toggled with a horizontal thumb-wheel on the
// row itself.

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
  payment_amounts: number[];
  hasSessionPayment: boolean;
  paidMonthlyForSlot: boolean;
  paidMembershipDues: boolean;
  dues_status: "full" | "partial" | "none";
  qualifies: boolean;
  recent_attendance: boolean;
  carryover_sessions: number;
  debt: number;
  debt_months: { month: string; charge: number; paid: number }[];
  month_preset: number | null;
  session_preset: number | null;
  owes_now: boolean | null;
  bought_month: boolean;
  owes_if_present: boolean;
  owes_if_absent: boolean;
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
// on release) — the wheel turns both ways. One of these per row, keyed by
// player id: pure visual state, decoupled from the gesture.
type WheelVisual = {
  attended: boolean;
  x: number;
  width: number;
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

/** Annual dues owed: red for who paid nothing, dark amber for who paid part
 * of it. Settled players get no band. */
const DuesUnpaidRed = "#b91c1c";
const DuesPartialAmber = "#854d0e";

/** One palette per section, so where a row sits is readable at a glance. */
const SectionColors = {
  debt: { header: "#7f1d1d", body: "rgba(185, 28, 28, 0.10)" },
  present: { header: "#14532d", body: "rgba(21, 128, 61, 0.10)" },
  absent: { header: "#141414", body: "rgba(255, 255, 255, 0.02)" },
} as const;

type SectionTone = keyof typeof SectionColors;

function Section({
  title,
  tone,
  count,
  children,
  testId,
}: {
  title: string;
  tone: SectionTone;
  count: number;
  children: React.ReactNode;
  testId: string;
}) {
  const colors = SectionColors[tone];
  return (
    <section
      data-testid={testId}
      style={{
        marginTop: 16,
        borderRadius: 10,
        overflow: "hidden",
        border: rowBorder,
      }}
    >
      <div style={{
        background: colors.header,
        padding: "8px 12px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        fontWeight: 700,
        fontSize: "0.85rem",
        letterSpacing: "0.06em",
        textTransform: "uppercase",
      }}>
        <span>{title}</span>
        <span style={{ opacity: 0.75 }}>{count}</span>
      </div>
      <div style={{ background: colors.body }}>{children}</div>
    </section>
  );
}

/** Whether the player owes anything at all: money carried from earlier months,
 * or attended sessions of this month left unpaid. */
function isDebtor(p: RosterPlayer) {
  return (p.debt ?? 0) > 0 || p.owes_now === true;
}

// ---- Row ----

type GestureApi = {
  down: (e: React.PointerEvent, player: RosterPlayer) => void;
  move: (e: React.PointerEvent) => void;
  up: () => void;
  cancel: () => void;
};

const PlayerRow = React.memo(function PlayerRow({
  player,
  wheel,
  gesture,
  onOpenDebt,
  onOpenPayment,
  showPayments,
}: {
  player: RosterPlayer;
  wheel: WheelVisual | undefined;
  gesture: GestureApi;
  onOpenDebt: (p: RosterPlayer) => void;
  onOpenPayment: (p: RosterPlayer) => void;
  showPayments: boolean;
}) {
  const p = player;
  const hasDebt = (p.debt ?? 0) > 0;
  // Three dues states: settled (no band), partial (amber), none (red).
  // Training-ledger debt also paints the red band.
  const duesBand: "partial" | "solid" | null = p.invitee
    ? (hasDebt ? "solid" : null)
    : p.dues_status === "partial"
    ? "partial"
    : (p.dues_status === "none" || hasDebt) ? "solid" : null;

  // Three cells — [other][current][other] — so the wheel turns both ways.
  const currentWord = p.attended ? "PRESENTE" : "AUSENTE";
  const currentColor = p.attended ? PresentGreen : AbsentRed;
  const otherWord = p.attended ? "AUSENTE" : "PRESENTE";
  const otherColor = p.attended ? AbsentRed : PresentGreen;
  const cellStyle = (color: string): React.CSSProperties => ({
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
    <div
      data-player-row={p.id}
      onPointerDown={(e) => gesture.down(e, p)}
      onPointerMove={gesture.move}
      onPointerUp={gesture.up}
      onPointerCancel={gesture.cancel}
      // The browser's own long-press UI (context menu, iOS callout) must not
      // interfere with the wheel gesture.
      onContextMenu={(e) => e.preventDefault()}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 8px",
        borderBottom: rowBorder,
        touchAction: "pan-y",
        userSelect: "none",
        WebkitUserSelect: "none",
        WebkitTouchCallout: "none",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Resting highlight: money owed to the club — amber when part of the
          annual dues is already paid, red when none is. */}
      {duesBand ? (
        <div
          data-testid={duesBand === "partial" ? "dues-band-partial" : "dues-band-solid"}
          style={{
            position: "absolute",
            top: 9,
            bottom: 10,
            left: 0,
            right: 0,
            borderRadius: 6,
            background: bandBg(duesBand === "partial" ? DuesPartialAmber : DuesUnpaidRed),
          }}
        />
      ) : null}

      {wheel && (
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
            transform: `translateX(${-wheel.width + wheel.x}px)`,
          }}
        >
          <div style={cellStyle(otherColor)}>{otherWord}</div>
          <div style={cellStyle(currentColor)}>{currentWord}</div>
          <div style={cellStyle(otherColor)}>{otherWord}</div>
        </div>
      )}

      <span
        onClick={hasDebt ? () => onOpenDebt(p) : undefined}
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
        {p.payment_amounts.length > 0 && (
          <span style={{ opacity: 0.85 }}>
            {" "}({p.payment_amounts.map(formatArs).join(", ")})
          </span>
        )}
        {p.carryover_sessions > 0 && (
          // One dot per bonified session from last month.
          <span
            title={`${p.carryover_sessions} sesión(es) bonificada(s)`}
            style={{ color: "#4ade80", marginLeft: 4, letterSpacing: 2 }}
          >
            {"•".repeat(Math.min(3, p.carryover_sessions))}
          </span>
        )}
      </span>

      {showPayments && (
        <button
          onClick={() => onOpenPayment(p)}
          style={{
            padding: "2px 8px",
            borderRadius: 4,
            border: "1px solid rgba(255,255,255,0.2)",
            background: "rgba(255,255,255,0.15)",
            cursor: "pointer",
            position: "relative",
          }}
        >
          +
        </button>
      )}
    </div>
  );
});

// ---- Payment modal ----

function PaymentModal({
  player,
  sessionLabel,
  monthLabel,
  onClose,
  onConfirm,
  busy,
}: {
  player: RosterPlayer;
  sessionLabel: string;
  monthLabel: string;
  onClose: () => void;
  onConfirm: (amount: number) => void;
  busy: boolean;
}) {
  const [amount, setAmount] = useState<number | null>(null);
  const [custom, setCustom] = useState("");

  const sessionPreset = player.session_preset;
  const monthPreset = player.month_preset;
  // Mirrors how the API files a payment: anything up to one session's price
  // is a session, more than that is the month.
  const isSession = amount !== null && sessionPreset !== null && amount <= sessionPreset;

  const button: React.CSSProperties = {
    width: "100%",
    padding: "12px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.2)",
    background: "rgba(255,255,255,0.06)",
    cursor: "pointer",
    fontSize: "0.95rem",
    textAlign: "left",
  };

  return (
    <Overlay>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.65)",
          zIndex: 100,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
        }}
      >
        <div
          data-testid="payment-modal"
          onClick={(e) => e.stopPropagation()}
          style={{
            width: "100%",
            maxWidth: 380,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.18)",
            background: "#16211b",
            padding: 18,
          }}
        >
          <p style={{ margin: 0, fontWeight: 700, fontSize: "1.05rem" }}>
            {player.last_name}, {player.name}
          </p>

          {amount === null ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
              {sessionPreset !== null && (
                <button style={button} onClick={() => setAmount(sessionPreset)}>
                  Sesión individual · <strong>${formatArs(sessionPreset)}</strong>
                </button>
              )}
              {monthPreset !== null && (
                <button style={button} onClick={() => setAmount(monthPreset)}>
                  Mes completo · <strong>${formatArs(monthPreset)}</strong>
                </button>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="number"
                  inputMode="numeric"
                  placeholder="Otro..."
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  style={{
                    flex: 1,
                    padding: "12px",
                    borderRadius: 8,
                    border: "1px solid rgba(255,255,255,0.2)",
                    background: "rgba(255,255,255,0.06)",
                    color: "inherit",
                  }}
                />
                <button
                  className="btnPrimary"
                  disabled={!custom.trim()}
                  onClick={() => {
                    let value = parseInt(custom, 10);
                    if (!Number.isFinite(value) || value <= 0) return;
                    // Typing "30" means 30k: the amounts here are thousands.
                    if (value < 1000) value = value * 1000;
                    setAmount(value);
                  }}
                >
                  OK
                </button>
              </div>
              <button
                onClick={onClose}
                style={{ ...button, textAlign: "center", background: "transparent" }}
              >
                Cancelar
              </button>
            </div>
          ) : (
            <div style={{ marginTop: 14 }}>
              <p style={{ margin: 0, fontSize: "1.6rem", fontWeight: 700 }}>
                ${formatArs(amount)}
              </p>
              <p style={{ margin: "4px 0 0", opacity: 0.75, fontSize: "0.9rem" }}>
                {isSession ? sessionLabel : monthLabel}
              </p>
              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <button
                  style={{ ...button, textAlign: "center" }}
                  disabled={busy}
                  onClick={() => setAmount(null)}
                >
                  Cancelar
                </button>
                <button
                  className="btnPrimary"
                  style={{ flex: 1 }}
                  disabled={busy}
                  onClick={() => onConfirm(amount)}
                >
                  Confirmar
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Overlay>
  );
}

// ---- Screen ----

function TrainingSessionBetaContent() {
  const params = useParams();
  const session = params.session as string; // YYYY-MM-DD-HH
  const sessionDate = session.slice(0, 10);
  const sessionHour = session.slice(11);
  const sessionMonth = session.slice(0, 7);

  const [players, setPlayers] = useState<RosterPlayer[]>([]);
  /** The date the club is working on, to flag browsing a different session. */
  const [currentDate, setCurrentDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [expandedAbsent, setExpandedAbsent] = useState(false);
  const [debtModalPlayer, setDebtModalPlayer] = useState<RosterPlayer | null>(null);
  const [payModalPlayer, setPayModalPlayer] = useState<RosterPlayer | null>(null);
  const [busy, setBusy] = useState(false);

  // Search popup
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ id: string; name: string; last_name: string }[]>([]);

  // Attendance wheels: per-row VISUAL state. The gesture itself lives only
  // from pointerdown to pointerup (gestureRef, one finger); everything after
  // the finger-up is feedback owned by its row, so several rows can animate
  // while a new gesture runs.
  const [wheels, setWheels] = useState<Map<string, WheelVisual>>(new Map());
  const wheelsRef = useRef(wheels);
  wheelsRef.current = wheels;
  const setRowWheel = useCallback((playerId: string, v: WheelVisual | null) => {
    setWheels((prev) => {
      const m = new Map(prev);
      if (v) m.set(playerId, v);
      else m.delete(playerId);
      return m;
    });
  }, []);
  /** One rAF id per row animation, cancellable independently. */
  const animsRef = useRef<Map<string, number>>(new Map());

  const gestureRef = useRef<{
    player: RosterPlayer;
    pointerId: number;
    startX: number;
    startY: number;
    baseX: number;
    width: number;
    engaged: boolean;
    x: number;
    samples: [number, number][];
  } | null>(null);

  // Scroll blocker while the wheel is engaged: a PERMANENT non-passive
  // touchmove listener, registered at mount and inert otherwise. It must
  // pre-exist the touch — iOS Safari decides at touchstart whether touchmove
  // is cancelable, so a listener added mid-gesture never wins.
  useEffect(() => {
    const fn = (e: TouchEvent) => {
      if (gestureRef.current?.engaged) e.preventDefault();
    };
    window.addEventListener("touchmove", fn, { passive: false });
    return () => window.removeEventListener("touchmove", fn);
  }, []);

  // Only the newest refresh counts: any response older than the last one
  // applied is dropped, so overlapping requests can never resurrect stale
  // rows over an optimistic change.
  const reqSeqRef = useRef(0);
  const appliedSeqRef = useRef(0);

  const reload = useCallback(async () => {
    const seq = ++reqSeqRef.current;
    const res = await fetch(`/api/training-sessions-beta/${session}`);
    if (!res.ok) {
      setErr(await res.text());
      setLoading(false);
      return;
    }
    const data = await res.json();
    if (seq <= appliedSeqRef.current) return;
    appliedSeqRef.current = seq;
    setCurrentDate(data.current_date ?? null);
    // Reuse the existing object for players whose data did not change, so
    // React skips re-rendering their (memoized) rows entirely.
    setPlayers((prev) => {
      const byId = new Map(prev.map((p) => [p.id, p]));
      return (data.players ?? []).map((incoming: RosterPlayer) => {
        const existing = byId.get(incoming.id);
        return existing && sameRoster(existing, incoming) ? existing : incoming;
      });
    });
    setErr(null);
    setLoading(false);
  }, [session]);

  useEffect(() => {
    reload();
  }, [reload]);

  /** Marks attendance right away and refreshes in the background: the row
   * moves on the spot, and whichever refresh lands last wins. */
  const setAttendance = useCallback(async (playerId: string, attended: boolean) => {
    setPlayers((prev) => prev.map((p) =>
      p.id === playerId
        ? {
          ...p,
          attended,
          // Presence changes what this month owes, which decides whether the
          // player shows up under Deudores; both outcomes came precomputed.
          owes_now: attended ? p.owes_if_present : p.owes_if_absent,
        }
        : p
    ));

    const res = await fetch(`/api/training-sessions/${session}/attendance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ player_id: playerId, attended }),
    });
    if (!res.ok) {
      // Put it back: the write never happened.
      setPlayers((prev) => prev.map((p) =>
        p.id === playerId
          ? { ...p, attended: !attended, owes_now: attended ? p.owes_if_absent : p.owes_if_present }
          : p
      ));
      return;
    }
    reload();
  }, [session, reload]);

  const settleWheel = useCallback((releaseVx: number) => {
    const g = gestureRef.current;
    gestureRef.current = null;
    if (!g || !g.engaged) {
      if (g) setRowWheel(g.player.id, null);
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
    const playerId = g.player.id;
    const wasAttended = g.player.attended;
    const step = (now: number) => {
      const dt = Math.min(40, now - last);
      last = now;
      v += (target - x) * k * dt - c * v * dt;
      x += v * dt;
      if (Math.abs(target - x) < 1 && Math.abs(v) < 0.05) {
        animsRef.current.delete(playerId);
        setRowWheel(playerId, null);
        if (target !== 0) setAttendance(playerId, !wasAttended);
        return;
      }
      setRowWheel(playerId, { attended: wasAttended, x, width: W });
      animsRef.current.set(playerId, requestAnimationFrame(step));
    };
    animsRef.current.set(playerId, requestAnimationFrame(step));
  }, [setRowWheel, setAttendance]);

  // Stable across renders so memoized rows are not invalidated by it.
  const gesture: GestureApi = useMemo(() => ({
    down: (e, player) => {
      if ((e.target as HTMLElement).closest("button,input,select")) return;
      const id = animsRef.current.get(player.id);
      if (id !== undefined) {
        cancelAnimationFrame(id);
        animsRef.current.delete(player.id);
      }
      const el = e.currentTarget as HTMLElement;
      const baseX = wheelsRef.current.get(player.id)?.x ?? 0;
      gestureRef.current = {
        player,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        baseX,
        width: el.clientWidth,
        engaged: false,
        x: baseX,
        samples: [[performance.now(), baseX]],
      };
      // The state word shows from the very finger-down.
      setRowWheel(player.id, { attended: player.attended, x: baseX, width: el.clientWidth });
    },
    move: (e) => {
      const g = gestureRef.current;
      if (!g || g.pointerId !== e.pointerId) return;
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;

      if (!g.engaged) {
        // Vertical intent: the scroller's gesture, not ours.
        if (Math.abs(dy) > WheelSlop && Math.abs(dy) >= Math.abs(dx)) {
          gestureRef.current = null;
          setRowWheel(g.player.id, null);
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
      const raw = g.baseX + dx;
      const x = raw > W ? W + (raw - W) / 4 : raw < -W ? -W + (raw + W) / 4 : raw;
      g.x = x;
      const now = performance.now();
      g.samples.push([now, x]);
      while (g.samples.length > 2 && now - g.samples[0][0] > 90) g.samples.shift();
      setRowWheel(g.player.id, { attended: g.player.attended, x, width: W });
    },
    up: () => {
      const g = gestureRef.current;
      if (!g) return;
      if (!g.engaged) {
        gestureRef.current = null;
        setRowWheel(g.player.id, null);
        return;
      }
      const [t0, x0] = g.samples[0];
      const [t1, x1] = g.samples[g.samples.length - 1];
      // A finger that stopped before lifting releases with no inertia.
      const stale = performance.now() - t1 > 80;
      settleWheel(!stale && t1 > t0 ? (x1 - x0) / (t1 - t0) : 0);
    },
    cancel: () => {
      const g = gestureRef.current;
      gestureRef.current = null;
      if (g) setRowWheel(g.player.id, null);
    },
  }), [setRowWheel, settleWheel]);

  const registerPayment = useCallback(async (playerId: string, amount: number) => {
    setBusy(true);
    const res = await fetch(`/api/training-sessions/${session}/payment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ player_id: playerId, amount }),
    });
    setBusy(false);
    if (!res.ok) {
      const text = await res.text();
      alert(text.includes("duplicate") || text.includes("23505")
        ? "Pago ya registrado"
        : "Error al registrar pago");
      return;
    }
    setPayModalPlayer(null);
    await reload();
  }, [session, reload]);

  const openDebt = useCallback((p: RosterPlayer) => setDebtModalPlayer(p), []);
  const openPayment = useCallback((p: RosterPlayer) => setPayModalPlayer(p), []);

  // ---- Grouping ----

  const jugadores = players.filter((p) => p.player_type !== "goalkeeper");
  const arqueros = players.filter((p) => p.player_type === "goalkeeper");

  const deudores = players.filter(isDebtor);

  const jugadoresPresentes = jugadores.filter((p) => p.attended);
  const arquerosPresentes = arqueros.filter((p) => p.attended);

  // Absent list: paid this session or this slot's bundle links anyone here;
  // qualifying by category needs attendance in one of the last 3 trainings.
  const ausentesBase = jugadores.filter((p) =>
    !p.attended &&
    (p.hasSessionPayment || p.paidMonthlyForSlot || (p.qualifies && p.recent_attendance))
  );
  const baseIds = new Set(ausentesBase.map((p) => p.id));
  const ausentesExtra = jugadores.filter((p) =>
    !p.attended && p.qualifies && !baseIds.has(p.id)
  );
  const arquerosAusentes = arqueros.filter((p) => !p.attended);

  const sessionLabel = useMemo(() => {
    const d = new Date(`${sessionDate}T12:00:00`);
    const label = d.toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" });
    return `Sesión del ${label} ${sessionHour}hs`;
  }, [sessionDate, sessionHour]);
  const monthLabel = `Mes de ${monthNameEs(sessionMonth)}`;

  const renderRows = (list: RosterPlayer[], emptyText: string) =>
    list.length === 0
      ? <p style={{ margin: 0, padding: "10px", fontSize: "0.85rem", opacity: 0.5 }}>{emptyText}</p>
      : list.map((p) => (
        <PlayerRow
          key={p.id}
          player={p}
          wheel={wheels.get(p.id)}
          gesture={gesture}
          onOpenDebt={openDebt}
          onOpenPayment={openPayment}
          showPayments
        />
      ));

  usePageTitle("Asistencia y Pagos");

  if (loading) return <p style={{ marginTop: 16 }}>Cargando...</p>;
  if (err) return <p style={{ marginTop: 16, color: "crimson" }}>{err}</p>;

  return (
    <div style={{ paddingBottom: 60 }}>
      <SessionDateWarning sessionDate={sessionDate} currentDate={currentDate} />

      {deudores.length > 0 && (
        <Section title="Deben" tone="debt" count={deudores.length} testId="section-deudores">
          {renderRows(deudores, "")}
        </Section>
      )}

      <Section
        title="Jugadores presentes"
        tone="present"
        count={jugadoresPresentes.length}
        testId="section-presentes"
      >
        {renderRows(jugadoresPresentes, "Nadie")}
      </Section>

      <Section
        title="Jugadores ausentes"
        tone="absent"
        count={ausentesBase.length + (expandedAbsent ? ausentesExtra.length : 0)}
        testId="section-ausentes"
      >
        {renderRows(ausentesBase, "Nadie")}
        {expandedAbsent && ausentesExtra.map((p) => (
          <PlayerRow
            key={p.id}
            player={p}
            wheel={wheels.get(p.id)}
            gesture={gesture}
            onOpenDebt={openDebt}
            onOpenPayment={openPayment}
            showPayments
          />
        ))}
        {!expandedAbsent && ausentesExtra.length > 0 && (
          <button
            onClick={() => setExpandedAbsent(true)}
            style={{
              width: "100%",
              padding: "10px",
              border: "none",
              borderBottom: rowBorder,
              background: "rgba(255,255,255,0.04)",
              cursor: "pointer",
              fontSize: "0.85rem",
            }}
          >
            Más jugadores...
          </button>
        )}
        <button
          onClick={() => { setSearchOpen(true); setQuery(""); setSearchResults([]); }}
          style={{
            width: "100%",
            padding: "10px",
            border: "none",
            background: "rgba(255,255,255,0.04)",
            cursor: "pointer",
            fontSize: "0.85rem",
          }}
        >
          🔍 Buscar jugador
        </button>
      </Section>

      <Section
        title="Arqueros presentes"
        tone="present"
        count={arquerosPresentes.length}
        testId="section-arqueros-presentes"
      >
        {renderRows(arquerosPresentes, "Nadie")}
      </Section>

      <Section
        title="Arqueros ausentes"
        tone="absent"
        count={arquerosAusentes.length}
        testId="section-arqueros-ausentes"
      >
        {renderRows(arquerosAusentes, "Sin arqueros")}
      </Section>

      {payModalPlayer && (
        <PaymentModal
          player={payModalPlayer}
          sessionLabel={sessionLabel}
          monthLabel={monthLabel}
          busy={busy}
          onClose={() => setPayModalPlayer(null)}
          onConfirm={(amount) => registerPayment(payModalPlayer.id, amount)}
        />
      )}

      {/* Search popup: pick a player and mark them present. */}
      {searchOpen && (
        <Overlay>
          <div
            onClick={() => setSearchOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.6)",
              zIndex: 80,
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "center",
              padding: 20,
              paddingTop: 60,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: "100%",
                maxWidth: 420,
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.18)",
                background: "#1c2620",
                padding: 16,
              }}
            >
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
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "rgba(255,255,255,0.05)",
                  color: "inherit",
                }}
              />
              <div style={{ marginTop: 8 }}>
                {searchResults.map((r) => (
                  <button
                    key={r.id}
                    onClick={async () => {
                      setSearchOpen(false);
                      await setAttendance(r.id, true);
                    }}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 8px",
                      border: "none",
                      borderBottom: rowBorder,
                      background: "transparent",
                      cursor: "pointer",
                      fontSize: "0.9rem",
                    }}
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
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 100,
              padding: 20,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                maxWidth: 380,
                width: "100%",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.18)",
                background: "#261c1c",
                padding: 20,
              }}
            >
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

/** Whether a refreshed row carries anything the screen would draw differently.
 * Equal rows keep their previous object so memoized rows never re-render. */
function sameRoster(a: RosterPlayer, b: RosterPlayer): boolean {
  return a.attended === b.attended &&
    a.payments === b.payments &&
    a.payment_amounts.length === b.payment_amounts.length &&
    a.payment_amounts.every((v, i) => v === b.payment_amounts[i]) &&
    a.hasSessionPayment === b.hasSessionPayment &&
    a.paidMonthlyForSlot === b.paidMonthlyForSlot &&
    a.dues_status === b.dues_status &&
    a.debt === b.debt &&
    a.owes_now === b.owes_now &&
    a.owes_if_present === b.owes_if_present &&
    a.owes_if_absent === b.owes_if_absent &&
    a.bought_month === b.bought_month &&
    a.carryover_sessions === b.carryover_sessions &&
    a.month_preset === b.month_preset &&
    a.session_preset === b.session_preset &&
    a.qualifies === b.qualifies &&
    a.recent_attendance === b.recent_attendance &&
    a.name === b.name &&
    a.last_name === b.last_name;
}

export default function TrainingSessionBetaPage() {
  const params = useParams();
  return (
    <ProtectedPage requiredPage={`/training-sessions-beta/${params.session}`}>
      <Suspense fallback={<div style={{ padding: 20, textAlign: "center" }}>Cargando...</div>}>
        <TrainingSessionBetaContent />
      </Suspense>
    </ProtectedPage>
  );
}
