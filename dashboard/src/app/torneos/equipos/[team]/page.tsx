"use client";

import React, { Suspense, useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import ProtectedPage from "../../../components/ProtectedPage";
import Overlay from "../../../components/Overlay";
import { usePageTitle } from "../../../components/PageTitleContext";
import {
  formatArs,
  monthInitialEs,
  monthNameEs,
  RoleLabels,
  type FeeStanding,
  type InstallmentStatus,
  type TournamentConcept,
} from "@/lib/tournamentFees";
import type { TeamDetail, TeamPlayer } from "../../../api/torneos/equipos/[team]/route";

// Un equipo: sus jugadores y cómo viene cada uno con la cuota del torneo. Un
// punto por mes dice de un vistazo qué pagó y qué falta; tocar la fila abre
// el detalle, y desde ahí se registra el pago.

const StatusColor: Record<InstallmentStatus, string> = {
  paid: "var(--acemhh-green)",
  partial: "#f2c14e",
  due: "#e5484d",
  upcoming: "rgba(255,255,255,0.14)",
};

const StatusWord: Record<InstallmentStatus, string> = {
  paid: "pagada",
  partial: "pagada en parte",
  due: "vencida, sin pagar",
  upcoming: "todavía no vence",
};

const rowBorder = "1px solid rgba(255,255,255,0.07)";

const heading: React.CSSProperties = {
  marginTop: 18,
  marginBottom: 4,
  fontSize: "0.7rem",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  opacity: 0.55,
};

function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(iso));
}

/** Quién cobró, sin el sufijo técnico con el id. */
function collectorName(registeredBy: string): string {
  return registeredBy.replace(/\s*\[id=[^\]]*\]\s*$/, "").trim();
}

// ---- Los puntos ----

function FeeDots({ standing, size = 14, labels = false }: {
  standing: FeeStanding;
  size?: number;
  labels?: boolean;
}) {
  return (
    <span
      data-testid="fee-dots"
      style={{ display: "inline-flex", gap: labels ? 10 : 5, alignItems: "flex-start", flexShrink: 0 }}
    >
      {standing.installments.map((i) => (
        <span
          key={i.month}
          style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 2 }}
        >
          <span
            data-testid="fee-dot"
            data-month={i.month}
            data-status={i.status}
            title={`${monthNameEs(i.month)}: ${StatusWord[i.status]} · $${formatArs(i.paid)} de $${formatArs(i.amount)}`}
            style={{
              width: size,
              height: size,
              borderRadius: "50%",
              background: StatusColor[i.status],
              border: i.status === "upcoming"
                ? "1px solid rgba(255,255,255,0.25)"
                : "1px solid transparent",
              boxSizing: "border-box",
              display: "block",
            }}
          />
          <span style={{ fontSize: labels ? "0.7rem" : "0.55rem", opacity: 0.55, lineHeight: 1 }}>
            {labels ? monthNameEs(i.month).slice(0, 3) : monthInitialEs(i.month)}
          </span>
        </span>
      ))}
    </span>
  );
}

/** Una línea: al día, debe tanto, o saldado. */
function standingLine(s: FeeStanding): { text: string; color?: string } {
  if (s.remaining === 0 && s.total > 0) {
    return { text: s.upfrontTaken ? "torneo pago por anticipado" : "torneo saldado", color: "var(--acemhh-green-3)" };
  }
  if (s.outstandingNow > 0) {
    return { text: `debe $${formatArs(s.outstandingNow)}`, color: "#f2c14e" };
  }
  return { text: `al día · pagó $${formatArs(s.paid)}`, color: undefined };
}

// ---- La fila ----

const ExemptLine = "arquero · no paga cuota";

