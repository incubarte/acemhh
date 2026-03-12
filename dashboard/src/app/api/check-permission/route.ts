import { NextResponse } from "next/server";
import { getSession } from "@/lib/authMiddleware";
import { hasPermission } from "@/lib/acl";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request) {
  const session = await getSession();
  
  if (!session) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // TODO(2026-04-12): Remove this upsert once all 30-day session cookies have expired
  // and users must re-login (which upserts via the login routes).
  // Ensure user exists in the database
  supabaseAdmin()
    .from("users")
    .upsert({
      id: session.id,
      username: session.username || null,
      first_name: session.first_name,
      last_name: session.last_name || null,
      last_login_at: new Date().toISOString(),
    }, { onConflict: "id" })
    .then(({ error }) => {
      if (error) console.error("User upsert failed:", error);
    });

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
