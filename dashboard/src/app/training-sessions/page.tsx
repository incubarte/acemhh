"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import ProtectedPage from "../components/ProtectedPage";
import { usePageTitle } from "../components/PageTitleContext";
import type { TrainingDay } from "../api/training-slots/route";
import { attendancePath, readExperience, type Experience } from "@/lib/experience";

function TrainingSessionsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialDate = searchParams.get("date");

  const [day, setDay] = useState<TrainingDay | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  // Which screen a slot opens. Read after mount so the server-rendered markup
  // never mismatches; the switch itself now lives on the screens it picks
  // between. New by default, and only a stored opt-out says otherwise.
  const [experience, setExperience] = useState<Experience>("nueva");
  useEffect(() => {
    setExperience(readExperience());
  }, []);

  // The agenda lives in training_sessions: navigation walks the dates that
  // actually have trainings, so holidays are skipped without special cases.
  const load = useCallback(async (date: string | null) => {
    const res = await fetch(`/api/training-slots${date ? `?date=${date}` : ""}`);
    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    const body = (await res.json()) as { day: TrainingDay | null };
    setErr(null);
    setDay(body.day);
    if (body.day) {
      router.replace(`/training-sessions?date=${body.day.date}`, { scroll: false });
    }
  }, [router]);

  useEffect(() => {
    load(initialDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      default: return cat;
    }
  };

  usePageTitle("Sesiones de Entrenamiento");

  if (day === undefined) {
    return (
      <ProtectedPage requiredPage="/training-sessions">
        <div>
          {err
            ? <p style={{ marginTop: 12, color: "crimson" }}>{err}</p>
            : <p style={{ marginTop: 12 }}>Cargando...</p>}
        </div>
      </ProtectedPage>
    );
  }

  if (day === null) {
    return (
      <ProtectedPage requiredPage="/training-sessions">
        <div>
          <p style={{ marginTop: 12 }}>No hay entrenamientos en la agenda.</p>
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
            onClick={() => day.prev && load(day.prev)}
            style={{
              cursor: day.prev ? "pointer" : "default",
              opacity: day.prev ? 1 : 0.25,
              fontSize: "1.2rem",
              userSelect: "none",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            «
          </span>
          <span style={{ opacity: 0.8 }}>{formatDateShort(day.date)}</span>
          <span
            onClick={() => day.next && load(day.next)}
            style={{
              cursor: day.next ? "pointer" : "default",
              opacity: day.next ? 1 : 0.25,
              fontSize: "1.2rem",
              userSelect: "none",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            »
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {day.slots.length === 0 && (
            <p style={{ textAlign: "center", opacity: 0.7 }}>
              No hay entrenamiento este día.
            </p>
          )}
          {day.slots.map((slot) => (
            <button
              key={`${day.date}-${slot.hour}`}
              className="btnPrimary"
              onClick={() =>
                router.push(attendancePath(experience, `${day.date}-${slot.hour}`))}
              style={{
                textAlign: "left",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center"
              }}
            >
              <span>{slot.categories.map(getCategoryLabel).join(" + ")}</span>
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
