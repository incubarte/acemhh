import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { withPermission } from "@/lib/authMiddleware";

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

  let date = requested;
  if (!date) {
    const today = new Date().toISOString().slice(0, 10);
    const { data: upcoming, error } = await s.from("training_slots")
      .select("date")
      .gte("date", today)
      .order("date")
      .limit(1);
    if (error) return new NextResponse(error.message, { status: 500 });

    if (upcoming?.length) {
      date = upcoming[0].date;
    } else {
      const { data: last, error: lastError } = await s.from("training_slots")
        .select("date")
        .order("date", { ascending: false })
        .limit(1);
      if (lastError) return new NextResponse(lastError.message, { status: 500 });
      if (!last?.length) return NextResponse.json({ day: null });
      date = last[0].date;
    }
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
  };

  return NextResponse.json({ day });
});
