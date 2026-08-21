"use client";

import React, { Suspense, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import ProtectedPage from "../../components/ProtectedPage";
import Overlay from "../../components/Overlay";
import SessionDateWarning from "../../components/SessionDateWarning";
import { usePageTitle } from "../../components/PageTitleContext";
import { paymentThresholdOverride } from "@/lib/thresholds";

type Player = {
  id: string;
  name: string;
  last_name: string;
  categories: string[];
};

type PlayerWithAttendance = Player & {
  attended: boolean;
  payments: number;
  hasSessionPayment: boolean;
  paidMembershipDues: boolean;
  dues_status: "full" | "partial" | "none";
  invitee: boolean;
  player_type: "player" | "goalkeeper";
  scholarship: number;
  /** Bonified sessions from last month (club's fault), usable this month. */
  carryover_sessions: number;
  /** Accumulated unpaid pesos from earlier months. */
  debt: number;
  debt_months: { month: string; charge: number; paid: number }[];
  /** This month's bundle for the player, carryover-adjusted; null = no bundle. */
  month_preset: number | null;
  session_preset: number | null;
  /** Whether this month's charge is currently unpaid; null on pre-ledger sessions. */
  owes_now: boolean | null;
  section: "jugadores" | "invitados" | "arqueros";
};

const MONTH_NAMES_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function monthNameEs(month: string) {
  return MONTH_NAMES_ES[Number(month.slice(5)) - 1] ?? month;
}

const ALL_CATEGORIES = ["youth", "cat-c", "cat-b", "cat-a"];

// How faded the attendance face is when a player did not attend. Low enough to read
// as "off" at a glance on a phone, high enough to stay visible on the dark theme.
const AbsentOpacity = 0.3;

const CATEGORY_SHORT_LABELS: Record<string, string> = {
  "u-14": "Menores",
  "youth": "Juv",
  "cat-c": "Cat C",
  "cat-b": "Cat B",
  "cat-a": "Cat A",
};

function TrainingSessionDetailContent() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const session = params.session as string; // Format: YYYY-MM-DD-HH
  const currentPath = `/training-sessions/${session}`;
  const newPlayerId = searchParams.get("player");
  const processedPlayerRef = useRef<string | null>(null);

  const [players, setPlayers] = useState<PlayerWithAttendance[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [expandedPlayerId, setExpandedPlayerId] = useState<string | null>(null);
  const [pendingPayment, setPendingPayment] = useState<{ playerId: string; amount: number } | null>(null);
  const [customAmountMode, setCustomAmountMode] = useState<string | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [paymentProcessing, setPaymentProcessing] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [addInviteeStep, setAddInviteeStep] = useState<'choose' | 'selectCategory' | 'selectPlayer' | null>(null);
  const [addArqueroStep, setAddArqueroStep] = useState<'choose' | 'selectCategory' | 'selectPlayer' | null>(null);
  const [categoryPlayersForInvite, setCategoryPlayersForInvite] = useState<Player[]>([]);
  const [categoryPlayersForArquero, setCategoryPlayersForArquero] = useState<Player[]>([]);
  // The slot definition (categories, goalie-friendliness) comes from the
  // roster API, which reads it from the database.
  const [slotInfo, setSlotInfo] = useState<{ categories: string[]; goalies: boolean } | null>(null);
  /** The date the club is working on, to flag browsing a different session. */
  const [currentDate, setCurrentDate] = useState<string | null>(null);
  const [debtModalPlayer, setDebtModalPlayer] = useState<PlayerWithAttendance | null>(null);

  // Parse session string
  const [dateStr, hourStr] = session.split('-').length === 4
    ? [session.substring(0, 10), session.substring(11)]
    : ['', ''];

  const date = dateStr ? new Date(dateStr + 'T12:00:00') : null;
  const hour = parseInt(hourStr, 10);

  useEffect(() => {
    if (!dateStr || !hourStr || isNaN(hour)) {
      setErr("Sesión inválida");
      setLoading(false);
      return;
    }

    const loadPlayers = async () => {
      setLoading(true);
      setErr(null);

      try {
        // If returning from adding a new player, mark attendance first
        if (newPlayerId && processedPlayerRef.current !== newPlayerId) {
          processedPlayerRef.current = newPlayerId;
          await fetch(`/api/training-sessions/${session}/attendance`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ player_id: newPlayerId, attended: true }),
          });
          // Remove the query param from the URL
          window.history.replaceState(null, "", currentPath);
        }

        const res = await fetch(`/api/training-sessions/${session}`);
        if (!res.ok) {
          setErr(await res.text());
          setLoading(false);
          return;
        }

        const data = await res.json();
        setPlayers(data.players || []);
        if (data.slot) setSlotInfo(data.slot);
        setCurrentDate(data.current_date ?? null);
        setLoading(false);
      } catch {
        setErr("Error al cargar jugadores");
        setLoading(false);
      }
    };

    loadPlayers();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, dateStr, hourStr, hour]);

  const toggleAttendance = async (playerId: string, currentStatus: boolean) => {
    setPlayers(prev => prev.map(p =>
      p.id === playerId ? { ...p, attended: !currentStatus } : p
    ));

    try {
      const res = await fetch(`/api/training-sessions/${session}/attendance`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          player_id: playerId,
          attended: !currentStatus,
        }),
      });

      if (!res.ok) {
        setPlayers(prev => prev.map(p =>
          p.id === playerId ? { ...p, attended: currentStatus } : p
        ));
        alert("Error al actualizar asistencia");
      }
    } catch {
      setPlayers(prev => prev.map(p =>
        p.id === playerId ? { ...p, attended: currentStatus } : p
      ));
      alert("Error al actualizar asistencia");
    }
  };

  const confirmPayment = async () => {
    if (!pendingPayment) return;

    const { playerId, amount } = pendingPayment;
    setPaymentProcessing(true);

    try {
      const res = await fetch(`/api/training-sessions/${session}/payment`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          player_id: playerId,
          amount,
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        if (errorText.includes("duplicate") || errorText.includes("23505")) {
          alert("Pago ya registrado");
        } else {
          alert("Error al registrar pago");
        }
        setPaymentProcessing(false);
        setPendingPayment(null);
        return;
      }

      // Auto-mark attendance if not already marked
      const player = players.find(p => p.id === playerId);
      if (player && !player.attended) {
        await fetch(`/api/training-sessions/${session}/attendance`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ player_id: playerId, attended: true }),
        });
      }

      // Reload players to get updated payment totals
      const playersRes = await fetch(`/api/training-sessions/${session}`);
      if (playersRes.ok) {
        const data = await playersRes.json();
        setPlayers(data.players || []);
        if (data.slot) setSlotInfo(data.slot);
        setCurrentDate(data.current_date ?? null);
      }

      setPaymentProcessing(false);
      setPaymentSuccess(true);

      setTimeout(() => {
        setPaymentSuccess(false);
        setPendingPayment(null);
        setExpandedPlayerId(null);
      }, 2000);
    } catch {
      alert("Error al registrar pago");
      setPaymentProcessing(false);
      setPendingPayment(null);
    }
  };

  const cancelPayment = () => {
    setExpandedPlayerId(null);
    setPendingPayment(null);
    setCustomAmountMode(null);
    setCustomAmount("");
    setPaymentProcessing(false);
    setPaymentSuccess(false);
  };

  const handleCustomAmountSubmit = (playerId: string) => {
    let amount = parseInt(customAmount, 10);
    if (isNaN(amount) || amount <= 0) {
      alert("Ingrese un monto válido");
      return;
    }
    if (amount < 1000) {
      amount = amount * 1000;
    }
    setPendingPayment({ playerId, amount });
    setCustomAmountMode(null);
    setCustomAmount("");
  };

  const sessionCategories = slotInfo?.categories ?? [];
  const isGkFriendly = slotInfo?.goalies ?? false;
  const newPlayerCategoryParam = sessionCategories.length === 1 ? `category=${sessionCategories[0]}&` : "";

  const selectCategoryForInvite = async (cat: string) => {
    try {
      const res = await fetch(`/api/players?category=${encodeURIComponent(cat)}&player_type=player`);
      if (res.ok) {
        const data = await res.json();
        setCategoryPlayersForInvite(data.players || []);
        setAddInviteeStep('selectPlayer');
      }
    } catch {
      alert("Error al cargar jugadores");
    }
  };

  const selectCrossCategoryPlayer = async (playerId: string) => {
    try {
      await fetch(`/api/training-sessions/${session}/attendance`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ player_id: playerId, attended: true }),
      });

      const res = await fetch(`/api/training-sessions/${session}`);
      if (res.ok) {
        const data = await res.json();
        setPlayers(data.players || []);
        if (data.slot) setSlotInfo(data.slot);
        setCurrentDate(data.current_date ?? null);
      }
    } catch {
      alert("Error al agregar invitado");
    }
    setAddInviteeStep(null);
    setCategoryPlayersForInvite([]);
  };

  const cancelAddInvitee = () => {
    setAddInviteeStep(null);
    setCategoryPlayersForInvite([]);
  };

  const selectCategoryForArquero = async (cat: string) => {
    try {
      const res = await fetch(`/api/players?category=${encodeURIComponent(cat)}&player_type=goalkeeper`);
      if (res.ok) {
        const data = await res.json();
        setCategoryPlayersForArquero(data.players || []);
        setAddArqueroStep('selectPlayer');
      }
    } catch {
      alert("Error al cargar jugadores");
    }
  };

  const selectCrossCategoryArquero = async (playerId: string) => {
    try {
      await fetch(`/api/training-sessions/${session}/attendance`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ player_id: playerId, attended: true }),
      });

      const res = await fetch(`/api/training-sessions/${session}`);
      if (res.ok) {
        const data = await res.json();
        setPlayers(data.players || []);
        if (data.slot) setSlotInfo(data.slot);
        setCurrentDate(data.current_date ?? null);
      }
    } catch {
      alert("Error al agregar arquero");
    }
    setAddArqueroStep(null);
    setCategoryPlayersForArquero([]);
  };

  const cancelAddArquero = () => {
    setAddArqueroStep(null);
    setCategoryPlayersForArquero([]);
  };

  const formatDate = (d: Date) => {
    return d.toLocaleDateString("es-AR", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric"
    });
  };

  const formatArs = (amount: number) => {
    if (amount >= 1000 && amount % 1000 === 0) {
      return `${amount / 1000}k`;
    }
    return new Intl.NumberFormat("es-AR", {
      style: "decimal",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  // Pre-ledger sessions (before LEDGER_FROM) fall back to the legacy
  // threshold; the API computes owes_now from the ledger for the rest.
  const PAYMENT_THRESHOLD = paymentThresholdOverride(dateStr, hour) ?? 100000;

  const playerOwes = (p: PlayerWithAttendance) =>
    p.owes_now ?? (p.payments < PAYMENT_THRESHOLD * (100 - p.scholarship) / 100);

  // Only one thing sends a player to the bottom group: having paid this
  // month's bundle or this very session. Attendance does not enter into it,
  // and neither does a payment for an earlier session of the month —
  // hasSessionPayment is already exactly that (bundle for this slot, or a
  // payment against this session).
  const playerSettled = (p: PlayerWithAttendance) => p.hasSessionPayment;

  const jugadores = players
    .filter(p => p.section === "jugadores")
    .sort((a, b) => Number(playerSettled(a)) - Number(playerSettled(b)));
  const invitados = players.filter(p => p.section === "invitados");
  const arqueros = players.filter(p => p.section === "arqueros");

  const renderPlayerRow = (player: PlayerWithAttendance, bgColor: string, hidePayment = false) => {
    const owes = playerOwes(player);
    const statusIcon = owes ? "💸" : player.scholarship > 0 ? "🏦" : "💰";
    const hasDebt = (player.debt ?? 0) > 0;
    // Money owed to the club. Annual dues: settled (no highlight), partially
    // paid (dark amber) and unpaid (red) — training-ledger debt also paints
    // red. The debt one opens a detail modal on tap.
    const duesPartial = !player.invitee && player.dues_status === "partial";
    const duesUnpaid = !player.invitee && player.dues_status === "none";
    const nameBgColor = duesPartial
      ? "rgba(133, 77, 14, 0.8)"
      : hasDebt || duesUnpaid
      ? "rgba(220, 38, 38, 0.45)"
      : bgColor;
    return (
      <React.Fragment key={player.id}>
        {/* Name */}
        <div
          onClick={hasDebt ? () => setDebtModalPlayer(player) : undefined}
          style={{
            fontSize: "0.875rem",
            fontWeight: 400,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            padding: "8px",
            background: nameBgColor,
            borderBottom: "1px solid rgba(255,255,255,0.05)",
            cursor: hasDebt ? "pointer" : undefined,
          }}
        >
          {player.last_name}, {player.name}
          {(player.carryover_sessions ?? 0) > 0 && (
            // One dot per bonified session from last month.
            <span
              title={`${player.carryover_sessions} sesión(es) bonificada(s)`}
              style={{ color: "#4ade80", marginLeft: 4, letterSpacing: 2 }}
            >
              {"•".repeat(Math.min(3, player.carryover_sessions))}
            </span>
          )}
        </div>

        {/* Attendance emoji */}
        <div style={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          padding: "8px",
          background: bgColor,
          borderBottom: "1px solid rgba(255,255,255,0.05)"
        }}>
          <span
            onClick={() => toggleAttendance(player.id, player.attended)}
            style={{
              cursor: "pointer",
              fontSize: "1.2rem",
              lineHeight: 1,
              userSelect: "none",
              WebkitTapHighlightColor: "transparent",
              // Same glyph either way: opacity carries the state. 🫥 renders with a
              // solid yellow fill on Apple's emoji font, so it read as "present" on
              // phones. Opacity applies to the glyph on every platform.
              opacity: player.attended ? 1 : AbsentOpacity,
              transition: "opacity 150ms ease"
            }}
          >
            😐
          </span>
        </div>

        {!hidePayment && (
        <>
        {/* Payment status icon */}
        <div style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          padding: "8px 0",
          background: bgColor,
          borderBottom: "1px solid rgba(255,255,255,0.05)"
        }}>
          <span style={{ fontSize: "1.3rem", lineHeight: 1 }}>{statusIcon}</span>
        </div>

        {/* Payment amount and button */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 6,
          padding: "8px",
          background: bgColor,
          borderBottom: "1px solid rgba(255,255,255,0.05)",
        }}>
          <span style={{ fontSize: "0.9rem", fontWeight: 500 }}>{formatArs(player.payments)}</span>
          <button
            onClick={() => {
              setExpandedPlayerId(expandedPlayerId === player.id ? null : player.id);
            }}
            style={{
              padding: "2px 6px",
              borderRadius: 4,
              border: "1px solid rgba(255,255,255,0.2)",
              background: "rgba(255,255,255,0.05)",
              cursor: "pointer",
              fontSize: "1rem",
              lineHeight: 1,
            }}
          >
            +
          </button>
        </div>

        {/* Expandable payment amounts row */}
        {expandedPlayerId === player.id && (
          <>
            {pendingPayment?.playerId === player.id ? (
              <>
                {paymentProcessing || paymentSuccess ? (
                  <div style={{
                    gridColumn: "1 / -1",
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    padding: "8px",
                    background: bgColor,
                    borderBottom: "1px solid rgba(255,255,255,0.05)"
                  }}>
                    <span style={{ fontSize: "0.9rem" }}>
                      {paymentProcessing ? "Procesando..." : "✓ Pago registrado"}
                    </span>
                  </div>
                ) : (
                  <div style={{
                    gridColumn: "1 / -1",
                    display: "grid",
                    gridTemplateColumns: "auto 1fr auto",
                    alignItems: "start",
                    gap: 8,
                    padding: "8px",
                    background: bgColor,
                    borderBottom: "1px solid rgba(255,255,255,0.05)"
                  }}>
                    <span style={{ fontSize: "0.9rem", paddingTop: "2px" }}>↳</span>
                    <span style={{ fontSize: "0.9rem" }}>
                      Registrar pago de ${formatArs(pendingPayment.amount)}?
                    </span>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        onClick={confirmPayment}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 6,
                          border: "1px solid rgba(255,255,255,0.2)",
                          background: "rgba(36, 179, 91, 0.2)",
                          cursor: "pointer",
                          fontSize: "0.85rem",
                        }}
                      >
                        Ok
                      </button>
                      <button
                        onClick={cancelPayment}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 6,
                          border: "1px solid rgba(255,255,255,0.2)",
                          background: "rgba(255,255,255,0.05)",
                          cursor: "pointer",
                          fontSize: "0.85rem",
                        }}
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : customAmountMode === player.id ? (
              <div style={{
                gridColumn: "1 / -1",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                padding: "8px",
                background: bgColor,
                borderBottom: "1px solid rgba(255,255,255,0.05)"
              }}>
                <input
                  type="number"
                  placeholder="Monto"
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                  style={{
                    flex: 1,
                    padding: "6px 10px",
                    borderRadius: 6,
                    border: "1px solid rgba(255,255,255,0.2)",
                    background: "rgba(255,255,255,0.05)",
                    color: "inherit",
                    fontSize: "0.85rem",
                  }}
                />
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={() => handleCustomAmountSubmit(player.id)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 6,
                      border: "1px solid rgba(255,255,255,0.2)",
                      background: "rgba(36, 179, 91, 0.2)",
                      cursor: "pointer",
                      fontSize: "0.85rem",
                    }}
                  >
                    OK
                  </button>
                  <button
                    onClick={cancelPayment}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 6,
                      border: "1px solid rgba(255,255,255,0.2)",
                      background: "rgba(255,255,255,0.05)",
                      cursor: "pointer",
                      fontSize: "0.85rem",
                    }}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <div style={{
                gridColumn: "1 / -1",
                display: "flex",
                gap: 6,
                padding: "8px",
                background: bgColor,
                borderBottom: "1px solid rgba(255,255,255,0.05)",
                justifyContent: "space-between",
                alignItems: "center"
              }}>
                <button
                  onClick={() => setExpandedPlayerId(null)}
                  style={{
                    padding: "4px 6px",
                    borderRadius: 4,
                    border: "1px solid rgba(255,255,255,0.2)",
                    background: "rgba(255,255,255,0.05)",
                    cursor: "pointer",
                    fontSize: "0.85rem",
                    lineHeight: 1,
                  }}
                >
                  ✕
                </button>
                <div style={{ display: "flex", gap: 6 }}>
                  {(player.month_preset || player.session_preset
                    ? [
                      // The month's bundle for this player, carryover-adjusted.
                      ...(player.month_preset
                        ? [{ label: `Mes ${formatArs(player.month_preset)}`, amount: player.month_preset }]
                        : []),
                      ...(player.session_preset
                        ? [{ label: `Sesión ${formatArs(player.session_preset)}`, amount: player.session_preset }]
                        : []),
                    ]
                    // Pre-ledger sessions keep the historical amounts.
                    : [100000, 75000, 50000, 30000].map((amount) => ({
                      label: formatArs(amount),
                      amount,
                    }))
                  ).map(({ label, amount }) => (
                    <button
                      key={label}
                      onClick={() => setPendingPayment({ playerId: player.id, amount })}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 6,
                        border: "1px solid rgba(255,255,255,0.2)",
                        background: "rgba(255,255,255,0.05)",
                        cursor: "pointer",
                        fontSize: "0.85rem",
                      }}
                    >
                      {label}
                    </button>
                  ))}
                  <button
                    onClick={() => setCustomAmountMode(player.id)}
                    style={{
                      padding: "6px 10px",
                      borderRadius: 6,
                      border: "1px solid rgba(255,255,255,0.2)",
                      background: "rgba(255,255,255,0.05)",
                      cursor: "pointer",
                      fontSize: "0.85rem",
                    }}
                  >
                    Otro
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        </>
        )}
      </React.Fragment>
    );
  };

  const renderAddGuestControls = (sectionColor: string) => (
    <>
      {addInviteeStep === 'choose' && (
        <div style={{
          display: "flex",
          gap: 8,
          padding: "10px 12px",
          background: sectionColor,
          borderBottom: "1px solid rgba(255,255,255,0.05)"
        }}>
          <button
            onClick={() => {
              setAddInviteeStep(null);
              router.replace(`/players/new?${newPlayerCategoryParam}returnTo=${encodeURIComponent(currentPath)}`);
            }}
            style={{
              flex: 1,
              padding: "8px 12px",
              borderRadius: 6,
              border: "1px solid rgba(255,255,255,0.2)",
              background: "rgba(255,255,255,0.05)",
              cursor: "pointer",
              fontSize: "0.85rem",
            }}
          >
            Nuevo jugador
          </button>
          <button
            onClick={() => setAddInviteeStep('selectCategory')}
            style={{
              flex: 1,
              padding: "8px 12px",
              borderRadius: 6,
              border: "1px solid rgba(255,255,255,0.2)",
              background: "rgba(255,255,255,0.05)",
              cursor: "pointer",
              fontSize: "0.85rem",
            }}
          >
            Existente
          </button>
        </div>
      )}

      {addInviteeStep === 'selectCategory' && (
        <div style={{
          display: "flex",
          gap: 8,
          padding: "10px 12px",
          background: sectionColor,
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          flexWrap: "wrap",
          alignItems: "center"
        }}>
          {ALL_CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => selectCategoryForInvite(cat)}
              style={{
                padding: "8px 12px",
                borderRadius: 6,
                border: "1px solid rgba(255,255,255,0.2)",
                background: "rgba(255,255,255,0.05)",
                cursor: "pointer",
                fontSize: "0.85rem",
              }}
            >
              {CATEGORY_SHORT_LABELS[cat] || cat}
            </button>
          ))}
          <button
            onClick={cancelAddInvitee}
            style={{
              padding: "8px 10px",
              borderRadius: 6,
              border: "1px solid rgba(255,255,255,0.2)",
              background: "rgba(255,255,255,0.05)",
              cursor: "pointer",
              fontSize: "0.85rem",
              marginLeft: "auto",
            }}
          >
            ✕
          </button>
        </div>
      )}

      {addInviteeStep === 'selectPlayer' && (
        <div style={{ background: sectionColor }}>
          {categoryPlayersForInvite
            .filter(p => !invitados.some(existing => existing.id === p.id) && !jugadores.some(existing => existing.id === p.id))
            .map(p => (
            <div
              key={p.id}
              onClick={() => selectCrossCategoryPlayer(p.id)}
              style={{
                padding: "8px 12px 8px 24px",
                cursor: "pointer",
                borderBottom: "1px solid rgba(255,255,255,0.05)",
                fontSize: "0.875rem",
              }}
            >
              {p.last_name}, {p.name}
            </div>
          ))}
          <div
            onClick={cancelAddInvitee}
            style={{
              padding: "8px 12px 8px 24px",
              cursor: "pointer",
              borderBottom: "1px solid rgba(255,255,255,0.05)",
              fontSize: "0.875rem",
              opacity: 0.6,
            }}
          >
            ✕
          </div>
        </div>
      )}
    </>
  );

  usePageTitle(loading ? "Cargando..." : err || !date ? "Error" : "Asistencia y Pagos");

  if (loading) {
    return (
      <ProtectedPage requiredPage={currentPath}>
        <div />
      </ProtectedPage>
    );
  }

  if (err || !date) {
    return (
      <ProtectedPage requiredPage={currentPath}>
        <div>
          <p style={{ marginTop: 12, color: "crimson" }}>{err || "Sesión inválida"}</p>
        </div>
      </ProtectedPage>
    );
  }

  const sectionBgJugadores = "rgba(255, 140, 0, 0.08)";
  const sectionBgInvitados = "rgba(36, 179, 91, 0.08)";
  const sectionBgArqueros = "rgba(255, 140, 0, 0.08)";

  return (
    <ProtectedPage requiredPage={currentPath}>
      <div>
        <div style={{ padding: "0 20px" }}>
          <SessionDateWarning sessionDate={dateStr} currentDate={currentDate} />
          <div className="card" style={{ marginTop: 12, marginLeft: -15, marginRight: -15, borderRadius: "8px" }}>
            <div><strong>Fecha:</strong> {formatDate(date)}</div>
            <div><strong>Horario:</strong> {hour}:00hs</div>
            <div style={{ marginTop: 8, fontSize: "1rem", opacity: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px" }}>
              <span>😐 asistió</span><span>💸 adeuda</span>
              <span><span style={{ opacity: AbsentOpacity }}>😐</span> no asistió</span><span>💰 al día</span>
              <span><span style={{ background: "rgba(220, 38, 38, 0.45)", padding: "0 6px", borderRadius: 3 }}>nombre</span></span><span>cuota anual impaga</span>
              <span><span style={{ background: "rgba(133, 77, 14, 0.8)", padding: "0 6px", borderRadius: 3 }}>nombre</span></span><span>cuota anual a medio pagar</span>
              <span></span><span>🏦 beca (parcial o completa)</span>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 16, marginLeft: -15, marginRight: -15 }}>
          {/* S1: Jugadores */}
          <div style={{ marginBottom: 24 }}>
            <div style={{
              fontSize: "0.95rem",
              fontWeight: 600,
              padding: "8px 12px",
              background: "var(--acemhh-orange)",
              color: "#000",
              textAlign: "center",
              borderRadius: "8px 8px 0 0"
            }}>
              Jugadores
            </div>
            <div style={{
              display: "grid",
              gridTemplateColumns: "1fr 38px 38px max-content",
              alignItems: "stretch"
            }}>
              {(() => {
                const owingCount = jugadores.filter(p => !playerSettled(p)).length;
                const showSeparator = owingCount > 0 && owingCount < jugadores.length;
                return jugadores.map((p, i) => (
                  <React.Fragment key={p.id}>
                    {showSeparator && i === owingCount && (
                      <div style={{
                        gridColumn: "1 / -1",
                        height: 3,
                        background: "var(--acemhh-orange)",
                        opacity: 0.5,
                      }} />
                    )}
                    {renderPlayerRow(p, sectionBgJugadores)}
                  </React.Fragment>
                ));
              })()}
            </div>
          </div>

          {/* S2: Invitados */}
          <div style={{ marginBottom: 24 }}>
            <div style={{
              fontSize: "0.95rem",
              fontWeight: 600,
              padding: "8px 12px",
              background: "var(--acemhh-green)",
              color: "#000",
              textAlign: "center",
              borderRadius: "8px 8px 0 0",
              position: "relative"
            }}>
              Invitados
              <button
                onClick={() => setAddInviteeStep('choose')}
                style={{
                  position: "absolute",
                  right: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  padding: "2px 8px",
                  borderRadius: 4,
                  border: "1px solid rgba(0,0,0,0.2)",
                  background: "rgba(0,0,0,0.1)",
                  cursor: "pointer",
                  fontSize: "1rem",
                  lineHeight: 1,
                  color: "#000"
                }}
              >
                +
              </button>
            </div>

            {renderAddGuestControls(sectionBgInvitados)}

            {invitados.length > 0 ? (
              <div style={{
                display: "grid",
                gridTemplateColumns: "1fr 38px 38px max-content",
                alignItems: "stretch"
              }}>
                {invitados.map(p => renderPlayerRow(p, sectionBgInvitados))}
              </div>
            ) : (
              <div style={{
                padding: "12px",
                background: sectionBgInvitados,
                fontSize: "0.85rem",
                opacity: 0.5,
                textAlign: "center",
              }}>
                Sin invitados
              </div>
            )}
          </div>

          {/* S3: Arqueros */}
          <div style={{ marginBottom: 24 }}>
            <div style={{
              fontSize: "0.95rem",
              fontWeight: 600,
              padding: "8px 12px",
              background: "var(--acemhh-orange)",
              color: "#000",
              textAlign: "center",
              borderRadius: "8px 8px 0 0",
              position: "relative"
            }}>
              Arqueros
              <button
                onClick={() => setAddArqueroStep('choose')}
                style={{
                  position: "absolute",
                  right: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  padding: "2px 8px",
                  borderRadius: 4,
                  border: "1px solid rgba(0,0,0,0.2)",
                  background: "rgba(0,0,0,0.1)",
                  cursor: "pointer",
                  fontSize: "1rem",
                  lineHeight: 1,
                  color: "#000"
                }}
              >
                +
              </button>
            </div>

            {addArqueroStep === 'choose' && (
              <div style={{
                display: "flex",
                gap: 8,
                padding: "10px 12px",
                background: sectionBgArqueros,
                borderBottom: "1px solid rgba(255,255,255,0.05)"
              }}>
                <button
                  onClick={() => {
                    setAddArqueroStep(null);
                    router.replace(`/players/new?${newPlayerCategoryParam}player_type=goalkeeper&returnTo=${encodeURIComponent(currentPath)}`);
                  }}
                  style={{
                    flex: 1,
                    padding: "8px 12px",
                    borderRadius: 6,
                    border: "1px solid rgba(255,255,255,0.2)",
                    background: "rgba(255,255,255,0.05)",
                    cursor: "pointer",
                    fontSize: "0.85rem",
                  }}
                >
                  Nuevo arquero
                </button>
                <button
                  onClick={() => setAddArqueroStep('selectCategory')}
                  style={{
                    flex: 1,
                    padding: "8px 12px",
                    borderRadius: 6,
                    border: "1px solid rgba(255,255,255,0.2)",
                    background: "rgba(255,255,255,0.05)",
                    cursor: "pointer",
                    fontSize: "0.85rem",
                  }}
                >
                  {isGkFriendly ? "De otra categoría" : "Existente"}
                </button>
              </div>
            )}

            {addArqueroStep === 'selectCategory' && (
              <div style={{
                display: "flex",
                gap: 8,
                padding: "10px 12px",
                background: sectionBgArqueros,
                borderBottom: "1px solid rgba(255,255,255,0.05)",
                flexWrap: "wrap",
                alignItems: "center"
              }}>
                {(isGkFriendly ? ALL_CATEGORIES.filter(c => !sessionCategories.includes(c)) : ALL_CATEGORIES).map(cat => (
                  <button
                    key={cat}
                    onClick={() => selectCategoryForArquero(cat)}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 6,
                      border: "1px solid rgba(255,255,255,0.2)",
                      background: "rgba(255,255,255,0.05)",
                      cursor: "pointer",
                      fontSize: "0.85rem",
                    }}
                  >
                    {CATEGORY_SHORT_LABELS[cat] || cat}
                  </button>
                ))}
                <button
                  onClick={cancelAddArquero}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 6,
                    border: "1px solid rgba(255,255,255,0.2)",
                    background: "rgba(255,255,255,0.05)",
                    cursor: "pointer",
                    fontSize: "0.85rem",
                    marginLeft: "auto",
                  }}
                >
                  ✕
                </button>
              </div>
            )}

            {addArqueroStep === 'selectPlayer' && (
              <div style={{ background: sectionBgArqueros }}>
                {categoryPlayersForArquero
                  .filter(p => !arqueros.some(existing => existing.id === p.id))
                  .map(p => (
                  <div
                    key={p.id}
                    onClick={() => selectCrossCategoryArquero(p.id)}
                    style={{
                      padding: "8px 12px 8px 24px",
                      cursor: "pointer",
                      borderBottom: "1px solid rgba(255,255,255,0.05)",
                      fontSize: "0.875rem",
                    }}
                  >
                    {p.last_name}, {p.name}
                  </div>
                ))}
                <div
                  onClick={cancelAddArquero}
                  style={{
                    padding: "8px 12px 8px 24px",
                    cursor: "pointer",
                    borderBottom: "1px solid rgba(255,255,255,0.05)",
                    fontSize: "0.875rem",
                    opacity: 0.6,
                  }}
                >
                  ✕
                </div>
              </div>
            )}

            {arqueros.length > 0 ? (
              <div style={{
                display: "grid",
                gridTemplateColumns: isGkFriendly ? "1fr 38px 38px max-content" : "1fr 38px",
                alignItems: "stretch"
              }}>
                {arqueros.map(p => renderPlayerRow(p, sectionBgArqueros, !isGkFriendly))}
              </div>
            ) : (
              <div style={{
                padding: "12px",
                background: sectionBgArqueros,
                fontSize: "0.85rem",
                opacity: 0.5,
                textAlign: "center",
              }}>
                Sin arqueros
              </div>
            )}
          </div>
        </div>

        {/* Debt detail modal, opened by tapping a red (indebted) player name. */}
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
                Debe {formatArs(debtModalPlayer.debt)}
              </p>
              <div style={{ marginTop: 10, fontSize: "0.85rem", opacity: 0.85 }}>
                {debtModalPlayer.debt_months.map((d) => (
                  <div key={d.month} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                    <span>{monthNameEs(d.month)}</span>
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>
                      pagó {formatArs(d.paid)} de {formatArs(d.charge)}
                    </span>
                  </div>
                ))}
              </div>
              <p style={{ marginTop: 10, fontSize: "0.75rem", opacity: 0.55 }}>
                La deuda se descuenta automáticamente cuando el pago del mes supera el cargo.
              </p>
              <button onClick={() => setDebtModalPlayer(null)} style={{ marginTop: 12, width: "100%" }}>
                Cerrar
              </button>
            </div>
          </div>
          </Overlay>
        )}

      </div>
    </ProtectedPage>
  );
}

export default function TrainingSessionDetailPage() {
  return (
    <Suspense fallback={<div style={{ padding: "20px", textAlign: "center" }}>Cargando...</div>}>
      <TrainingSessionDetailContent />
    </Suspense>
  );
}
