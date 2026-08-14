import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { verifySessionCookieValue, type SessionUser } from "@/lib/telegramAuth";
import { hasPermission, isPublicRoute } from "@/lib/acl";

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
  return async (req: Request) => {
    try {
      const session = await requirePermission(type, resource, method);
      return await handler(session, req);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "Unauthorized") {
        return new NextResponse("Unauthorized", { status: 401 });
      }
      if (msg === "Forbidden") {
        return new NextResponse("Forbidden", { status: 403 });
      }
      console.error("Error in withPermission:", e);
      return new NextResponse("Internal Server Error", { status: 500 });
    }
  };
}
