import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  if (process.env.NODE_ENV === "production" || !process.env.DEV_AUTH_ID) {
    return new NextResponse("Not available", { status: 404 });
  }

  const { supabaseAdmin } = await import("@/lib/supabaseAdmin");
  const { makeSessionCookieValueFromUser } = await import("@/lib/telegramAuth");

  // DEV_AUTH_ID is still the Telegram id: stable and known, unlike the uuid
  // PK which differs per database.
  const devId = Number(process.env.DEV_AUTH_ID);
  const { data } = await supabaseAdmin()
    .from("users")
    .select("id,first_name,last_name,tg_username,groups")
    .eq("tg_id", devId)
    .maybeSingle();

  if (!data) {
    return NextResponse.json({ error: `User with tg_id ${devId} not found in users table` }, { status: 404 });
  }

  const cookieValue = makeSessionCookieValueFromUser({
    id: data.id,
    first_name: data.first_name,
    last_name: data.last_name,
    username: data.tg_username,
    auth_date: Math.floor(Date.now() / 1000),
    groups: data.groups ?? [],
  });

  (await cookies()).set("dash_session", cookieValue, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return NextResponse.json({ ok: true });
}
