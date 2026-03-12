"use client";

import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import ProtectedPage from "../components/ProtectedPage";

type TrainingSlot = {
  date: string; // YYYY-MM-DD
  hour: number; // 21, 22, or 23
  category: string; // cat-a, cat-b, cat-c
};

function findThursday(direction: 'prev' | 'next', from: Date): string {
  const d = new Date(from);
  d.setHours(12, 0, 0, 0);
  const offset = direction === 'prev' ? -1 : 1;
  for (let i = 1; i <= 14; i++) {
    const check = new Date(d);
    check.setDate(d.getDate() + i * offset);
    if (check.getDay() === 4) {
      const y = check.getFullYear();
      const m = String(check.getMonth() + 1).padStart(2, '0');
      const dd = String(check.getDate()).padStart(2, '0');
      return `${y}-${m}-${dd}`;
    }
  }
  return '';
}

function findClosestThursday(): string {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  for (let i = 0; i <= 14; i++) {
    const check = new Date(today);
    check.setDate(today.getDate() - i);
    if (check.getDay() === 4) {
      const y = check.getFullYear();
      const m = String(check.getMonth() + 1).padStart(2, '0');
      const dd = String(check.getDate()).padStart(2, '0');
      return `${y}-${m}-${dd}`;
    }
  }
  return '';
}

function slotsForDate(dateStr: string): TrainingSlot[] {
  return [
    { date: dateStr, hour: 21, category: "cat-a" },
    { date: dateStr, hour: 22, category: "cat-b" },
    { date: dateStr, hour: 23, category: "cat-c" },
  ];
}

function TrainingSessionsContent() {
  const router = useRouter();
  const [currentDate, setCurrentDate] = useState(() => findClosestThursday());

  const slots = currentDate ? slotsForDate(currentDate) : [];

  const goToPrev = () => {
    const prev = findThursday('prev', new Date(currentDate + 'T12:00:00'));
    if (prev) setCurrentDate(prev);
  };

  const goToNext = () => {
    const next = findThursday('next', new Date(currentDate + 'T12:00:00'));
    if (next) setCurrentDate(next);
  };

  const handleSlotClick = (slot: TrainingSlot) => {
    const sessionId = `${slot.date}-${slot.hour}`;
    router.push(`/training-sessions/${sessionId}`);
  };

  const formatDateShort = (dateStr: string) => {
    const date = new Date(dateStr + "T12:00:00");
    return date.toLocaleDateString("es-AR", { 
      weekday: "short", 
      year: "numeric", 
      month: "short", 
      day: "numeric" 
    });
  };

  const getCategoryLabel = (cat: string) => {
    switch (cat) {
      case "cat-a": return "Categoría A";
      case "cat-b": return "Categoría B";
      case "cat-c": return "Categoría C";
      default: return cat;
    }
  };

  if (!currentDate) {
    return (
      <ProtectedPage requiredPage="/training-sessions">
        <div>
          <h1>Sesiones de Entrenamiento</h1>
          <p style={{ marginTop: 12 }}>No se encontraron sesiones de entrenamiento recientes.</p>
        </div>
      </ProtectedPage>
    );
  }

  return (
    <ProtectedPage requiredPage="/training-sessions">
      <div>
        <h1>Sesiones de Entrenamiento</h1>
        
        <div style={{ 
          marginTop: 16, 
          marginBottom: 12, 
          display: "flex", 
          alignItems: "center", 
          justifyContent: "center",
          gap: 16
        }}>
          <span
            onClick={goToPrev}
            style={{ cursor: "pointer", fontSize: "1.2rem", userSelect: "none", WebkitTapHighlightColor: "transparent" }}
          >
            «
          </span>
          <span style={{ opacity: 0.8 }}>{formatDateShort(currentDate)}</span>
          <span
            onClick={goToNext}
            style={{ cursor: "pointer", fontSize: "1.2rem", userSelect: "none", WebkitTapHighlightColor: "transparent" }}
          >
            »
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {slots.map((slot) => (
            <button
              key={`${slot.date}-${slot.hour}`}
              className="btnPrimary"
              onClick={() => handleSlotClick(slot)}
              style={{ 
                textAlign: "left",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center"
              }}
            >
              <span>{getCategoryLabel(slot.category)}</span>
              <span style={{ opacity: 0.7 }}>{slot.hour}:00hs</span>
            </button>
          ))}
        </div>

        <div style={{ marginTop: 16 }}>
          <button onClick={() => router.push("/")}>← Volver</button>
        </div>
      </div>
    </ProtectedPage>
  );
}

export default function TrainingSessionsPage() {
  return (
    <Suspense fallback={<div style={{ padding: "20px", textAlign: "center" }}>Cargando...</div>}>
      <TrainingSessionsContent />
    </Suspense>
  );
}
