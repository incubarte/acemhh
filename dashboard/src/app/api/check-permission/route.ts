import { NextResponse } from "next/server";
import { getSession } from "@/lib/authMiddleware";
import { hasPermission } from "@/lib/acl";

export async function GET(req: Request) {
  const session = await getSession();
  
  if (!session) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") as 'api' | 'page' | null;
  const resource = searchParams.get("resource");
  const method = searchParams.get("method") as 'GET' | 'POST' | 'PUT' | 'DELETE' | null;

  if (!type || !resource) {
    return new NextResponse("Missing parameters", { status: 400 });
  }

  const allowed = hasPermission(
    session.id,
    type,
    resource,
    method ?? undefined
  );

  if (!allowed) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  return NextResponse.json({ ok: true });
}
