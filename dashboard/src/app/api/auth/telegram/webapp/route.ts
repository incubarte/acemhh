import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { makeSessionCookieValueFromUser, verifyTelegramWebAppInitData } from "@/lib/telegramAuth";

type Body = {
  initData?: string;
};

export async function POST(req: Request) {
  const body = (await req.json()) as Body;
  const initData = (body.initData ?? "").trim();
  if (!initData) return new NextResponse("Missing initData", { status: 400 });

  const user = verifyTelegramWebAppInitData(initData);
  if (!user) return new NextResponse("Invalid initData", { status: 401 });

  const value = makeSessionCookieValueFromUser(user);
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
    user_id: user.id,
    first_name: user.first_name,
    last_name: user.last_name || '',
    username: user.username || '',
    timestamp: new Date().toISOString(),
  });

  return NextResponse.json({ ok: true });
}
