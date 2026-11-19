import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { withPermission } from "@/lib/authMiddleware";
import { EXPENSE_CONCEPTS } from "@/lib/expenses";
import { cleanNotes, duplicateResponse, recentDuplicate } from "@/lib/moneyWrites";

export const POST = withPermission('api', '/api/expenses', 'POST', async (sess, req) => {
  const body = (await req.json()) as {
    amount: number;
    concept: string;
    notes?: string | null;
    is_cash?: boolean;
    match_id?: string | null;
    team_id?: string | null;
    confirm_duplicate?: boolean;
  };

  const amount = Number(body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return new NextResponse("Invalid amount", { status: 400 });
  }

  const concept = (body?.concept ?? "").trim();
  if (!(EXPENSE_CONCEPTS as readonly string[]).includes(concept)) {
    return new NextResponse("Invalid concept", { status: 400 });
  }

  const notes = cleanNotes(body?.notes);
  if (concept === "otros" && !notes) {
    return new NextResponse("Las notas son obligatorias para el concepto 'otros'", { status: 400 });
  }

  const s = supabaseAdmin();

  // Un partido apunta al partido de la agenda, de un torneo en curso, y al
  // equipo del club que lo paga: uno de los que juegan. Ningún otro concepto
  // lleva partido. Puede ser uno que todavía no se jugó: a veces la pista se
  // paga por adelantado.
  const isMatch = concept === "partidos";
  const matchId = isMatch ? (body?.match_id ?? "").trim() : null;
  const teamId = isMatch ? (body?.team_id ?? "").trim() : null;
  if (isMatch) {
    if (!matchId) return new NextResponse("Elegí a qué partido va el pago", { status: 400 });
    const { data: match, error: matchError } = await s
      .from("matches")
      .select("id,home_team_id,away_team_id,tournaments!inner(is_active)")
      .eq("id", matchId)
      .eq("tournaments.is_active", true)
      .maybeSingle();
    if (matchError) return new NextResponse(matchError.message, { status: 500 });
    if (!match) return new NextResponse("Ese partido no está en un torneo en curso", { status: 400 });
    const ours = [match.home_team_id, match.away_team_id].filter(Boolean).map(String);
    if (!teamId || !ours.includes(teamId)) {
      return new NextResponse("Elegí cuál de los equipos del club paga el partido", { status: 400 });
    }
  } else if (body?.match_id || body?.team_id) {
    return new NextResponse("Sólo un pago de partido lleva partido", { status: 400 });
  }

  if (!body.confirm_duplicate && await recentDuplicate(s, "expenses", {
    paid_by: sess.id,
    concept,
    amount,
    // Dos equipos del club que juegan entre sí pagan lo mismo a la vez, y no
    // es un duplicado.
    match_id: matchId,
    team_id: teamId,
  })) {
    return duplicateResponse("un egreso");
  }

  const { data, error } = await s
    .from("expenses")
    .insert([{
      amount,
      concept,
      notes,
      match_id: matchId,
      team_id: teamId,
      paid_by: sess.id,
      is_cash: body?.is_cash ?? true,
    }])
    .select("id")
    .single();

  if (error) return new NextResponse(error.message, { status: 500 });
  return NextResponse.json({ expense: data });
});
