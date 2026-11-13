import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { withPermission } from "@/lib/authMiddleware";

// The pause on WhatsApp payment receipts (app_settings, read by the
// notify_payment_receipts trigger): until a time, no payment sends one.

const Key = "payment_receipts_pause";
const MaxMinutes = 12 * 60;

async function current() {
  const { data, error } = await supabaseAdmin().from("app_settings")
    .select("value").eq("key", Key).maybeSingle();
  if (error) throw new Error(error.message);
  const until = typeof data?.value?.until === "string" ? data.value.until : null;
  return { until: until && new Date(until).getTime() > Date.now() ? until : null };
}

export const GET = withPermission('api', '/api/receipts-pause', 'GET', async () => {
  try {
    return NextResponse.json(await current());
  } catch (e) {
    console.error(e);
    return new NextResponse("Error reading the pause", { status: 500 });
  }
});

/** `{ minutes }` pauses for that long from now; 0 resumes. */
export const POST = withPermission('api', '/api/receipts-pause', 'POST', async (_sess, req) => {
  let minutes: number;
  try {
    minutes = Number((await req.json() as { minutes?: unknown }).minutes);
  } catch {
    return new NextResponse("Invalid body", { status: 400 });
  }
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > MaxMinutes) {
    return new NextResponse(`minutes: 0 a ${MaxMinutes}`, { status: 400 });
  }
  const until = minutes === 0 ? null : new Date(Date.now() + minutes * 60_000).toISOString();
  const { error } = await supabaseAdmin().from("app_settings").upsert({
    key: Key,
    value: { until },
    updated_at: new Date().toISOString(),
  });
  if (error) {
    console.error(error);
    return new NextResponse("Error saving the pause", { status: 500 });
  }
  return NextResponse.json({ until });
});
