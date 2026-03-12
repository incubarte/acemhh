import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { withPermission } from "@/lib/authMiddleware";

export const GET = withPermission('api', '/api/players', 'GET', async (sess, req) => {
  try {
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

    const category = (searchParams.get("category") || "").trim();
    if (category) {
      const { data, error } = await supabaseAdmin()
        .from("players")
        .select("id,name,last_name")
        .eq("category", category)
        .order("last_name")
        .order("name");

      if (error) return new NextResponse(error.message, { status: 500 });
      return NextResponse.json({ players: data ?? [] });
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
});

export const POST = withPermission('api', '/api/players', 'POST', async (sess, req) => {
  try {

    const body = (await req.json()) as {
      name: string;
      last_name: string;
      dni?: string;
      fecha_nac?: string | null;
      category: string;
      invitee?: boolean;
    };

    if (!body?.name || !body?.last_name || !body?.category) {
      return new NextResponse("Missing fields", { status: 400 });
    }

    if (!body.invitee && !body.dni) {
      return new NextResponse("DNI is required for members", { status: 400 });
    }

    const s = supabaseAdmin();
    const { data, error } = await s
      .from("players")
      .insert([
        {
          name: body.name,
          last_name: body.last_name,
          dni: body.dni || null,
          fecha_nac: body.fecha_nac ?? null,
          category: body.category,
          invitee: body.invitee || false,
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
});
