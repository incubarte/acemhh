import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { withPermission } from "@/lib/authMiddleware";
import { todayBA } from "@/lib/trainingDay";
import { feeStanding, type Installment } from "@/lib/tournamentFees";
import { isFeeExempt, memberKey, paymentsByMember, paymentsForTeams } from "@/lib/tournaments";

export type TeamSummary = {
  id: string;
  name: string;
  players: number;
  starters: number;
  substitutes: number;
  /** Arqueros: integran el equipo pero no pagan la cuota. */
  exempt: number;
  /** Cuántos de los que pagan no deben nada de lo ya vencido. */
  upToDate: number;
  /** Lo cobrado entre todos, y lo que entre todos deberían llevar pagado. */
  collected: number;
  dueSoFar: number;
};

export type CategorySummary = {
  id: string;
  name: string;
  teams: TeamSummary[];
};

export type TournamentSummary = {
  id: string;
  name: string;
  categories: CategorySummary[];
};

// Los torneos activos, con sus equipos y cómo viene cada uno con la cuota.
export const GET = withPermission('api', '/api/torneos', 'GET', async () => {
  const s = supabaseAdmin();
  const today = todayBA().slice(0, 7);

  const { data: tournaments, error: tError } = await s
    .from("tournaments")
    .select("id,name")
    .eq("is_active", true)
    .order("created_at");
  if (tError) return new NextResponse(tError.message, { status: 500 });
  const tIds = (tournaments ?? []).map((t) => String(t.id));
  if (tIds.length === 0) return NextResponse.json({ tournaments: [], today });

  const [catsRes, teamsRes] = await Promise.all([
    s.from("tournament_categories")
      .select("id,tournament_id,name,position,upfront_price")
      .in("tournament_id", tIds)
      .order("position"),
    s.from("teams")
      .select("id,tournament_id,category_id,name")
      .in("tournament_id", tIds)
      .order("name"),
  ]);
  const firstError = catsRes.error ?? teamsRes.error;
  if (firstError) return new NextResponse(firstError.message, { status: 500 });

  const cats = catsRes.data ?? [];
  const teams = teamsRes.data ?? [];
  const catIds = cats.map((c) => String(c.id));
  const teamIds = teams.map((t) => String(t.id));

  const [instRes, membersRes, payments] = await Promise.all([
    catIds.length
      ? s.from("tournament_installments").select("category_id,month,amount").in("category_id", catIds)
      : Promise.resolve({ data: [], error: null }),
    teamIds.length
      ? s.from("team_players").select("team_id,player_id,role,players(player_type)").in("team_id", teamIds)
      : Promise.resolve({ data: [], error: null }),
    paymentsForTeams(s, teamIds),
  ]);
  const secondError = instRes.error ?? membersRes.error;
  if (secondError) return new NextResponse(secondError.message, { status: 500 });

  const installmentsByCat = new Map<string, Installment[]>();
  for (const i of instRes.data ?? []) {
    const k = String(i.category_id);
    const list = installmentsByCat.get(k) ?? [];
    list.push({ month: String(i.month), amount: Number(i.amount) });
    installmentsByCat.set(k, list);
  }
  const upfrontByCat = new Map(cats.map((c) => [
    String(c.id),
    c.upfront_price === null ? null : Number(c.upfront_price),
  ]));

  type MemberRow = {
    team_id: string;
    player_id: string;
    role: string;
    players: { player_type: string } | { player_type: string }[] | null;
  };
  const membersByTeam = new Map<string, { player_id: string; role: string; exempt: boolean }[]>();
  for (const m of (membersRes.data as unknown as MemberRow[]) ?? []) {
    const k = String(m.team_id);
    const list = membersByTeam.get(k) ?? [];
    const p = Array.isArray(m.players) ? m.players[0] : m.players;
    list.push({
      player_id: String(m.player_id),
      role: String(m.role),
      exempt: isFeeExempt(p?.player_type),
    });
    membersByTeam.set(k, list);
  }
  const byMember = paymentsByMember(payments);

  const summaries = new Map<string, TeamSummary>();
  for (const t of teams) {
    const teamId = String(t.id);
    const catId = String(t.category_id);
    const installments = installmentsByCat.get(catId) ?? [];
    const upfront = upfrontByCat.get(catId) ?? null;
    const members = membersByTeam.get(teamId) ?? [];
    const summary: TeamSummary = {
      id: teamId,
      name: String(t.name),
      players: members.length,
      starters: members.filter((m) => m.role === "starter").length,
      substitutes: members.filter((m) => m.role === "substitute").length,
      exempt: members.filter((m) => m.exempt).length,
      upToDate: 0,
      collected: 0,
      dueSoFar: 0,
    };
    for (const m of members) {
      if (m.exempt) continue;
      const standing = feeStanding(
        installments,
        upfront,
        byMember.get(memberKey(teamId, m.player_id)) ?? [],
        today,
      );
      if (standing.outstandingNow === 0) summary.upToDate += 1;
      summary.collected += standing.paid;
      summary.dueSoFar += standing.dueSoFar;
    }
    summaries.set(teamId, summary);
  }

  const out: TournamentSummary[] = (tournaments ?? []).map((t) => ({
    id: String(t.id),
    name: String(t.name),
    categories: cats
      .filter((c) => String(c.tournament_id) === String(t.id))
      .map((c) => ({
        id: String(c.id),
        name: String(c.name),
        teams: teams
          .filter((tm) => String(tm.category_id) === String(c.id))
          .map((tm) => summaries.get(String(tm.id))!),
      })),
  }));

  return NextResponse.json({ tournaments: out, today });
});
