"use client";

import Link from "next/link";
import { Suspense } from "react";
import ProtectedPage from "./components/ProtectedPage";

function HomeContent() {
  return (
    <ProtectedPage requiredPage="/">
      <div>
        <h1>ACEMHH Dashboard</h1>
        
        <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 12 }}>
          <Link href="/payments" style={{ textDecoration: "none" }}>
            <button className="btnPrimary" style={{ width: "100%", textAlign: "left" }}>
              💰 Registrar Pago
            </button>
          </Link>
          
          <Link href="/training-sessions" style={{ textDecoration: "none" }}>
            <button className="btnPrimary" style={{ width: "100%", textAlign: "left" }}>
              📋 Asistencia y Pagos
            </button>
          </Link>
          
          <Link href="/players/new" style={{ textDecoration: "none" }}>
            <button style={{ width: "100%", textAlign: "left" }}>
              ➕ Nuevo Jugador
            </button>
          </Link>
        </div>
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
