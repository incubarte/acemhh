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
// punto por mes dice de un vistazo qué pagó y qué falta; el + de la fila cobra
// directo, y tocar la fila abre el detalle con los pagos.

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

/** Cuánto tarda el drawer en subir y en bajar. */
const DrawerMs = 220;

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

/** Una línea: al día, debe tanto, saldado; o qué es el que no tiene cuota. */
function standingLine(p: TeamPlayer): { text: string; color?: string } {
  const s = p.standing;
  if (p.fee === "exempt") return { text: "arquero · no paga cuota" };
  if (p.fee === "substitute") {
    return { text: s.paid > 0 ? `suplente · pagó $${formatArs(s.paid)}` : "suplente · sin pagos" };
  }
  if (s.remaining === 0 && s.total > 0) {
    return { text: s.upfrontTaken ? "torneo pago por anticipado" : "torneo saldado", color: "var(--acemhh-green-3)" };
  }
  if (s.outstandingNow > 0) {
    return { text: `debe $${formatArs(s.outstandingNow)}`, color: "#f2c14e" };
  }
  return { text: `al día · pagó $${formatArs(s.paid)}` };
}

// ---- La fila ----

const PayButtonWidth = 36;

function PlayerRow({ p, onOpen, onPay }: {
  p: TeamPlayer;
  onOpen: (p: TeamPlayer) => void;
  onPay: (p: TeamPlayer) => void;
}) {
  const line = standingLine(p);
  return (
    <div
      data-testid="player-row"
      data-player-row={p.id}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "6px 0 6px 8px",
        borderBottom: rowBorder,
      }}
    >
      <div
        role="button"
        onClick={() => onOpen(p)}
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "4px 0",
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
        {p.fee === "installments" && <FeeDots standing={p.standing} />}
      </div>
      {/* Cobrar sin pasar por el detalle: lo más frecuente, al alcance. */}
      {p.fee !== "exempt"
        ? (
          <button
            data-testid="row-pay"
            aria-label={`Registrar pago a ${p.last_name}, ${p.name}`}
            onClick={() => onPay(p)}
            style={{
              width: PayButtonWidth,
              height: 36,
              flexShrink: 0,
              padding: 0,
              borderRadius: 8,
              border: "1px solid rgba(36,179,91,0.5)",
              background: "rgba(36,179,91,0.18)",
              fontSize: "1.2rem",
              lineHeight: 1,
            }}
          >
            +
          </button>
        )
        : <span style={{ width: PayButtonWidth, flexShrink: 0 }} />}
    </div>
  );
}

// ---- El detalle del jugador ----

/**
 * Sube desde abajo y baja al cerrarse. No tiene botón de cerrar: tocar afuera
 * es cerrar. `open` en false arranca la bajada y avisa cuando terminó.
 */
function Drawer({ open, onClosed, onBackdrop, children, testId }: {
  open: boolean;
  onClosed: () => void;
  onBackdrop: () => void;
  children: React.ReactNode;
  testId: string;
}) {
  // Montado abajo de todo; en el siguiente frame sube. Así la primera pintura
  // tiene desde dónde animar.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!open) {
      setShown(false);
      const t = setTimeout(onClosed, DrawerMs);
      return () => clearTimeout(t);
    }
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, [open, onClosed]);

  return (
    <Overlay>
      <div
        onClick={onBackdrop}
        style={{
          position: "fixed",
          inset: 0,
          background: shown ? "rgba(0,0,0,0.65)" : "rgba(0,0,0,0)",
          transition: `background ${DrawerMs}ms ease`,
          zIndex: 100,
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
        }}
      >
        <div
          data-testid={testId}
          data-open={shown ? "true" : "false"}
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
            transform: shown ? "translateY(0)" : "translateY(100%)",
            transition: `transform ${DrawerMs}ms ease`,
          }}
        >
          {children}
        </div>
      </div>
    </Overlay>
  );
}

