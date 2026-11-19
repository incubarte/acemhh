import { NextResponse } from "next/server";
import { getSession } from "@/lib/authMiddleware";

export async function GET() {
  const sess = await getSession();
  if (!sess) return new NextResponse("Unauthorized", { status: 401 });
  return NextResponse.json(sess);
}
