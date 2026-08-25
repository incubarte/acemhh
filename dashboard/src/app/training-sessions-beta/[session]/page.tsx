"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import ProtectedPage from "../../components/ProtectedPage";
import Overlay from "../../components/Overlay";
import SessionDateWarning from "../../components/SessionDateWarning";
import ExperienceToggle from "../../components/ExperienceToggle";
import { usePageTitle } from "../../components/PageTitleContext";
import type { PaymentConcept } from "@shared/tokens";

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
  half_month_preset: number | null;
  owes_now: boolean | null;
  bought_month: boolean;
  owes_if_present: boolean;
  owes_if_absent: boolean;
  owed_now: number;
  debt_outstanding: number;
  prev_owed: number;
  prev_attended: number;
  prev_paid: number;
  cur_attended: number;
  cur_paid: number;
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
/** How long a finger must stay on a row before the PRESENTE/AUSENTE word
 * appears. Long enough that a scroll starting on a row never flashes it,
 * short enough that a deliberate press feels immediate. */
const WheelRevealDelay = 180;

/** How long the wheel must sit still before a refresh is allowed to reshuffle
 * the rows. Long enough to cover a run of quick toggles, short enough that a
 * pause reads as "done". */
const QuietAfterGesture = 1000;

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
const DuesUnpaidRed = "#f87171";
const DuesPartialAmber = "#fbbf24";

/** The + button's width, mirrored as a left spacer so centred names land on
 * the row's true middle. */
const ActionWidth = 28;

/** One palette per section: a strong header (CR) over a muted body of the
 * same hue (CO). Rows add no colour of their own, so the section a row sits
 * in is the only thing its background says. Debtors get the deepest red so
 * they do not read as just another absent row. */
