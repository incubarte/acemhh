"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import ProtectedPage from "../components/ProtectedPage";
import { usePageTitle } from "../components/PageTitleContext";
import { slotsForDate as scheduleSlotsForDate } from "@/lib/schedule";

type TrainingSlot = {
  date: string;
  hour: number;
  categories: string[];
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
  return scheduleSlotsForDate(dateStr).map(({ hour, categories }) => ({
    date: dateStr,
    hour,
    categories,
  }));
}

function TrainingSessionsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [currentDate, setCurrentDate] = useState(() => searchParams.get("date") || findClosestThursday());

  const slots = currentDate ? slotsForDate(currentDate) : [];

  const navigateToDate = (date: string) => {
    setCurrentDate(date);
    router.replace(`/training-sessions?date=${date}`, { scroll: false });
  };

  const goToPrev = () => {
    const prev = findThursday('prev', new Date(currentDate + 'T12:00:00'));
    if (prev) navigateToDate(prev);
  };

  const goToNext = () => {
    const next = findThursday('next', new Date(currentDate + 'T12:00:00'));
    if (next) navigateToDate(next);
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
      case "youth": return "Juveniles";
      case "u-14": return "Menores";
      default: return cat;
    }
  };

  usePageTitle("Sesiones de Entrenamiento");

  if (!currentDate) {
    return (
      <ProtectedPage requiredPage="/training-sessions">
        <div>
          <p style={{ marginTop: 12 }}>No se encontraron sesiones de entrenamiento recientes.</p>
        </div>
      </ProtectedPage>
    );
  }

  return (
    <ProtectedPage requiredPage="/training-sessions">
      <div>
        
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
              <span>{slot.categories.length > 0 ? slot.categories.map(getCategoryLabel).join(" + ") : "—"}</span>
              <span style={{ opacity: 0.7 }}>{slot.hour}:00hs</span>
            </button>
          ))}
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
