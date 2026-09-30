"use client";

import { useState } from "react";

/**
 * An optional note on a payment, folded away behind "+ agregar nota": most
 * payments need none, and the ones that do ("me lo transfirieron a mi cuenta")
 * are what the collector reads back at the arqueo.
 */
export default function NoteField({ value, onChange }: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(value !== "");

  if (!open) {
    return (
      <button
        type="button"
        data-testid="note-toggle"
        onClick={() => setOpen(true)}
        style={{
          alignSelf: "flex-start",
          padding: "4px 0",
          border: "none",
          background: "transparent",
          color: "inherit",
          opacity: 0.7,
          cursor: "pointer",
          fontSize: "0.85rem",
        }}
      >
        + agregar nota
      </button>
    );
  }

  return (
    <input
      data-testid="note-input"
      autoFocus
      maxLength={200}
      placeholder="Nota (ej: me lo transfirieron a mi cuenta)"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%",
        boxSizing: "border-box",
        padding: "10px 12px",
        borderRadius: 8,
        border: "1px solid rgba(255,255,255,0.2)",
        background: "rgba(255,255,255,0.06)",
        color: "inherit",
        fontSize: "0.9rem",
      }}
    />
  );
}
