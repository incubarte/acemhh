import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { verifySessionCookieValue, type SessionUser } from "@/lib/telegramAuth";
import { hasPermission, isPublicRoute } from "@/lib/acl";
import { cleanTrace, requestContext } from "@/lib/requestContext";
import { logApi, peekBody, refusalOf } from "@/lib/activityServer";

export type AuthSession = SessionUser;

export async function getSession(): Promise<AuthSession | null> {
  const v = (await cookies()).get("dash_session")?.value;
  if (!v) return null;
  return verifySessionCookieValue(v);
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
