// Lo que las rutas de torneos comparten: traer los pagos de un equipo y
// firmar quién registra. La aritmética está en tournamentFees.ts.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthSession } from "@/lib/authMiddleware";
import { TournamentConcepts, type TournamentConcept } from "@/lib/tournamentFees";

export type TeamPaymentRow = {
  id: string;
  player_id: string;
  team_id: string;
  amount: number;
  concept: TournamentConcept;
  is_cash: boolean;
  created_at: string;
  registered_by: string;
};

/** Los pagos de torneo de estos equipos, del más viejo al más nuevo. */
export async function paymentsForTeams(
  s: SupabaseClient,
  teamIds: string[],
): Promise<TeamPaymentRow[]> {
  if (teamIds.length === 0) return [];
  const { data, error } = await s
    .from("payments")
    .select("id,player_id,team_id,amount,concept,is_cash,created_at,registered_by")
    .in("team_id", teamIds)
    .in("concept", [...TournamentConcepts])
    .order("created_at");
  if (error) throw new Error("payments: " + error.message);
  return (data ?? []).map((p) => ({
    id: String(p.id),
    player_id: String(p.player_id),
    team_id: String(p.team_id),
    amount: Number(p.amount),
    concept: p.concept as TournamentConcept,
    is_cash: Boolean(p.is_cash),
    created_at: String(p.created_at),
    registered_by: String(p.registered_by),
  }));
}

export function memberKey(teamId: string, playerId: string): string {
  return `${teamId}|${playerId}`;
}

/** Los pagos agrupados por (equipo, jugador). */
export function paymentsByMember(rows: TeamPaymentRow[]): Map<string, TeamPaymentRow[]> {
  const out = new Map<string, TeamPaymentRow[]>();
  for (const p of rows) {
    const k = memberKey(p.team_id, p.player_id);
    const list = out.get(k);
    if (list) list.push(p);
    else out.set(k, [p]);
  }
  return out;
}

/** Los arqueros integran el equipo pero no pagan la cuota del torneo. Sale
 * del tipo de jugador, no de la lista: es lo que el club ya sabe de él. */
export function isFeeExempt(playerType: string | null | undefined): boolean {
  return playerType === "goalkeeper";
}

/**
 * Qué le corresponde pagar a un integrante: las cuotas del torneo
 * (`installments`), un pago suelto sin obligación (`substitute`), o nada
 * (`exempt`, los arqueros). El arquero manda sobre el rol.
 */
export type FeeKind = "installments" | "substitute" | "exempt";

export function feeKindOf(role: string, playerType: string | null | undefined): FeeKind {
  if (isFeeExempt(playerType)) return "exempt";
  return role === "substitute" ? "substitute" : "installments";
}

/** El mismo texto que firman los otros cobros. */
export function registeredBy(sess: AuthSession): string {
  const name = `${sess.first_name}${sess.last_name ? ` ${sess.last_name}` : ""}`.trim();
  const uname = sess.username ? ` (@${sess.username})` : "";
  return `${name}${uname} [id=${sess.id}]`.trim();
}

/** El equipo con su categoría y sus cuotas, o null si no existe. */
export async function loadTeam(s: SupabaseClient, teamId: string) {
  const { data: team, error } = await s
    .from("teams")
    .select("id,name,tournament_id,category_id")
    .eq("id", teamId)
    .maybeSingle();
  if (error) throw new Error("teams: " + error.message);
  if (!team) return null;

  const [tRes, cRes, iRes] = await Promise.all([
    s.from("tournaments").select("id,name,is_active").eq("id", team.tournament_id).single(),
    s.from("tournament_categories").select("id,name,upfront_price,substitute_price").eq("id", team.category_id).single(),
    s.from("tournament_installments").select("month,amount").eq("category_id", team.category_id).order("month"),
  ]);
  const firstError = tRes.error ?? cRes.error ?? iRes.error;
  if (firstError) throw new Error("team detail: " + firstError.message);
  const tournament = tRes.data;
  const category = cRes.data;
  if (!tournament || !category) throw new Error("team detail: equipo sin torneo o categoría");

  return {
    team: { id: String(team.id), name: String(team.name) },
    tournament: {
      id: String(tournament.id),
      name: String(tournament.name),
      is_active: Boolean(tournament.is_active),
    },
    category: {
      id: String(category.id),
      name: String(category.name),
      upfront_price: category.upfront_price === null ? null : Number(category.upfront_price),
      substitute_price: category.substitute_price === null ? null : Number(category.substitute_price),
      installments: (iRes.data ?? []).map((i) => ({
        month: String(i.month),
        amount: Number(i.amount),
      })),
    },
  };
}
