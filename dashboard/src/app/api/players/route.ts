import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { verifySessionCookieValue } from "@/lib/telegramAuth";

function requireAuth() {
  const v = cookies().get("dash_session")?.value;
  if (!v) return null;
  return verifySessionCookieValue(v);
}

export async function GET(req: Request) {
  try {
    const sess = requireAuth();
    if (!sess) return new NextResponse("Unauthorized", { status: 401 });

    const { searchParams } = new URL(req.url);
    const id = (searchParams.get("id") || "").trim();
    if (id) {
      const s = supabaseAdmin();
      const { data, error } = await s
        .from("players")
        .select("id,name,last_name")
        .eq("id", id)
        .maybeSingle();

      if (error) return new NextResponse(error.message, { status: 500 });
      return NextResponse.json({ player: data ?? null });
    }

    const query = (searchParams.get("query") || "").trim();
    if (query.length < 2) return NextResponse.json({ players: [] });

    const s = supabaseAdmin();
    const like = `%${query}%`;
    const { data, error } = await s
      .from("players")
      .select("id,name,last_name")
      .or(`name.ilike.${like},last_name.ilike.${like}`)
      .order("last_name")
      .order("name")
      .limit(20);

    if (error) return new NextResponse(error.message, { status: 500 });
    return NextResponse.json({ players: data ?? [] });
  } catch (e: unknown) {
    console.error("/api/players GET failed", e);
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : null;
    const body =
      process.env.NODE_ENV === "production" || !stack ? msg : `${msg}\n\n${stack}`;
    return new NextResponse(body, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const sess = requireAuth();
    if (!sess) return new NextResponse("Unauthorized", { status: 401 });

    const body = (await req.json()) as {
      name: string;
      last_name: string;
      dni: string;
      fecha_nac?: string | null;
      category: string;
    };

    if (!body?.name || !body?.last_name || !body?.dni || !body?.category) {
      return new NextResponse("Missing fields", { status: 400 });
    }

    const s = supabaseAdmin();
    const { data, error } = await s
      .from("players")
      .insert([
        {
          name: body.name,
          last_name: body.last_name,
          dni: body.dni,
          fecha_nac: body.fecha_nac ?? null,
          category: body.category,
        },
      ])
      .select("id")
      .single();

    if (error) return new NextResponse(error.message, { status: 500 });
    return NextResponse.json({ player: data });
  } catch (e: unknown) {
    console.error("/api/players POST failed", e);
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : null;
    const body =
      process.env.NODE_ENV === "production" || !stack ? msg : `${msg}\n\n${stack}`;
    return new NextResponse(body, { status: 500 });
  }
}
