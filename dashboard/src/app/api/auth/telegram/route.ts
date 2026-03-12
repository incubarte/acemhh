import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { makeSessionCookieValue, verifyTelegramAuth, type TelegramAuthPayload } from "@/lib/telegramAuth";

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

  // Log login event
  console.log('[LOGIN]', {
    event: 'user_login',
    user_id: payload.id,
    first_name: payload.first_name,
    last_name: payload.last_name || '',
    username: payload.username || '',
    timestamp: new Date().toISOString(),
  });

  return NextResponse.json({ ok: true });
}