const SectionColors = {
  debt: { header: "#5f1414", body: "rgba(95, 20, 20, 0.55)" },
  present: { header: "#14532d", body: "rgba(20, 83, 45, 0.45)" },
  absent: { header: "#52525b", body: "rgba(82, 82, 91, 0.30)" },
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

/** Attended sessions of this month left unpaid, or what last month left
 * unpaid. Older debt is not what this screen chases. */
function isDebtor(p: RosterPlayer) {
  return p.owes_now === true || p.prev_owed > 0;
}

/** "A/PA C/PC": last month's attendance and payments, then this month's.
 * A month that owes nothing is not worth spelling out — the previous one
 * drops off entirely, the current one collapses to a dash. */
function debtorStats(p: RosterPlayer): string {
  const prev = p.prev_owed > 0 ? `${p.prev_attended}/${formatArs(p.prev_paid)}` : "";
  const cur = p.owes_now ? `${p.cur_attended}/${formatArs(p.cur_paid)}` : "-";
  return `${prev} ${cur}`.trim();
}

/**
 * The row as it stands the moment a payment is registered, before any
 * refresh: the amount joins the parentheses and the flags it settles follow.
 * Classification mirrors the API — up to one session's price is a session,
 * more than that is the month.
 */
function withPayment(p: RosterPlayer, amount: number): RosterPlayer {
  const isSession = p.session_preset !== null && amount <= p.session_preset;
  const buysMonth = p.month_preset !== null && amount >= p.month_preset;
  return {
    ...p,
    payments: p.payments + amount,
    payment_amounts: [...p.payment_amounts, amount],
    // Anything registered from here lands on this session (a session
    // payment) or on this slot's month, so either way it counts as paid here.
    hasSessionPayment: true,
    paidMonthlyForSlot: p.paidMonthlyForSlot || !isSession,
    bought_month: p.bought_month || buysMonth,
    // Whatever is left owing decides whether the row stays under Deben. A
    // payment that buys the month clears it outright.
    owed_now: buysMonth ? 0 : Math.max(0, p.owed_now - amount),
    owes_now: buysMonth ? false : Math.max(0, p.owed_now - amount) > 0,
    // Keeps the figures the debtors list shows in step with the payment.
    cur_paid: p.cur_paid + amount,
  };
}

type RosterResponse = {
  current_date?: string | null;
  players?: RosterPlayer[];
};

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
  tone,
}: {
  player: RosterPlayer;
  wheel: WheelVisual | undefined;
  gesture: GestureApi;
  onOpenDebt: (p: RosterPlayer) => void;
  onOpenPayment: (p: RosterPlayer) => void;
  showPayments: boolean;
  tone: SectionTone;
}) {
  const p = player;
  const hasDebt = (p.debt ?? 0) > 0;
  // Annual dues still owed. It no longer paints the row — the row's colour
  // belongs to its section — so it is a marker beside the name instead.
  const duesDot: string | null = p.invitee
    ? null
    : p.dues_status === "partial"
    ? DuesPartialAmber
    : p.dues_status === "none" ? DuesUnpaidRed : null;

  // Everywhere but the debtors list the name is centred, to sit under the
  // PRESENTE/AUSENTE the wheel puts in the same place. Debtors keep their
  // names left-aligned, with the figures that explain the debt on the right.
  const centred = tone !== "debt";

  // The debtors list is a bill, not a roster: it takes no wheel gesture, and
  // every row in it reads the same red whether the player showed up or not.
  // Attendance is toggled where the player actually sits.
  const inert = tone === "debt";

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
      onPointerDown={inert ? undefined : (e) => gesture.down(e, p)}
      onPointerMove={inert ? undefined : gesture.move}
      onPointerUp={inert ? undefined : gesture.up}
      onPointerCancel={inert ? undefined : gesture.cancel}
      // The browser's own long-press UI (context menu, iOS callout) must not
      // interfere with the wheel gesture.
      onContextMenu={inert ? undefined : (e) => e.preventDefault()}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 8px",
        borderBottom: rowBorder,
        touchAction: inert ? "auto" : "pan-y",
        userSelect: "none",
        WebkitUserSelect: "none",
        WebkitTouchCallout: "none",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {wheel && !inert && (
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

      {/* Balances the + button so the centred name sits on the row's real
          middle, where the wheel puts its word. */}
      {centred && showPayments && <span style={{ width: ActionWidth, flexShrink: 0 }} />}

      <span
        data-testid="player-name"
        onClick={hasDebt ? () => onOpenDebt(p) : undefined}
        style={{
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontSize: "0.9rem",
          padding: "2px 6px",
          textAlign: centred ? "center" : "left",
          cursor: hasDebt ? "pointer" : undefined,
          position: "relative",
        }}
      >
        {p.last_name}, {p.name}
        {duesDot && (
          <span
            data-testid="dues-dot"
            data-dues={p.dues_status}
            title={p.dues_status === "partial"
              ? "Cuota anual paga en parte"
              : "Cuota anual impaga"}
            style={{ color: duesDot, marginLeft: 5 }}
          >
            ●
          </span>
        )}
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

      {tone === "debt" && (
        // Attendance and payments behind the debt: last month, then this one.
        <span
          data-testid="debtor-stats"
          style={{
            fontSize: "0.75rem",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
            opacity: 0.9,
            flexShrink: 0,
            position: "relative",
          }}
        >
          {debtorStats(p)}
        </span>
      )}

      {showPayments && (
        <button
          onClick={() => onOpenPayment(p)}
          style={{
            width: ActionWidth,
            flexShrink: 0,
            padding: "2px 0",
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

/**
 * Marking somebody present who owes money. It warns and never blocks: whether
 * the player trains is the admin's call, and either way we want to know they
 * were there.
 */
function DebtWarningModal({
  player,
  onCancel,
  onConfirm,
  onCharge,
}: {
  player: RosterPlayer;
  onCancel: () => void;
  onConfirm: () => void;
  onCharge: () => void;
}) {
  const owed = (player.debt_outstanding ?? 0) + player.owed_now;
  return (
    <Overlay>
      <div
        onClick={onCancel}
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
          data-testid="debt-warning"
          onClick={(e) => e.stopPropagation()}
          style={{
            width: "100%",
            maxWidth: 380,
            borderRadius: 12,
            border: "1px solid #b45309",
            background: "#16211b",
            padding: 18,
          }}
        >
          <p style={{ margin: 0, fontWeight: 700, fontSize: "1.05rem" }}>
            {player.last_name}, {player.name}
          </p>
          <p style={{ margin: "8px 0 0", color: "#fbbf24" }}>
            Debe ${formatArs(owed)}
          </p>
          <p style={{ margin: "4px 0 0", opacity: 0.75, fontSize: "0.9rem" }}>
            Pasale el mensaje antes de que entrene.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
            <button className="btnPrimary" data-testid="debt-warning-charge" onClick={onCharge}>
              Marcar presente y cobrar
            </button>
            <button
              data-testid="debt-warning-anyway"
              onClick={onConfirm}
              style={{
                padding: 12,
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.2)",
                background: "rgba(255,255,255,0.06)",
                cursor: "pointer",
              }}
            >
              Marcar presente igual
            </button>
            <button
              onClick={onCancel}
              style={{
                padding: 12,
                borderRadius: 8,
                border: "none",
                background: "transparent",
                color: "inherit",
                cursor: "pointer",
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </Overlay>
  );
}

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
  onConfirm: (amount: number, concept: PaymentConcept) => void;
  busy: boolean;
}) {
  const [chosen, setChosen] = useState<{ amount: number; concept: PaymentConcept } | null>(null);
  const [custom, setCustom] = useState("");
  // "Otro..." has to say WHAT it is: the amount no longer decides.
  const [customConcept, setCustomConcept] = useState<PaymentConcept>("session");

  const sessionPreset = player.session_preset;
  const monthPreset = player.month_preset;
  const owing = player.debt_outstanding;

  const conceptLabel: Record<PaymentConcept, string> = {
    session: sessionLabel,
    monthly: monthLabel,
    "half month": "Lo que queda del mes",
    "debt settlement": "Saldo de meses anteriores",
  };

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

          {chosen === null ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
              {/* With debt outstanding, nothing else may be collected: the
                  money on the table settles it first. */}
              {owing > 0 ? (
                <button
                  data-testid="pay-debt"
                  style={button}
                  onClick={() => setChosen({ amount: owing, concept: "debt settlement" })}
                >
                  Saldar deuda · <strong>${formatArs(owing)}</strong>
                </button>
              ) : (
                <>
                  {sessionPreset !== null && (
                    <button
                      data-testid="pay-session"
                      style={button}
                      onClick={() => setChosen({ amount: sessionPreset, concept: "session" })}
                    >
                      Sesión individual · <strong>${formatArs(sessionPreset)}</strong>
                    </button>
                  )}
                  {monthPreset !== null && (
                    <button
                      data-testid="pay-month"
                      style={button}
                      onClick={() => setChosen({ amount: monthPreset, concept: "monthly" })}
                    >
                      Mes completo · <strong>${formatArs(monthPreset)}</strong>
                    </button>
                  )}
                  {/* Only for somebody starting the period with the month
                      already under way: it buys what is still to come. */}
                  {player.half_month_preset !== null && (
                    <button
                      data-testid="pay-half-month"
                      style={button}
                      onClick={() =>
                        setChosen({ amount: player.half_month_preset!, concept: "half month" })}
                    >
                      Lo que queda del mes ·{" "}
                      <strong>${formatArs(player.half_month_preset)}</strong>
                    </button>
                  )}
                </>
              )}
              <select
                data-testid="custom-concept"
                value={customConcept}
                onChange={(e) => setCustomConcept(e.target.value as PaymentConcept)}
                style={{ ...button, cursor: "pointer" }}
              >
                <option value="session">Otro monto · sesión individual</option>
                <option value="monthly">Otro monto · mes</option>
                {owing > 0 && <option value="debt settlement">Otro monto · deuda</option>}
              </select>
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
                    setChosen({ amount: value, concept: customConcept });
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
                ${formatArs(chosen.amount)}
              </p>
              <p style={{ margin: "4px 0 0", opacity: 0.75, fontSize: "0.9rem" }}>
                {conceptLabel[chosen.concept]}
              </p>
              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <button
                  style={{ ...button, textAlign: "center" }}
                  disabled={busy}
                  onClick={() => setChosen(null)}
                >
                  Cancelar
                </button>
                <button
                  className="btnPrimary"
                  style={{ flex: 1 }}
                  disabled={busy}
                  onClick={() => onConfirm(chosen.amount, chosen.concept)}
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
  /** Marking this player present is waiting on the admin's confirmation. */
  const [confirmPlayer, setConfirmPlayer] = useState<RosterPlayer | null>(null);
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
    /** Whether the word is on screen yet — see WheelRevealDelay. */
    revealed: boolean;
    revealTimer: ReturnType<typeof setTimeout> | null;
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

  // Only the newest refresh counts. A response is worth anything only while
  // no later request has been issued: since every optimistic change fires its
  // own refresh once its write landed, an outstanding later request is proof
  // this response predates something already on screen. Applying it would
  // revert that change, so it is dropped outright rather than held.
  const reqSeqRef = useRef(0);

  /** A refresh that arrived while the admin was still working, waiting for a
   * gap to be applied. Superseded wholesale by any newer response. */
  const pendingRef = useRef<RosterResponse | null>(null);
  /** performance.now() of the last gesture that ended; -Infinity before the
   * first one, so an untouched screen never holds anything back. */
  const lastGestureEndRef = useRef(-Infinity);
  const applyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyRoster = useCallback((data: RosterResponse) => {
    pendingRef.current = null;
    setCurrentDate(data.current_date ?? null);
    // Reuse the existing object for players whose data did not change, so
    // React skips re-rendering their (memoized) rows entirely.
    setPlayers((prev) => {
      const byId = new Map(prev.map((p) => [p.id, p]));
      return (data.players ?? []).map((incoming) => {
        const existing = byId.get(incoming.id);
        return existing && sameRoster(existing, incoming) ? existing : incoming;
      });
    });
    setErr(null);
    setLoading(false);
  }, []);

  /** Rows must not reshuffle under a thumb that is still marking attendance:
   * a refresh lands only once the wheel has been still for QuietAfterGesture.
   * Returns how long is left to wait, or 0 when the coast is clear. */
  const quietIn = useCallback(() => {
    if (gestureRef.current) return QuietAfterGesture;
    return Math.max(0, QuietAfterGesture - (performance.now() - lastGestureEndRef.current));
  }, []);

  const reload = useCallback(async () => {
    const seq = ++reqSeqRef.current;
    const res = await fetch(`/api/training-sessions-beta/${session}`);
    if (!res.ok) {
      setErr(await res.text());
      setLoading(false);
      return;
    }
    const data = (await res.json()) as RosterResponse;
    if (seq < reqSeqRef.current) return;

    if (quietIn() > 0) pendingRef.current = data;
    else applyRoster(data);
  }, [session, quietIn, applyRoster]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => () => {
    if (applyTimerRef.current !== null) clearTimeout(applyTimerRef.current);
  }, []);

  /** Called when a gesture ends — every gesture, including one that snapped
   * back without toggling: what buys the quiet window is the thumb being
   * busy, not the change. Restarts the wait, so a run of quick toggles keeps
   * the screen still until the admin actually stops. */
  const noteGestureEnd = useCallback(() => {
    lastGestureEndRef.current = performance.now();
    const arm = (delay: number) => {
      if (applyTimerRef.current !== null) clearTimeout(applyTimerRef.current);
      applyTimerRef.current = setTimeout(() => {
        applyTimerRef.current = null;
        // A finger may well be down on another row by now: this timer was
        // armed by the PREVIOUS gesture, and firing regardless would reshuffle
        // the list under the thumb that is marking right now.
        const wait = quietIn();
        if (wait > 0) return arm(wait);
        if (pendingRef.current) applyRoster(pendingRef.current);
      }, delay);
    };
    arm(QuietAfterGesture);
  }, [applyRoster, quietIn]);

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
          // Keeps the figures the debtors list shows in step with the toggle.
          cur_attended: p.attended === attended
            ? p.cur_attended
            : Math.max(0, p.cur_attended + (attended ? 1 : -1)),
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
          ? {
            ...p,
            attended: !attended,
            owes_now: attended ? p.owes_if_absent : p.owes_if_present,
            cur_attended: Math.max(0, p.cur_attended + (attended ? -1 : 1)),
          }
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
        if (target !== 0) {
          // Marking someone present who owes money is worth a word with them,
          // so the admin gets asked. It only ever warns: if they let the
          // player train anyway we still want the attendance recorded.
          const owes = !wasAttended &&
            ((g.player.debt_outstanding ?? 0) > 0 || g.player.owed_now > 0);
          if (owes) setConfirmPlayer(g.player);
          else setAttendance(playerId, !wasAttended);
        }
        return;
      }
      setRowWheel(playerId, { attended: wasAttended, x, width: W });
      animsRef.current.set(playerId, requestAnimationFrame(step));
    };
    animsRef.current.set(playerId, requestAnimationFrame(step));
  }, [setRowWheel, setAttendance]);

  /** Drops a gesture that never became a wheel turn, taking the pending
   * reveal with it. Only a revealed row is cleared, so a plain tap costs no
   * render at all. */
  const endGesture = useCallback((g: { player: RosterPlayer; revealed: boolean; revealTimer: ReturnType<typeof setTimeout> | null }) => {
    if (g.revealTimer !== null) clearTimeout(g.revealTimer);
    g.revealTimer = null;
    gestureRef.current = null;
    if (g.revealed) setRowWheel(g.player.id, null);
    noteGestureEnd();
  }, [setRowWheel, noteGestureEnd]);

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
      const g = {
        player,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        baseX,
        width: el.clientWidth,
        engaged: false,
        revealed: false,
        revealTimer: null as ReturnType<typeof setTimeout> | null,
        x: baseX,
        samples: [[performance.now(), baseX]] as [number, number][],
      };
      gestureRef.current = g;
      // Showing the word on finger-down flickers it on every scroll that
      // happens to start on a row. So it waits: a finger still on the row
      // after this long meant to be there. A sideways move reveals it at
      // once (below), a vertical one never does.
      g.revealTimer = setTimeout(() => {
        g.revealTimer = null;
        if (gestureRef.current !== g) return;
        g.revealed = true;
        setRowWheel(player.id, { attended: player.attended, x: g.x, width: g.width });
      }, WheelRevealDelay);
    },
    move: (e) => {
      const g = gestureRef.current;
      if (!g || g.pointerId !== e.pointerId) return;
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;

      if (!g.engaged) {
        // Vertical intent: the scroller's gesture, not ours.
        if (Math.abs(dy) > WheelSlop && Math.abs(dy) >= Math.abs(dx)) {
          endGesture(g);
          return;
        }
        if (Math.abs(dx) > WheelSlop && Math.abs(dx) > Math.abs(dy)) {
          g.engaged = true;
          // Sideways is unambiguous, so the word does not wait out the dwell.
          if (g.revealTimer !== null) clearTimeout(g.revealTimer);
          g.revealTimer = null;
          g.revealed = true;
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
        endGesture(g);
        return;
      }
      if (g.revealTimer !== null) clearTimeout(g.revealTimer);
      noteGestureEnd();
      const [t0, x0] = g.samples[0];
      const [t1, x1] = g.samples[g.samples.length - 1];
      // A finger that stopped before lifting releases with no inertia.
      const stale = performance.now() - t1 > 80;
      settleWheel(!stale && t1 > t0 ? (x1 - x0) / (t1 - t0) : 0);
    },
    cancel: () => {
      const g = gestureRef.current;
      if (g) endGesture(g);
    },
  }), [setRowWheel, settleWheel, endGesture, noteGestureEnd]);

  const registerPayment = useCallback(async (
    playerId: string,
    amount: number,
    concept: PaymentConcept,
  ) => {
    setBusy(true);
    const res = await fetch(`/api/training-sessions/${session}/payment`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ player_id: playerId, amount, concept }),
    });
    setBusy(false);
    if (!res.ok) {
      // The service refuses with a reason the admin can act on; show it
      // instead of a generic failure.
      alert(res.status === 409 ? await res.text() : "Error al registrar pago");
      return;
    }
    setPayModalPlayer(null);
    // Show it right away — the refresh that follows only confirms it.
    setPlayers((prev) => prev.map((p) => p.id === playerId ? withPayment(p, amount) : p));
    reload();
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

  const renderRows = (list: RosterPlayer[], tone: SectionTone, emptyText: string) =>
    list.length === 0
      ? <p style={{ margin: 0, padding: "10px", fontSize: "0.85rem", opacity: 0.5 }}>{emptyText}</p>
      : list.map((p) => (
        <PlayerRow
          key={p.id}
          player={p}
          tone={tone}
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
      <ExperienceToggle session={session} current="nueva" />
      <SessionDateWarning sessionDate={sessionDate} currentDate={currentDate} />

      {deudores.length > 0 && (
        <Section title="Deben" tone="debt" count={deudores.length} testId="section-deudores">
          {renderRows(deudores, "debt", "")}
        </Section>
      )}

      <Section
        title="Jugadores presentes"
        tone="present"
        count={jugadoresPresentes.length}
        testId="section-presentes"
      >
        {renderRows(jugadoresPresentes, "present", "Nadie")}
      </Section>

      <Section
        title="Jugadores ausentes"
        tone="absent"
        count={ausentesBase.length + (expandedAbsent ? ausentesExtra.length : 0)}
        testId="section-ausentes"
      >
        {renderRows(ausentesBase, "absent", "Nadie")}
        {expandedAbsent && ausentesExtra.map((p) => (
          <PlayerRow
            key={p.id}
            player={p}
            tone="absent"
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
        {renderRows(arquerosPresentes, "present", "Nadie")}
      </Section>

      <Section
        title="Arqueros ausentes"
        tone="absent"
        count={arquerosAusentes.length}
        testId="section-arqueros-ausentes"
      >
        {renderRows(arquerosAusentes, "absent", "Sin arqueros")}
      </Section>

      {confirmPlayer && (
        <DebtWarningModal
          player={confirmPlayer}
          onCancel={() => setConfirmPlayer(null)}
          onConfirm={() => {
            const p = confirmPlayer;
            setConfirmPlayer(null);
            setAttendance(p.id, true);
          }}
          onCharge={() => {
            const p = confirmPlayer;
            setConfirmPlayer(null);
            setAttendance(p.id, true);
            setPayModalPlayer(p);
          }}
        />
      )}

      {payModalPlayer && (
        <PaymentModal
          player={payModalPlayer}
          sessionLabel={sessionLabel}
          monthLabel={monthLabel}
          busy={busy}
          onClose={() => setPayModalPlayer(null)}
          onConfirm={(amount, concept) => registerPayment(payModalPlayer.id, amount, concept)}
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
    a.debt_outstanding === b.debt_outstanding &&
    a.owes_now === b.owes_now &&
    a.owes_if_present === b.owes_if_present &&
    a.owes_if_absent === b.owes_if_absent &&
    a.owed_now === b.owed_now &&
    a.prev_owed === b.prev_owed &&
    a.prev_attended === b.prev_attended &&
    a.prev_paid === b.prev_paid &&
    a.cur_attended === b.cur_attended &&
    a.cur_paid === b.cur_paid &&
    a.bought_month === b.bought_month &&
    a.carryover_sessions === b.carryover_sessions &&
    a.month_preset === b.month_preset &&
    a.session_preset === b.session_preset &&
    a.half_month_preset === b.half_month_preset &&
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
