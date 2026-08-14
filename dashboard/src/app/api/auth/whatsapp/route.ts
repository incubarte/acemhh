import crypto from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { makeSessionCookieValueFromUser } from "@/lib/telegramAuth";

export const dynamic = "force-dynamic";

// Exchanges a single-use token minted by the whatsapp-webhook for a dashboard
// session. The sender's identity was already proven by WhatsApp (Meta-signed
// wa_id matched against users.phone), so this is the login path for admins
// without Telegram.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  if (!/^[0-9a-f]{64}$/.test(token)) {
    return new NextResponse("Link inválido. Pedí uno nuevo por WhatsApp.", { status: 400 });
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const s = supabaseAdmin();
  const now = new Date().toISOString();

  // Claim by updating used_at in the same statement, so a reused or raced link
  // finds no row instead of logging in twice.
  const { data: claimed, error } = await s
    .from("whatsapp_login_tokens")
    .update({ used_at: now })
    .eq("token_hash", tokenHash)
    .is("used_at", null)
    .gt("expires_at", now)
    .select("user_id")
    .maybeSingle();

  if (error) return new NextResponse(error.message, { status: 500 });
  if (!claimed) {
    return new NextResponse("Link inválido o vencido. Pedí uno nuevo por WhatsApp.", { status: 401 });
  }

  const { data: user, error: userError } = await s
    .from("users")
    .select("id,first_name,last_name,tg_username,groups")
    .eq("id", claimed.user_id)
    .maybeSingle();

  if (userError) return new NextResponse(userError.message, { status: 500 });
  if (!user) return new NextResponse("User not found", { status: 401 });

  const cookieValue = makeSessionCookieValueFromUser({
    id: user.id,
    first_name: user.first_name,
    last_name: user.last_name,
    username: user.tg_username,
    auth_date: Math.floor(Date.now() / 1000),
    groups: user.groups ?? [],
  });

  (await cookies()).set("dash_session", cookieValue, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return NextResponse.redirect(new URL("/", url));
}
