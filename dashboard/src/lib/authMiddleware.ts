import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { makeSessionCookieValueFromUser, verifySessionCookieValue, type SessionUser } from "@/lib/telegramAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { hasPermission, isPublicRoute } from "@/lib/acl";
import { cleanTrace, requestContext } from "@/lib/requestContext";
import { logApi, peekBody, refusalOf } from "@/lib/activityServer";

export type AuthSession = SessionUser;

/**
 * The signed-in user, with the groups the users table gives them right now.
 *
 * The cookie remembers the groups from the login, but a promotion or a
 * revocation has to apply on the next request, not when the cookie expires a
 * month later: the groups are read again every time, and when they changed
 * the cookie is rewritten so the device carries the new ones. A user whose
 * row is gone is signed out.
 */
export async function getSession(): Promise<AuthSession | null> {
  const jar = await cookies();
  const v = jar.get("dash_session")?.value;
  if (!v) return null;
  const session = verifySessionCookieValue(v);
  if (!session) return null;

  const { data, error } = await supabaseAdmin()
    .from("users")
    .select("groups")
    .eq("id", session.id)
    .maybeSingle();
  // The database not answering is no reason to sign anyone out, nor to hand
  // out anything new: the cookie's groups stand for this request.
  if (error) {
    console.error("[SESSION] groups lookup failed:", error);
    return session;
  }
  if (!data) return null;

  const groups: string[] = data.groups ?? [];
  if (sameGroups(groups, session.groups)) return session;
  const fresh = { ...session, groups };
  try {
    jar.set("dash_session", makeSessionCookieValueFromUser(fresh), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  } catch {
    // Outside a route handler the cookie cannot be written; the next API
    // request will. The fresh groups apply either way.
  }
  return fresh;
}

function sameGroups(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((g) => b.includes(g));
}

export async function requireAuth(): Promise<AuthSession> {
  const session = await getSession();
  if (!session) {
    throw new Error("Unauthorized");
  }
  return session;
}

export async function requirePermission(
  type: 'api' | 'page',
  resource: string,
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
): Promise<AuthSession> {
  const session = await requireAuth();
  
  if (!hasPermission(session.groups, type, resource, method)) {
    throw new Error("Forbidden");
  }
  
  return session;
}

export function withAuth(handler: (session: AuthSession) => Promise<Response> | Response) {
  return async () => {
    try {
      const session = await requireAuth();
      return await handler(session);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "Unauthorized") {
        return new NextResponse("Unauthorized", { status: 401 });
      }
      return new NextResponse("Internal Server Error", { status: 500 });
    }
  };
}

export function withPermission(
  type: 'api',
  resource: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  handler: (session: AuthSession, req: Request) => Promise<Response> | Response
) {
  // Every request that changes something leaves an API line in the activity
  // log, refused ones included. The log's own endpoint does not: its lines
  // are the UI's.
  const logged = method !== 'GET' && resource !== '/api/activity';
  return async (req: Request) => {
    const trace = cleanTrace(req.headers.get("x-activity-trace"));
    const body = logged ? await peekBody(req) : null;
    let actorId: string | null = null;
    let res: Response;
    try {
      const session = await requirePermission(type, resource, method);
      actorId = session.id;
      res = await requestContext.run({ actorId: session.id, trace }, () => handler(session, req));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "Unauthorized") {
        res = new NextResponse("Unauthorized", { status: 401 });
      } else if (msg === "Forbidden") {
        res = new NextResponse("Forbidden", { status: 403 });
      } else {
        console.error("Error in withPermission:", e);
        res = new NextResponse("Internal Server Error", { status: 500 });
      }
    }
    if (logged) {
      await logApi({
        actorId,
        path: new URL(req.url).pathname,
        method,
        status: res.status,
        trace,
        body,
        reason: await refusalOf(res),
      });
    }
    return res;
  };
}
