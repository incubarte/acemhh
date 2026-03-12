import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { makeSessionCookieValue, verifyTelegramAuth, type TelegramAuthPayload } from "@/lib/telegramAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {
  const payload = (await req.json()) as TelegramAuthPayload;

  if (!payload?.hash || !payload?.id || !payload?.auth_date) {
    return new NextResponse("Invalid payload", { status: 400 });
  }

  const ok = verifyTelegramAuth(payload);
  if (!ok) {
    return new NextResponse("Invalid Telegram auth", { status: 401 });
  }

  const value = makeSessionCookieValue(payload);
  (await cookies()).set({
    name: "dash_session",
    value,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  // Track user login in database
  try {
    const { error } = await supabaseAdmin()
      .from("users")
      .upsert({
        id: payload.id,
        username: payload.username || null,
        first_name: payload.first_name,
        last_name: payload.last_name || null,
        last_login_at: new Date().toISOString()
      }, {
        onConflict: 'id'
      });

    if (error) {
      console.error('[LOGIN] Error tracking user login:', error);
    }
  } catch (error) {
    console.error('[LOGIN] Exception tracking user login:', error);
  }

  return NextResponse.json({ ok: true });
}
