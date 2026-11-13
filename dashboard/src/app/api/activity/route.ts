import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { withPermission } from "@/lib/authMiddleware";
import { cleanTrace } from "@/lib/requestContext";

const MaxBatch = 200;
const Uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type IncomingEntry = {
  id?: unknown;
  client_at?: unknown;
  sent_at?: unknown;
  screen?: unknown;
  action?: unknown;
  detail?: unknown;
  trace?: unknown;
  tab?: unknown;
  seq?: unknown;
  attempts?: unknown;
  after_close?: unknown;
};

const text = (v: unknown, max: number) => typeof v === "string" ? v.slice(0, max) : null;
const int = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;

/**
 * The UI lines, as the phone sends them: live, or later when sending failed.
 * Who took the action is whoever the session says, never what the phone
 * says. An entry sent twice (two tabs, a beacon and a retry) is kept once.
 */
export const POST = withPermission('api', '/api/activity', 'POST', async (sess, req) => {
  let entries: IncomingEntry[];
  try {
    const body = await req.json() as { entries?: IncomingEntry[] };
    entries = Array.isArray(body?.entries) ? body.entries.slice(0, MaxBatch) : [];
  } catch {
    return new NextResponse("Invalid body", { status: 400 });
  }

  const now = Date.now();
  const rows = entries
    .filter((e) => typeof e.id === "string" && Uuid.test(e.id) && typeof e.action === "string")
    .map((e) => {
      const clientAt = int(e.client_at);
      const sentAt = int(e.sent_at);
      // Measured on the phone's clock alone, so it holds when that clock is
      // wrong; where the line lands is the server's clock minus it.
      const delay = clientAt !== null && sentAt !== null ? Math.max(0, sentAt - clientAt) : 0;
      return {
        id: e.id as string,
        source: "UI",
        actor_id: sess.id,
        at: new Date(now - delay).toISOString(),
        screen: text(e.screen, 200),
        action: text(e.action, 100)!,
        detail: e.detail && typeof e.detail === "object" ? e.detail : {},
        trace: cleanTrace(typeof e.trace === "string" ? e.trace : null) ?? null,
        tab: text(e.tab, 20),
        seq: int(e.seq),
        attempts: int(e.attempts),
        after_close: e.after_close === true,
        delay_ms: Math.min(delay, 2_000_000_000),
      };
    });

  if (rows.length > 0) {
    const { error } = await supabaseAdmin()
      .from("activity_log")
      .upsert(rows, { onConflict: "id", ignoreDuplicates: true });
    if (error) {
      console.error("activity_log (UI):", error.message);
      return new NextResponse("Error storing activity", { status: 500 });
    }
  }
  return NextResponse.json({ ok: true, stored: rows.length });
});

/** A day of lines (Buenos Aires day), with the names they refer to. */
export const GET = withPermission('api', '/api/activity', 'GET', async (_sess, req) => {
  const url = new URL(req.url);
  const day = url.searchParams.get("day") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return new NextResponse("day=YYYY-MM-DD", { status: 400 });
  }
  const from = new Date(`${day}T00:00:00-03:00`);
  const to = new Date(from.getTime() + 24 * 3600 * 1000);

  const s = supabaseAdmin();
  const lines: Record<string, unknown>[] = [];
  // Paged: a busy day can pass PostgREST's row cap.
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await s.from("activity_log")
      .select("id,at,received_at,source,actor_id,actor,screen,action,detail,trace,tab,seq,attempts,after_close,delay_ms,status")
      .gte("at", from.toISOString())
      .lt("at", to.toISOString())
      .order("at", { ascending: true })
      .order("received_at", { ascending: true })
      .range(offset, offset + 999);
    if (error) {
      console.error(error);
      return new NextResponse("Error fetching activity", { status: 500 });
    }
    lines.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }

  const [{ data: users }, { data: players }] = await Promise.all([
    s.from("users").select("id,first_name,last_name"),
    s.from("players").select("id,name,last_name"),
  ]);

  return NextResponse.json({
    lines,
    users: Object.fromEntries((users ?? []).map((u) => [u.id, [u.first_name, u.last_name].filter(Boolean).join(" ")])),
    players: Object.fromEntries((players ?? []).map((p) => [p.id, [p.name, p.last_name].filter(Boolean).join(" ")])),
  });
});
