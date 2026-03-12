"use client";

import { useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import ProtectedPage from "../components/ProtectedPage";

type TrainingSlot = {
  date: string; // YYYY-MM-DD
  hour: number; // 21, 22, or 23
  category: string; // cat-a, cat-b, cat-c
};

function TrainingSessionsContent() {
  const router = useRouter();
  const [slots, setSlots] = useState<TrainingSlot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Find the most recent Thursday with training slots
    const findRecentThursday = () => {
      const today = new Date();
      const result: TrainingSlot[] = [];
      
      // Search backwards up to 14 days
      for (let i = 0; i <= 14; i++) {
        // Create date at noon to avoid timezone issues
        const checkDate = new Date(today);
        checkDate.setDate(today.getDate() - i);
        checkDate.setHours(12, 0, 0, 0);
        
        // Check if it's Thursday (day 4)
        if (checkDate.getDay() === 4) {
          const year = checkDate.getFullYear();
          const month = String(checkDate.getMonth() + 1).padStart(2, '0');
          const day = String(checkDate.getDate()).padStart(2, '0');
          const dateStr = `${year}-${month}-${day}`;
          
          result.push(
            { date: dateStr, hour: 21, category: "cat-a" },
            { date: dateStr, hour: 22, category: "cat-b" },
            { date: dateStr, hour: 23, category: "cat-c" }
          );
          break;
        }
      }
      
      return result;
    };

    const recentSlots = findRecentThursday();
    setSlots(recentSlots);
    setLoading(false);
  }, []);

  const handleSlotClick = (slot: TrainingSlot) => {
    const sessionId = `${slot.date}-${slot.hour}`;
    router.push(`/training-sessions/${sessionId}`);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + "T12:00:00");
    return date.toLocaleDateString("es-AR", { 
      weekday: "long", 
      year: "numeric", 
      month: "long", 
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

  if (loading) {
    return (
      <ProtectedPage requiredPage="/training-sessions">
        <div>
          <h1>Sesiones de Entrenamiento</h1>
          <p style={{ marginTop: 12 }}>Cargando...</p>
        </div>
      </ProtectedPage>
    );
  }

  if (slots.length === 0) {
    return (
      <ProtectedPage requiredPage="/training-sessions">
        <div>
          <h1>Sesiones de Entrenamiento</h1>
          <p style={{ marginTop: 12 }}>No se encontraron sesiones de entrenamiento recientes.</p>
        </div>
      </ProtectedPage>
    );
  }

  const firstSlotDate = slots[0].date;

  return (
    <ProtectedPage requiredPage="/training-sessions">
      <div>
        <h1>Sesiones de Entrenamiento</h1>
        
        <div style={{ marginTop: 16, marginBottom: 12, opacity: 0.8 }}>
          {formatDate(firstSlotDate)}
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
