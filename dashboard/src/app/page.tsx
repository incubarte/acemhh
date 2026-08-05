"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import ProtectedPage from "./components/ProtectedPage";
import { usePageTitle } from "./components/PageTitleContext";

const BUTTONS = [
  { href: "/training-sessions", label: "📋 Asistencia y Pagos" },
  { href: "/players/new", label: "🧑🏻‍🦽‍➡️ Nuevo Jugador" },
  { href: "/payments", label: "🏛️ Cuota Social" },
  { href: "/credencial", label: "🪪 Credencial de Socio" },
];

// Rendered as a child of ProtectedPage so these checks only fire once the session
// is established. Fetching them in the parent races the Telegram auto-auth in
// ProtectedPage: on an expired session every check 401s and the menu renders empty.
function HomeMenu() {
  const [allowed, setAllowed] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all(
      BUTTONS.map(async (b) => {
        try {
          const res = await fetch(`/api/check-permission?type=page&resource=${encodeURIComponent(b.href)}`);
          return { href: b.href, ok: res.ok };
        } catch {
          return { href: b.href, ok: false };
        }
      })
    ).then((results) => {
      const map: Record<string, boolean> = {};
      results.forEach((r) => { map[r.href] = r.ok; });
      setAllowed(map);
      setLoaded(true);
    });
  }, []);

  if (!loaded) return null;

  return (
    <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 12 }}>
      {BUTTONS.filter((b) => allowed[b.href]).map((b) => (
        <Link key={b.href} href={b.href} style={{ textDecoration: "none" }}>
          <button className="btnPrimary" style={{ width: "100%", textAlign: "left" }}>
            {b.label}
          </button>
        </Link>
      ))}
    </div>
  );
}

function HomeContent() {
  usePageTitle(" ");

  return (
    <ProtectedPage requiredPage="/">
      <div>
        <HomeMenu />
      </div>
    </ProtectedPage>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div style={{ padding: "20px", textAlign: "center" }}>Cargando...</div>}>
      <HomeContent />
    </Suspense>
  );
}
