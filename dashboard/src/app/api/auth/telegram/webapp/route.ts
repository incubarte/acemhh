import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { makeSessionCookieValueFromUser, verifyTelegramWebAppInitData } from "@/lib/telegramAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

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

  // Track user login in database
  try {
    const { error } = await supabaseAdmin()
      .from("users")
      .upsert({
        id: user.id,
        username: user.username || null,
        first_name: user.first_name,
        last_name: user.last_name || null,
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