function PlayerSheet({ p, onPay }: { p: TeamPlayer; onPay: () => void }) {
  const s = p.standing;
  const num: React.CSSProperties = { fontVariantNumeric: "tabular-nums", textAlign: "right" };
  const row: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 12, padding: "3px 0" };
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <p style={{ margin: 0, fontWeight: 700, fontSize: "1.05rem" }}>
          {p.last_name}, {p.name}
        </p>
        <span className="badge">{p.fee === "exempt" ? "Arquero" : RoleLabels[p.role]}</span>
      </div>

      {p.fee === "exempt" && (
        <p data-testid="exempt-note" style={{ marginTop: 14 }}>
          Los arqueros no pagan la cuota del torneo.
        </p>
      )}
      {p.fee === "substitute" && (
        <p data-testid="substitute-note" style={{ marginTop: 14 }}>
          Los suplentes no tienen cuota: se les registra lo que pagan, cuando pagan.
        </p>
      )}
      {p.fee === "installments" && (
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
                <span style={{ opacity: 0.6 }}> · {collectorName(pay.registered_by)}</span>
              </span>
              <span style={num}>
                ${formatArs(pay.amount)}
                {pay.concept === "tournament upfront" ? " (anticipado)" : ""}
              </span>
            </div>
          ))}
          {p.fee === "substitute" && p.payments.length > 1 && (
            <div style={{ ...row, borderTop: rowBorder, marginTop: 6, paddingTop: 8, fontWeight: 600 }}>
              <span>Total</span>
              <span style={num}>${formatArs(s.paid)}</span>
            </div>
          )}
        </div>
      )}

      {p.fee !== "exempt" && (
        <button
          data-testid="register-payment"
          className="btnPrimary"
          style={{ width: "100%", marginTop: 18 }}
          onClick={onPay}
        >
          Registrar pago
        </button>
      )}
    </>
  );
}

// ---- El pago ----

type Choice = { amount: number; concept: TournamentConcept };

