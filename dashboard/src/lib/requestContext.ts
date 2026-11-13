// Who is behind the request being served, and which submit sent it, so every
// database client made while serving it can say so to the activity log's
// triggers (see supabaseAdmin and the activity_log migration).

import { AsyncLocalStorage } from "node:async_hooks";

export type RequestContext = {
  /** users.id of the logged-in user. */
  actorId?: string;
  /** The trace of the UI submit that sent the request. */
  trace?: string;
};

export const requestContext = new AsyncLocalStorage<RequestContext>();

/** The headers that carry the context to Postgres, through PostgREST. */
export function activityHeaders(): Record<string, string> {
  const ctx = requestContext.getStore();
  const h: Record<string, string> = {};
  if (ctx?.actorId) h["x-activity-actor"] = ctx.actorId;
  if (ctx?.trace) h["x-activity-trace"] = ctx.trace;
  return h;
}

/** A trace as the client sends it: short, and safe to pass on as a header. */
export function cleanTrace(v: string | null | undefined): string | undefined {
  return v && /^[A-Za-z0-9-]{1,64}$/.test(v) ? v : undefined;
}
