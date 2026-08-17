"use client";

// Shared building blocks for the caja screens: bordered section cards that
// keep each block visually delimited, currency formatting, and the low-amount
// confirmation dialog.

export function formatArs(amount: number) {
  return `$${amount.toLocaleString("es-AR")}`;
}

export function formatWhen(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{
      marginTop: 16,
      border: "1px solid rgba(255,255,255,0.14)",
      borderRadius: 12,
      overflow: "hidden",
      background: "rgba(255,255,255,0.03)",
    }}>
      <div style={{
        padding: "10px 14px",
        background: "rgba(255,255,255,0.06)",
        borderBottom: "1px solid rgba(255,255,255,0.1)",
        fontWeight: 600,
        fontSize: "0.95rem",
      }}>
        {title}
      </div>
      <div style={{ padding: 14 }}>{children}</div>
    </section>
  );
}

/**
 * Sanity check before saving a suspiciously small amount: club movements are
 * in the thousands, so a sub-$1000 figure is usually a typo missing its last
 * three zeros. The admin can confirm it is intentional or go back and fix it.
 */
export function LowAmountDialog({ amount, onConfirm, onCancel }: {
  amount: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.6)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 100,
      padding: 20,
    }}>
      <div style={{
        maxWidth: 380,
        width: "100%",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.18)",
        background: "#1c2620",
        padding: 20,
      }}>
        <p style={{ fontSize: "1.05rem", fontWeight: 600, margin: 0 }}>
          ¿El monto es {formatArs(amount)}?
        </p>
        <p style={{ marginTop: 8, opacity: 0.8, fontSize: "0.9rem" }}>
          Es un monto bajo — fijate si no te faltaron los últimos tres ceros.
        </p>
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button onClick={onCancel} style={{ flex: 1 }}>
            Corregir
          </button>
          <button className="btnPrimary" onClick={onConfirm} style={{ flex: 1 }}>
            Sí, es {formatArs(amount)}
          </button>
        </div>
      </div>
    </div>
  );
}
