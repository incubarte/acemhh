// The server's side of the activity log: the API lines, written as each
// request that changes something is answered. The UI lines come from the
// phone (lib/activity.ts, /api/activity); the DB lines from the triggers.

import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type ApiLine = {
  actorId: string | null;
  path: string;
  method: string;
  status: number;
  trace?: string;
  body: unknown;
  /** What the service said, when it refused. */
  reason?: string;
};

/** Never throws: a lost log line must not cost the answer it describes. */
export async function logApi(line: ApiLine): Promise<void> {
  try {
    const { error } = await supabaseAdmin().from("activity_log").insert({
      source: "API",
      actor_id: line.actorId,
      actor: line.actorId ? null : "sin sesión",
      screen: null,
      action: `${line.method} ${line.path}`,
      detail: {
        body: line.body ?? null,
        ...(line.reason ? { reason: line.reason } : {}),
      },
      trace: line.trace ?? null,
      status: line.status,
    });
    if (error) console.error("activity_log (API):", error.message);
  } catch (e) {
    console.error("activity_log (API):", e);
  }
}

/** The JSON body of a request, without consuming it. */
export async function peekBody(req: Request): Promise<unknown> {
  try {
    const text = await req.clone().text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text.slice(0, 500);
    }
  } catch {
    return null;
  }
}

/** The refusal text of a response that was not a success, kept short. */
export async function refusalOf(res: Response): Promise<string | undefined> {
  if (res.ok) return undefined;
  try {
    const text = (await res.clone().text()).trim();
    return text ? text.slice(0, 300) : undefined;
  } catch {
    return undefined;
  }
}
