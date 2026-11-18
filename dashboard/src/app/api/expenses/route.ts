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

  // Un partido nombra al equipo que jugó, de un torneo en curso; ningún otro
  // concepto lleva equipo.
  const teamId = concept === "partidos" ? (body?.team_id ?? "").trim() : null;
  if (concept === "partidos") {
    if (!teamId) return new NextResponse("Elegí qué equipo jugó el partido", { status: 400 });
    const { data: team, error: teamError } = await s
      .from("teams")
      .select("id,tournaments!inner(is_active)")
      .eq("id", teamId)
      .eq("tournaments.is_active", true)
      .maybeSingle();
    if (teamError) return new NextResponse(teamError.message, { status: 500 });
    if (!team) return new NextResponse("Ese equipo no está en un torneo en curso", { status: 400 });
  } else if (body?.team_id) {
    return new NextResponse("Sólo un partido lleva equipo", { status: 400 });
  }

  if (!body.confirm_duplicate && await recentDuplicate(s, "expenses", {
    paid_by: sess.id,
    concept,
    amount,
    // Dos equipos del club que juegan entre sí pagan lo mismo a la vez, y no
    // es un duplicado.
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
      team_id: teamId,
      paid_by: sess.id,
      is_cash: body?.is_cash ?? true,
    }])
    .select("id")
    .single();

  if (error) return new NextResponse(error.message, { status: 500 });
  return NextResponse.json({ expense: data });
});
