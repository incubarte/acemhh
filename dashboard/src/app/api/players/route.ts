import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { withPermission } from "@/lib/authMiddleware";
import { isValidWhatsappPhone, normalizeWhatsappPhone } from "@/lib/phone";
import {
  DuplicateConfirmationPhrase,
  looksLikeSamePerson,
  matchesConfirmationPhrase,
} from "@/lib/playerNames";

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
    const playerType = (searchParams.get("player_type") || "").trim();
    if (category) {
      let q = supabaseAdmin()
        .from("players")
        .select("id,name,last_name")
        .contains("categories", [category]);
      if (playerType) q = q.eq("player_type", playerType);
      const { data, error } = await q
        .order("last_name")
        .order("name");

      if (error) return new NextResponse(error.message, { status: 500 });
      return NextResponse.json({ players: data ?? [] });
    }

    const query = (searchParams.get("query") || "").trim();
    if (query.length < 2) return NextResponse.json({ players: [] });

    const s = supabaseAdmin();
    const like = `%${query}%`;
    let search = s
      .from("players")
      .select("id,name,last_name")
      .or(`name.ilike.${like},last_name.ilike.${like}`);
    // The attendance screen searches each kind from its own section, so a
    // goalkeeper never turns up under "Buscar jugador" and the other way round.
    if (playerType) search = search.eq("player_type", playerType);
    const { data, error } = await search
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
      categories: string[];
      invitee?: boolean;
      player_type: 'player' | 'goalkeeper';
      /** 1 = first or only sibling; 2, 3, 4 get the prepaid sibling discount. */
      sibling_rank?: number | null;
      phone?: string | null;
      guardian_phone?: string | null;
      emergency_contact_name?: string | null;
      emergency_contact_phone?: string | null;
      duplicate_confirmation?: string | null;
    };

    // Trim before validating, so a field of only spaces counts as missing rather
    // than reaching the table and breaking name lookups later.
    const name = (body?.name ?? "").trim();
    const lastName = (body?.last_name ?? "").trim();
    const dni = (body?.dni ?? "").trim();

    // Ordered by priority: the first category is the player's main one.
    const categories = Array.isArray(body?.categories)
      ? [...new Set(body.categories.map((c) => (c ?? "").trim()).filter(Boolean))]
      : [];

    if (!name || !lastName || categories.length === 0) {
      return new NextResponse("Missing fields", { status: 400 });
    }

    if (!body.invitee && !dni) {
      return new NextResponse("DNI is required for members", { status: 400 });
    }

    // Both phones are optional, but a number that was supplied and does not
    // normalize must be rejected rather than silently stored as null.
    const phone = normalizeWhatsappPhone(body.phone);
    if ((body.phone ?? "").trim() && (!phone || !isValidWhatsappPhone(phone))) {
      return new NextResponse("Celular inválido", { status: 400 });
    }

    const guardianPhone = normalizeWhatsappPhone(body.guardian_phone);
    if ((body.guardian_phone ?? "").trim() && (!guardianPhone || !isValidWhatsappPhone(guardianPhone))) {
      return new NextResponse("Celular de madre/padre/tutor inválido", { status: 400 });
    }

    const emergencyPhone = normalizeWhatsappPhone(body.emergency_contact_phone);
    if ((body.emergency_contact_phone ?? "").trim() && (!emergencyPhone || !isValidWhatsappPhone(emergencyPhone))) {
      return new NextResponse("Celular del contacto de emergencia inválido", { status: 400 });
    }

    const emergencyName = (body.emergency_contact_name ?? "").trim() || null;

    // A guest pays no month, so there is nothing for the discount to touch.
    const siblingRank = body.invitee ? 1 : Number(body.sibling_rank) || 1;
    if (!Number.isInteger(siblingRank) || siblingRank < 1 || siblingRank > 4) {
      return new NextResponse("Orden de hermano inválido", { status: 400 });
    }

    const s = supabaseAdmin();

    // Guard against the same person being registered twice under a slightly
    // different spelling. Loading the whole roster is fine at this size and keeps the
    // comparison identical to scripts/find-duplicate-players.ts, which a SQL query
    // could not reproduce.
    if (!matchesConfirmationPhrase(body.duplicate_confirmation)) {
      const { data: roster, error: rosterError } = await s
        .from("players")
        .select("id,name,last_name,dni,categories,invitee");

      if (rosterError) return new NextResponse(rosterError.message, { status: 500 });

      const duplicates = (roster ?? []).filter((p) =>
        looksLikeSamePerson({ name, last_name: lastName }, p)
      );

      if (duplicates.length > 0) {
        return NextResponse.json(
          { duplicates, confirmationPhrase: DuplicateConfirmationPhrase },
          { status: 409 },
        );
      }
    }

    const { data, error } = await s
      .from("players")
      .insert([
        {
          name,
          last_name: lastName,
          dni: dni || null,
          fecha_nac: body.fecha_nac ?? null,
          categories,
          invitee: body.invitee || false,
          player_type: body.player_type,
          trains: !body.invitee,
          sibling_rank: siblingRank,
          phone,
          guardian_phone: guardianPhone,
          emergency_contact_name: emergencyName,
          emergency_contact_phone: emergencyPhone,
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
