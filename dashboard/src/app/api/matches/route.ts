import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { withPermission } from "@/lib/authMiddleware";

export type MatchSide = {
  /** El equipo del club; null para el rival, que va por nombre. */
  team_id: string | null;
  name: string;
};

export type AgendaMatch = {
  id: string;
  code: string;
  /** YYYY-MM-DD y HH:MM, de Buenos Aires. */
  played_on: string;
  starts_at: string;
  category: string;
  home: MatchSide;
  away: MatchSide;
  /** Lo ya registrado como pago de este partido, por equipo del club. */
  paid: Record<string, number>;
};

// La agenda de los torneos activos, para elegir a qué partido va un pago.
export const GET = withPermission('api', '/api/matches', 'GET', async () => {
  const s = supabaseAdmin();

  const { data: matches, error } = await s
    .from("matches")
    .select(
      "id,code,played_on,starts_at,home_team_id,home_name,away_team_id,away_name," +
        "tournaments!inner(is_active),tournament_categories(name)",
    )
    .eq("tournaments.is_active", true)
    .order("played_on")
    .order("starts_at");
  if (error) return new NextResponse(error.message, { status: 500 });

  type Row = {
    id: string;
    code: string;
    played_on: string;
    starts_at: string;
    home_team_id: string | null;
    home_name: string | null;
    away_team_id: string | null;
    away_name: string | null;
    tournament_categories: { name: string } | null;
  };
  const rows = (matches ?? []) as unknown as Row[];
  const ids = rows.map((m) => m.id);

  const [teamsRes, paidRes] = await Promise.all([
    s.from("teams").select("id,name"),
    ids.length
      ? s.from("expenses").select("match_id,team_id,amount").in("match_id", ids)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const firstError = teamsRes.error ?? paidRes.error;
  if (firstError) return new NextResponse(firstError.message, { status: 500 });

  const teamName = new Map((teamsRes.data ?? []).map((t) => [String(t.id), String(t.name)]));
  const paid = new Map<string, Record<string, number>>();
  for (const e of paidRes.data ?? []) {
    const byTeam = paid.get(String(e.match_id)) ?? {};
    byTeam[String(e.team_id)] = (byTeam[String(e.team_id)] ?? 0) + Number(e.amount);
    paid.set(String(e.match_id), byTeam);
  }

  const side = (teamId: string | null, name: string | null): MatchSide => ({
    team_id: teamId,
    name: teamId ? teamName.get(teamId) ?? "?" : name ?? "?",
  });

  const out: AgendaMatch[] = rows.map((m) => ({
    id: m.id,
    code: m.code,
    played_on: m.played_on,
    starts_at: m.starts_at.slice(0, 5),
    category: m.tournament_categories?.name ?? "",
    home: side(m.home_team_id, m.home_name),
    away: side(m.away_team_id, m.away_name),
    paid: paid.get(m.id) ?? {},
  }));
  return NextResponse.json({ matches: out });
});
