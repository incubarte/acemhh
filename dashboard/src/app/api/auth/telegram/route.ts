import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { makeSessionCookieValue, verifyTelegramAuth, type TelegramAuthPayload } from "@/lib/telegramAuth";
import { track } from '@vercel/analytics/server';

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

  // Track login event
  await track('user_login', {
    user_id: payload.id.toString(),
    first_name: payload.first_name,
    last_name: payload.last_name || '',
    username: payload.username || '',
  });

  return NextResponse.json({ ok: true });
}
