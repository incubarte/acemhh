import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const query = (searchParams.get("query") || "").trim();
    if (query.length < 2) return NextResponse.json({ players: [] });

    const s = supabaseAdmin();
    const like = `%${query}%`;
    const { data, error } = await s
      .from("players")
      .select("id,name,last_name")
      .eq("invitee", false)
      .or(`name.ilike.${like},last_name.ilike.${like}`)
      .order("last_name")
      .order("name")
      .limit(20);

    if (error) {
      console.error("/api/credencial/search GET supabase error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ players: data ?? [] });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("/api/credencial/search GET failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
