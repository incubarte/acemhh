import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { withPermission } from "@/lib/authMiddleware";
import { currentTrainingDate } from "@/lib/trainingDay";

export type DaySlot = {
  hour: number;
  categories: string[];
  goalies: boolean;
};

export type TrainingDay = {
  date: string; // YYYY-MM-DD
  slots: DaySlot[];
  /** Nearest earlier/later dates that have slots — holidays are skipped for free. */
  prev: string | null;
  next: string | null;
  /** The date the app considers current, to tell apart browsing from working. */
  current: string | null;
};

// ?date=YYYY-MM-DD returns that day (possibly with no slots) and its
// neighbors; without a date it returns the next training day from today
// (or the last known one when the agenda ran out).
export const GET = withPermission('api', '/api/training-slots', 'GET', async (sess, req) => {
  const { searchParams } = new URL(req.url);
  const requested = (searchParams.get("date") || "").trim();
  if (requested && !/^\d{4}-\d{2}-\d{2}$/.test(requested)) {
    return new NextResponse("Invalid date", { status: 400 });
  }

  const s = supabaseAdmin();

  // Opening the screen lands on the session being worked on — today's, or
  // yesterday's when today has none — rather than the next one on the agenda.
  const current = await currentTrainingDate(s);
  let date = requested;
  if (!date) {
    if (!current) return NextResponse.json({ day: null });
    date = current;
  }

  const [slotsRes, prevRes, nextRes] = await Promise.all([
    s.from("training_slots")
      .select("hour,categories,goalies")
      .eq("date", date)
      .order("hour"),
    s.from("training_slots")
      .select("date")
      .lt("date", date)
      .order("date", { ascending: false })
      .limit(1),
    s.from("training_slots")
      .select("date")
      .gt("date", date)
      .order("date")
      .limit(1),
  ]);

  const firstError = slotsRes.error ?? prevRes.error ?? nextRes.error;
  if (firstError) return new NextResponse(firstError.message, { status: 500 });

  const day: TrainingDay = {
    date,
    slots: (slotsRes.data ?? []).map((r) => ({
      hour: r.hour,
      categories: r.categories,
      goalies: r.goalies,
    })),
    prev: prevRes.data?.[0]?.date ?? null,
    next: nextRes.data?.[0]?.date ?? null,
    current,
  };

  return NextResponse.json({ day });
});
