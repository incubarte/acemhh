"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import ProtectedPage from "../../components/ProtectedPage";

type Player = {
  id: string;
  name: string;
  last_name: string;
  category: string;
};

type PlayerWithAttendance = Player & {
  attended: boolean;
  payments: number; // Total amount paid for this month
  hasSessionPayment: boolean; // Whether player has a payment for this specific session
};

function TrainingSessionDetailContent() {
  const params = useParams();
  const router = useRouter();
  const session = params.session as string; // Format: YYYY-MM-DD-HH
  const currentPath = `/training-sessions/${session}`;
  
  const [players, setPlayers] = useState<PlayerWithAttendance[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [expandedPlayerId, setExpandedPlayerId] = useState<string | null>(null);
  const [pendingPayment, setPendingPayment] = useState<{ playerId: string; amount: number } | null>(null);
  const [customAmountMode, setCustomAmountMode] = useState<string | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [paymentProcessing, setPaymentProcessing] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);

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
        const res = await fetch(`/api/training-sessions/${session}`);
        if (!res.ok) {
          setErr(await res.text());
          setLoading(false);
          return;
        }

        const data = await res.json();
        setPlayers(data.players || []);
        setLoading(false);
      } catch (error) {
        setErr("Error al cargar jugadores");
        setLoading(false);
      }
    };

    loadPlayers();
  }, [session, dateStr, hourStr, hour]);

  const toggleAttendance = async (playerId: string, currentStatus: boolean) => {
    // Optimistic update - update UI immediately
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
        // Revert on error
        setPlayers(prev => prev.map(p => 
          p.id === playerId ? { ...p, attended: currentStatus } : p
        ));
        alert("Error al actualizar asistencia");
        return;
      }
    } catch (error) {
      // Revert on error
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

      // Reload players to get updated payment totals
      const playersRes = await fetch(`/api/training-sessions/${session}`);
      if (playersRes.ok) {
        const data = await playersRes.json();
        setPlayers(data.players || []);
      }

      setPaymentProcessing(false);
      setPaymentSuccess(true);
      
      // Show success message for 2 seconds, then close
      setTimeout(() => {
        setPaymentSuccess(false);
        setPendingPayment(null);
        setExpandedPlayerId(null);
      }, 2000);
    } catch (error) {
      alert("Error al registrar pago");
      setPaymentProcessing(false);
      setPendingPayment(null);
    }
  };

  const cancelPayment = () => {
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
    // If amount is less than 1000, treat it as thousands (e.g., 15 -> 15000)
    if (amount < 1000) {
      amount = amount * 1000;
    }
    setPendingPayment({ playerId, amount });
    setCustomAmountMode(null);
    setCustomAmount("");
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
    return new Intl.NumberFormat("es-AR", {
      style: "decimal",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const PAYMENT_THRESHOLD = 100000; // 100k threshold
  const owingPlayers = players.filter(p => p.payments < PAYMENT_THRESHOLD);
  const paidPlayers = players.filter(p => p.payments >= PAYMENT_THRESHOLD);

  const renderPlayerRow = (player: PlayerWithAttendance, sectionColor: 'orange' | 'green') => {
    const owes = player.payments < PAYMENT_THRESHOLD;
    const statusIcon = owes ? "💸" : "💰";
    const bgColor = sectionColor === 'orange' 
      ? "rgba(255, 140, 0, 0.08)" 
      : "rgba(36, 179, 91, 0.08)";
    
    return (
      <React.Fragment key={player.id}>
        {/* Name */}
        <div style={{ 
          fontSize: "0.875rem", 
          fontWeight: 400, 
          overflow: "hidden", 
          textOverflow: "ellipsis", 
          whiteSpace: "nowrap",
          padding: "8px",
          background: bgColor,
          borderBottom: "1px solid rgba(255,255,255,0.05)"
        }}>
          {player.last_name}, {player.name}
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
              WebkitTapHighlightColor: "transparent"
            }}
          >
            {player.attended ? "🙂" : "🫥"}
          </span>
        </div>
        
        {/* Payment emoji, amount and payment button */}
        <div style={{ 
          display: "flex", 
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 6,
          padding: "8px",
          background: bgColor,
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          position: "relative"
        }}>
          <span style={{ fontSize: "1.3rem", lineHeight: 1 }}>{statusIcon}</span>
          <span style={{ fontSize: "0.9rem", fontWeight: 500 }}>{formatArs(player.payments)}</span>
          
          {owes && !player.hasSessionPayment && (
            <button
              onClick={() => setExpandedPlayerId(expandedPlayerId === player.id ? null : player.id)}
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
          )}
        </div>
        
        {/* Expandable payment amounts row */}
        {expandedPlayerId === player.id && owes && (
          <>
            {pendingPayment?.playerId === player.id ? (
              // Confirmation message
              <>
                {paymentProcessing || paymentSuccess ? (
                  // Centered processing/success message without arrow
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
                  // Confirmation with arrow and buttons
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
              // Custom amount input
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
              // Amount selection buttons
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
                  {[100, 75, 50, 30].map((amount) => (
                    <button
                      key={amount}
                      onClick={() => setPendingPayment({ playerId: player.id, amount: amount * 1000 })}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 6,
                        border: "1px solid rgba(255,255,255,0.2)",
                        background: "rgba(255,255,255,0.05)",
                        cursor: "pointer",
                        fontSize: "0.85rem",
                      }}
                    >
                      {amount}k
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
      </React.Fragment>
    );
  };

  if (loading) {
    return (
      <ProtectedPage requiredPage={currentPath}>
        <div>
          <h1>Cargando...</h1>
        </div>
      </ProtectedPage>
    );
  }

  if (err || !date) {
    return (
      <ProtectedPage requiredPage={currentPath}>
        <div>
          <h1>Error</h1>
          <p style={{ marginTop: 12, color: "crimson" }}>{err || "Sesión inválida"}</p>
          <button onClick={() => router.push("/training-sessions")} style={{ marginTop: 16 }}>
            Volver
          </button>
        </div>
      </ProtectedPage>
    );
  }

  return (
    <ProtectedPage requiredPage={currentPath}>
      <div>
        <div style={{ padding: "0 20px" }}>
          <h1>Asistencia y Pagos</h1>
          
          <div className="card" style={{ marginTop: 12, marginLeft: -15, marginRight: -15, borderRadius: "8px" }}>
            <div><strong>Fecha:</strong> {formatDate(date)}</div>
            <div><strong>Horario:</strong> {hour}:00hs</div>
          </div>
        </div>

        {players.length === 0 ? (
          <p style={{ marginTop: 16, opacity: 0.7, padding: "0 20px" }}>No hay jugadores para esta sesión</p>
        ) : (
          <div style={{ marginTop: 16, marginLeft: -15, marginRight: -15 }}>
            {owingPlayers.length > 0 && (
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
                  Adeudan
                </div>
                <div style={{ 
                  display: "grid",
                  gridTemplateColumns: "1fr 38px max-content",
                  alignItems: "stretch"
                }}>
                  {owingPlayers.map(p => renderPlayerRow(p, 'orange'))}
                </div>
              </div>
            )}
            
            {paidPlayers.length > 0 && (
              <div>
                <div style={{ 
                  fontSize: "0.95rem", 
                  fontWeight: 600, 
                  padding: "8px 12px",
                  background: "var(--acemhh-green-3)",
                  color: "#000",
                  textAlign: "center",
                  borderRadius: "8px 8px 0 0"
                }}>
                  Pagaron
                </div>
                <div style={{ 
                  display: "grid",
                  gridTemplateColumns: "1fr 38px max-content",
                  alignItems: "stretch"
                }}>
                  {paidPlayers.map(p => renderPlayerRow(p, 'green'))}
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: 24, padding: "0 20px" }}>
          <button onClick={() => router.push("/training-sessions")}>
            ← Volver a sesiones
          </button>
        </div>
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
