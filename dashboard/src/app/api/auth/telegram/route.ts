import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { makeSessionCookieValueFromUser, verifyTelegramAuth, type TelegramAuthPayload } from "@/lib/telegramAuth";
import { sessionFromTelegramIdentity } from "@/lib/login";

export async function POST(req: Request) {
  const payload = (await req.json()) as TelegramAuthPayload;

  if (!payload?.hash || !payload?.id || !payload?.auth_date) {
    return new NextResponse("Invalid payload", { status: 400 });
  }

  const ok = verifyTelegramAuth(payload);
  if (!ok) {
    return new NextResponse("Invalid Telegram auth", { status: 401 });
  }

  const session = await sessionFromTelegramIdentity({
    id: payload.id,
    first_name: payload.first_name,
    last_name: payload.last_name ?? null,
    username: payload.username ?? null,
    auth_date: payload.auth_date,
  });
  if (!session) return new NextResponse("Login failed", { status: 500 });

  (await cookies()).set({
    name: "dash_session",
    value: makeSessionCookieValueFromUser(session),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return NextResponse.json({ ok: true });
}
