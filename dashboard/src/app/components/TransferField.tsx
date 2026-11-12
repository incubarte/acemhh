"use client";

/**
 * Marks a payment as paid by transfer to ACEMHH's bank account, folded away
 * behind "+ transf banco ACEMHH" like the note: almost every payment is cash. A
 * transfer is listed in the caja as "(banco)" and adds to nobody's caja.
 */
export default function TransferField({ value, onChange }: {
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const subtle = {
    alignSelf: "flex-start",
    padding: "4px 0",
    border: "none",
    background: "transparent",
    color: "inherit",
    cursor: "pointer",
    fontSize: "0.85rem",
  } as const;

  if (!value) {
    return (
      <button
        type="button"
        data-testid="transfer-toggle"
        onClick={() => onChange(true)}
        style={{ ...subtle, opacity: 0.7 }}
      >
        + transf banco ACEMHH
      </button>
    );
  }

  return (
    <span data-testid="transfer-on" style={{ fontSize: "0.85rem", display: "flex", gap: 8, alignItems: "center" }}>
      🏦 transf banco ACEMHH: no suma a tu caja
      <button
        type="button"
        data-testid="transfer-off"
        onClick={() => onChange(false)}
        style={{ ...subtle, opacity: 0.6, textDecoration: "underline", padding: 0 }}
      >
        quitar
      </button>
    </span>
  );
}
