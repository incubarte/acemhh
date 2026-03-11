import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { verifySessionCookieValue } from "@/lib/telegramAuth";

export async function GET() {
  const v = (await cookies()).get("dash_session")?.value;
  if (!v) return new NextResponse("Unauthorized", { status: 401 });
  const sess = verifySessionCookieValue(v);
  if (!sess) return new NextResponse("Unauthorized", { status: 401 });
  return NextResponse.json(sess);
}