// Sin botones de cancelar ni de volver: tocar afuera cierra el popup. La
// pantalla se usa cobrando en fila, y cada toque de más cuesta.
function PaymentModal({ p, upfrontPrice, substitutePrice, onClose, onConfirm, busy, error }: {
  p: TeamPlayer;
  upfrontPrice: number | null;
  substitutePrice: number | null;
  onClose: () => void;
  onConfirm: (choice: Choice) => void;
  busy: boolean;
  error: string | null;
}) {
  const s = p.standing;
  const [chosen, setChosen] = useState<Choice | null>(null);
  // "Otro monto..." es un botón hasta que se lo toca: recién ahí aparece el
  // campo, corto, con su OK al lado.
  const [customOpen, setCustomOpen] = useState(false);
  const [custom, setCustom] = useState("");

  const nextMonth = s.installments.find((i) => i.paid < i.amount)?.month;
  const suggestedLabel = s.outstandingNow > 0
    ? "Completar lo vencido"
    : nextMonth
    ? `Cuota de ${monthNameEs(nextMonth)}`
    : null;
  // El torneo entero con descuento: sólo para quien no registró ningún pago
  // todavía, y mientras la primera cuota no haya vencido.
  const offerUpfront = p.fee === "installments" && upfrontPrice !== null &&
    p.payments.length === 0 && s.upfrontAvailable;

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

  const submitCustom = () => {
    let value = parseInt(custom, 10);
    if (!Number.isFinite(value) || value <= 0) return;
    // "30" quiere decir 30k: acá los montos son miles.
    if (value < 1000) value = value * 1000;
    setChosen({ amount: value, concept: "tournament" });
  };

  return (
    <Overlay>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.55)",
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
              {p.fee === "substitute"
                ? (substitutePrice !== null && (
                  <button
                    data-testid="pay-substitute"
                    style={button}
                    onClick={() => setChosen({ amount: substitutePrice, concept: "tournament" })}
                  >
                    Pago de suplente · <strong>${formatArs(substitutePrice)}</strong>
                  </button>
                ))
                : (
                  <>
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
                    {offerUpfront && (
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
                  </>
                )}
              {!customOpen
                ? (
                  <button
                    data-testid="custom-toggle"
                    style={button}
                    onClick={() => setCustomOpen(true)}
                  >
                    Otro monto...
                  </button>
                )
                : (
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      data-testid="custom-amount"
                      type="number"
                      inputMode="numeric"
                      autoFocus
                      placeholder="Monto"
                      value={custom}
                      onChange={(e) => setCustom(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") submitCustom(); }}
                      style={{
                        flex: 1,
                        minWidth: 0,
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
                      onClick={submitCustom}
                    >
                      OK
                    </button>
                  </div>
                )}
            </div>
          ) : (
            <div style={{ marginTop: 14 }}>
              <p style={{ margin: 0, fontSize: "1.6rem", fontWeight: 700 }}>
                ${formatArs(chosen.amount)}
              </p>
              <p style={{ margin: "4px 0 0", opacity: 0.75, fontSize: "0.9rem" }}>
                {chosen.concept === "tournament upfront"
                  ? "Torneo completo por anticipado"
                  : p.fee === "substitute"
                  ? "Pago de suplente"
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
  // El drawer: quién está abierto, y si está bajando.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // El popup de pago, independiente del drawer: se abre desde la fila o
  // desde el drawer, y encima de él.
  const [payingId, setPayingId] = useState<string | null>(null);
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

  const openDrawer = (id: string) => {
    setSelectedId(id);
    setDrawerOpen(true);
  };
  const closeDrawer = () => setDrawerOpen(false);
  const drawerClosed = useCallback(() => setSelectedId(null), []);

  if (error) return <p style={{ color: "crimson" }}>{error}</p>;
  if (!detail) return <p>Cargando…</p>;

  const selected = detail.players.find((p) => p.id === selectedId) ?? null;
  const paying = detail.players.find((p) => p.id === payingId) ?? null;
  const starters = detail.players.filter((p) => p.fee === "installments");
  const substitutes = detail.players.filter((p) => p.fee === "substitute");
  const goalkeepers = detail.players.filter((p) => p.fee === "exempt");
  const upToDate = starters.filter((p) => p.standing.outstandingNow === 0).length;
  const collected = starters.reduce((acc, p) => acc + p.standing.paid, 0);
  const dueSoFar = starters.reduce((acc, p) => acc + p.standing.dueSoFar, 0);
  const substitutesPaid = substitutes.reduce((acc, p) => acc + p.standing.paid, 0);

  const confirm = async (choice: Choice) => {
    if (!paying) return;
    setBusy(true);
    setPayError(null);
    try {
      const res = await fetch(`/api/torneos/equipos/${teamId}/pago`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          player_id: paying.id,
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
      setPayingId(null);
      closeDrawer();
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
        {list.map((p) => (
          <PlayerRow
            key={p.id}
            p={p}
            onOpen={(pl) => openDrawer(pl.id)}
            onPay={(pl) => { setPayError(null); setPayingId(pl.id); }}
          />
        ))}
      </section>
    );

  return (
    <div>
      <p data-testid="team-context" style={{ margin: 0, fontSize: "0.85rem" }}>
        {detail.tournament.name} · {detail.category.name}
      </p>
      {starters.length > 0 && (
        <p data-testid="team-summary" style={{ margin: "4px 0 0", fontSize: "0.85rem" }}>
          {starters.length} {starters.length === 1 ? "titular" : "titulares"} ·{" "}
          <strong>{upToDate}</strong> al día · cobrado{" "}
          <strong>${formatArs(collected)}</strong> de ${formatArs(dueSoFar)} a la fecha
          {substitutesPaid > 0 && ` · suplentes $${formatArs(substitutesPaid)}`}
        </p>
      )}

      {detail.players.length === 0 ? (
        <p style={{ marginTop: 16 }}>Este equipo todavía no tiene jugadores cargados.</p>
      ) : (
        <>
          {section("Titulares", starters)}
          {section("Suplentes", substitutes)}
          {section("Arqueros", goalkeepers)}
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

      {selected && (
        <Drawer
          open={drawerOpen}
          onClosed={drawerClosed}
          onBackdrop={closeDrawer}
          testId="player-sheet"
        >
          <PlayerSheet
            p={selected}
            onPay={() => { setPayError(null); setPayingId(selected.id); }}
          />
        </Drawer>
      )}
      {paying && (
        <PaymentModal
          p={paying}
          upfrontPrice={detail.category.upfront_price}
          substitutePrice={detail.category.substitute_price}
          onClose={() => setPayingId(null)}
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