function PlayerRow({ p, onOpen }: { p: TeamPlayer; onOpen: (p: TeamPlayer) => void }) {
  const line = p.exempt ? { text: ExemptLine, color: undefined } : standingLine(p.standing);
  return (
    <div
      data-testid="player-row"
      data-player-row={p.id}
      role="button"
      onClick={() => onOpen(p)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 8px",
        borderBottom: rowBorder,
        cursor: "pointer",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          data-testid="player-name"
          style={{ fontSize: "0.9rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {p.last_name}, {p.name}
        </div>
        <div
          data-testid="player-standing"
          style={{ fontSize: "0.75rem", opacity: line.color ? 0.95 : 0.6, color: line.color, margin: 0 }}
        >
          {line.text}
        </div>
      </div>
      {!p.exempt && <FeeDots standing={p.standing} />}
    </div>
  );
}

// ---- El detalle del jugador ----

function PlayerSheet({ p, onClose, onPay }: {
  p: TeamPlayer;
  onClose: () => void;
  onPay: () => void;
}) {
  const s = p.standing;
  const num: React.CSSProperties = { fontVariantNumeric: "tabular-nums", textAlign: "right" };
  const row: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 12, padding: "3px 0" };
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
          alignItems: "flex-end",
          justifyContent: "center",
        }}
      >
        <div
          data-testid="player-sheet"
          onClick={(e) => e.stopPropagation()}
          style={{
            width: "100%",
            maxWidth: 520,
            maxHeight: "88vh",
            overflowY: "auto",
            borderRadius: "16px 16px 0 0",
            border: "1px solid rgba(255,255,255,0.18)",
            borderBottom: "none",
            background: "#16211b",
            padding: "18px 18px 24px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <p style={{ margin: 0, fontWeight: 700, fontSize: "1.05rem" }}>
              {p.last_name}, {p.name}
            </p>
            <span className="badge">{RoleLabels[p.role]}</span>
          </div>

          {p.exempt ? (
            <p data-testid="exempt-note" style={{ marginTop: 14 }}>
              Los arqueros no pagan la cuota del torneo.
            </p>
          ) : (
          <>
          <div style={{ marginTop: 14, display: "flex", justifyContent: "center" }}>
            <FeeDots standing={s} size={22} labels />
          </div>

          <div style={{ fontSize: "0.85rem", marginTop: 12 }}>
            {s.installments.map((i) => (
              <div key={i.month} style={row}>
                <span>
                  <span style={{ color: StatusColor[i.status], marginRight: 6 }}>●</span>
                  {monthNameEs(i.month)}
                </span>
                <span style={num}>
                  {i.status === "paid"
                    ? `$${formatArs(i.amount)} ✓`
                    : i.status === "upcoming"
                    ? `$${formatArs(i.amount)}`
                    : `$${formatArs(i.paid)} de $${formatArs(i.amount)}`}
                </span>
              </div>
            ))}
            <div style={{ ...row, borderTop: rowBorder, marginTop: 6, paddingTop: 8, fontWeight: 600 }}>
              <span>Pagó</span>
              <span style={num}>${formatArs(s.paid)} de ${formatArs(s.total)}</span>
            </div>
            {s.outstandingNow > 0 && (
              <div style={{ ...row, color: "#f2c14e" }}>
                <span>Debe a la fecha</span>
                <span style={num}>${formatArs(s.outstandingNow)}</span>
              </div>
            )}
            {s.upfrontTaken && (
              <p style={{ margin: "6px 0 0", fontSize: "0.75rem" }}>
                Pagó el torneo por anticipado, con descuento.
              </p>
            )}
          </div>
          </>
          )}

          <div style={heading}>Pagos</div>
          {p.payments.length === 0 ? (
            <p style={{ margin: 0, fontSize: "0.85rem" }}>Sin pagos registrados.</p>
          ) : (
            <div data-testid="payment-list" style={{ fontSize: "0.85rem" }}>
              {[...p.payments].reverse().map((pay) => (
                <div key={pay.id} style={row}>
                  <span style={{ opacity: 0.85 }}>
                    {formatWhen(pay.created_at)}
                    <span style={{ opacity: 0.6 }}> · {pay.is_cash ? "efectivo" : "transferencia"}</span>
                    <span style={{ opacity: 0.6 }}> · {collectorName(pay.registered_by)}</span>
                  </span>
                  <span style={num}>
                    ${formatArs(pay.amount)}
                    {pay.concept === "tournament upfront" ? " (anticipado)" : ""}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
            <button onClick={onClose} style={{ flex: 1 }}>Cerrar</button>
            {!p.exempt && (
              <button
                data-testid="register-payment"
                className="btnPrimary"
                style={{ flex: 2 }}
                onClick={onPay}
              >
                Registrar pago
              </button>
            )}
          </div>
        </div>
      </div>
    </Overlay>
  );
}

// ---- El pago ----

type Choice = { amount: number; concept: TournamentConcept };

// Sin botones de cancelar ni de volver: tocar afuera cierra todo y devuelve a
// la lista. La pantalla se usa cobrando en fila, y cada toque de más cuesta.
function PaymentModal({ p, upfrontPrice, onClose, onConfirm, busy, error }: {
  p: TeamPlayer;
  upfrontPrice: number | null;
  onClose: () => void;
  onConfirm: (choice: Choice) => void;
  busy: boolean;
  error: string | null;
}) {
  const s = p.standing;
  const [chosen, setChosen] = useState<Choice | null>(null);
  const [custom, setCustom] = useState("");

  const nextMonth = s.installments.find((i) => i.paid < i.amount)?.month;
  const suggestedLabel = s.outstandingNow > 0
    ? "Completar lo vencido"
    : nextMonth
    ? `Cuota de ${monthNameEs(nextMonth)}`
    : null;

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
          zIndex: 110,
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
            {p.last_name}, {p.name}
          </p>

          {chosen === null ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
              {/* Lo más común va primero: lo que debe hoy. */}
              {s.nextSuggested !== null && suggestedLabel && (
                <button
                  data-testid="pay-suggested"
                  style={button}
                  onClick={() => setChosen({ amount: s.nextSuggested!, concept: "tournament" })}
                >
                  {suggestedLabel} · <strong>${formatArs(s.nextSuggested)}</strong>
                </button>
              )}
              {/* Sólo para quien no pagó nada y antes de que venza la primera
                  cuota: el torneo entero, más barato que la suma. */}
              {s.upfrontAvailable && upfrontPrice !== null && (
                <button
                  data-testid="pay-upfront"
                  style={button}
                  onClick={() => setChosen({ amount: upfrontPrice, concept: "tournament upfront" })}
                >
                  Torneo completo por anticipado · <strong>${formatArs(upfrontPrice)}</strong>
                  <span style={{ display: "block", fontSize: "0.75rem", opacity: 0.65 }}>
                    en vez de ${formatArs(s.total)} en cuotas
                  </span>
                </button>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  data-testid="custom-amount"
                  type="number"
                  inputMode="numeric"
                  placeholder="Otro monto..."
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
                  data-testid="custom-ok"
                  className="btnPrimary"
                  disabled={!custom.trim()}
                  onClick={() => {
                    let value = parseInt(custom, 10);
                    if (!Number.isFinite(value) || value <= 0) return;
                    // "30" quiere decir 30k: acá los montos son miles.
                    if (value < 1000) value = value * 1000;
                    setChosen({ amount: value, concept: "tournament" });
                  }}
                >
                  OK
                </button>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 14 }}>
              <p style={{ margin: 0, fontSize: "1.6rem", fontWeight: 700 }}>
                ${formatArs(chosen.amount)}
              </p>
              <p style={{ margin: "4px 0 0", opacity: 0.75, fontSize: "0.9rem" }}>
                {chosen.concept === "tournament upfront"
                  ? "Torneo completo por anticipado"
                  : "Cuota del torneo"}
              </p>
              {error && <p style={{ color: "crimson", fontSize: "0.85rem" }}>{error}</p>}
              <div style={{ marginTop: 16 }}>
                <button
                  data-testid="confirm-payment"
                  className="btnPrimary"
                  style={{ width: "100%" }}
                  disabled={busy}
                  onClick={() => onConfirm(chosen)}
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

// ---- La pantalla ----

function TeamContent() {
  const params = useParams<{ team: string }>();
  const router = useRouter();
  const teamId = params.team;

  const [detail, setDetail] = useState<TeamDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  usePageTitle(detail?.team.name ?? "Equipo", () => router.push("/torneos"));

  const load = useCallback(async () => {
    const res = await fetch(`/api/torneos/equipos/${teamId}`);
    if (!res.ok) throw new Error(await res.text());
    setDetail(await res.json() as TeamDetail);
  }, [teamId]);

  useEffect(() => {
    load().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  if (error) return <p style={{ color: "crimson" }}>{error}</p>;
  if (!detail) return <p>Cargando…</p>;

  const selected = detail.players.find((p) => p.id === selectedId) ?? null;
  const starters = detail.players.filter((p) => p.role === "starter");
  const substitutes = detail.players.filter((p) => p.role === "substitute");
  // Los arqueros no pagan: el resumen habla de los que sí.
  const payers = detail.players.filter((p) => !p.exempt);
  const exempt = detail.players.length - payers.length;
  const upToDate = payers.filter((p) => p.standing.outstandingNow === 0).length;
  const collected = payers.reduce((acc, p) => acc + p.standing.paid, 0);
  const dueSoFar = payers.reduce((acc, p) => acc + p.standing.dueSoFar, 0);

  const confirm = async (choice: Choice) => {
    if (!selected) return;
    setBusy(true);
    setPayError(null);
    try {
      const res = await fetch(`/api/torneos/equipos/${teamId}/pago`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          player_id: selected.id,
          amount: choice.amount,
          concept: choice.concept,
          // La cuota del torneo se cobra siempre en efectivo: suma a la caja
          // de quien la registra, y la caja la lista como "torneo".
          is_cash: true,
        }),
      });
      if (!res.ok) {
        setPayError(await res.text());
        return;
      }
      await load();
      // Registrado: de vuelta a la lista, listo para el siguiente jugador.
      setPaying(false);
      setSelectedId(null);
      setToast(`✓ Pago de $${formatArs(choice.amount)} registrado`);
    } catch (e: unknown) {
      setPayError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const section = (title: string, list: TeamPlayer[]) =>
    list.length === 0 ? null : (
      <section data-testid={`section-${title.toLowerCase()}`}>
        <div style={heading}>{title}</div>
        {list.map((p) => <PlayerRow key={p.id} p={p} onOpen={(pl) => setSelectedId(pl.id)} />)}
      </section>
    );

  return (
    <div>
      <p data-testid="team-context" style={{ margin: 0, fontSize: "0.85rem" }}>
        {detail.tournament.name} · {detail.category.name}
      </p>
      {detail.players.length > 0 && (
        <p data-testid="team-summary" style={{ margin: "4px 0 0", fontSize: "0.85rem" }}>
          {payers.length} {payers.length === 1 ? "jugador paga" : "jugadores pagan"} ·{" "}
          <strong>{upToDate}</strong> al día · cobrado{" "}
          <strong>${formatArs(collected)}</strong> de ${formatArs(dueSoFar)} a la fecha
          {exempt > 0 && ` · ${exempt} ${exempt === 1 ? "arquero" : "arqueros"} sin cuota`}
        </p>
      )}

      {detail.players.length === 0 ? (
        <p style={{ marginTop: 16 }}>Este equipo todavía no tiene jugadores cargados.</p>
      ) : (
        <>
          {section("Titulares", starters)}
          {section("Suplentes", substitutes)}
        </>
      )}

      {toast && (
        <div
          data-testid="payment-toast"
          style={{
            position: "fixed",
            left: 16,
            right: 16,
            bottom: 24,
            zIndex: 120,
            padding: 12,
            borderRadius: 12,
            textAlign: "center",
            fontWeight: 600,
            color: "var(--acemhh-green-3)",
            background: "linear-gradient(135deg, rgba(36,179,91,0.3), rgba(15,122,68,0.3))",
            border: "1px solid rgba(36,179,91,0.5)",
            backdropFilter: "blur(8px)",
          }}
        >
          {toast}
        </div>
      )}

      {selected && !paying && (
        <PlayerSheet
          p={selected}
          onClose={() => setSelectedId(null)}
          onPay={() => { setPayError(null); setPaying(true); }}
        />
      )}
      {selected && paying && (
        <PaymentModal
          p={selected}
          upfrontPrice={detail.category.upfront_price}
          onClose={() => { setPaying(false); setSelectedId(null); }}
          onConfirm={confirm}
          busy={busy}
          error={payError}
        />
      )}
    </div>
  );
}

export default function TeamPage() {
  const params = useParams<{ team: string }>();
  return (
    <ProtectedPage requiredPage={`/torneos/equipos/${params.team}`}>
      <Suspense fallback={<p>Cargando…</p>}>
        <TeamContent />
      </Suspense>
    </ProtectedPage>
  );
}
