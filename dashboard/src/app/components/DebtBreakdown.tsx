"use client";

import React from "react";

const MONTH_NAMES_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function monthNameEs(month: string) {
  return MONTH_NAMES_ES[Number(month.slice(5)) - 1] ?? month;
}

/**
 * The debt, month by month: each closed month with what it charged and what
 * was paid, then the running month with what was attended and paid so far.
 * The two are different animals — a closed month's figure is final, this
 * month's is what it is waiting for right now and closing may still forgive
 * part of it — so they are never added into one line.
 */
export default function DebtBreakdown({ player, month, pesos }: {
  player: {
    debt: number;
    debt_outstanding: number;
    debt_months: {
      month: string;
      charge: number;
      paid: number;
      settled: number;
      outstanding: number;
    }[];
    owed_now: number;
    cur_attended: number;
    cur_paid: number;
  };
  /** YYYY-MM of the session on screen. */
  month: string;
  pesos: (n: number) => string;
}) {
  // A month already paid off is not part of the debt, however it got there.
  const closed = player.debt_months.filter((d) => d.outstanding > 0);
  const row: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    padding: "3px 0",
  };
  const num: React.CSSProperties = { fontVariantNumeric: "tabular-nums", textAlign: "right" };
  const heading: React.CSSProperties = {
    marginTop: 12,
    fontSize: "0.7rem",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    opacity: 0.55,
  };
  return (
    <div style={{ fontSize: "0.85rem", opacity: 0.9 }}>
      {closed.length > 0 && (
        <>
          <div style={heading}>Meses cerrados</div>
          {closed.map((d) => (
            <div key={d.month} style={row}>
              <span>{monthNameEs(d.month)}</span>
              <span style={num}>
                pagó {pesos(d.paid + d.settled)} de {pesos(d.charge)} · debe {pesos(d.outstanding)}
              </span>
            </div>
          ))}
        </>
      )}
      {player.owed_now > 0 && (
        <>
          <div style={heading}>Mes en curso</div>
          <div style={row}>
            <span>{monthNameEs(month)}</span>
            <span style={num}>
              fue {player.cur_attended} {player.cur_attended === 1 ? "vez" : "veces"} · pagó{" "}
              {pesos(player.cur_paid)} · debe {pesos(player.owed_now)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
