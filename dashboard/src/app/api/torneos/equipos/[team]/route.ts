import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { withPermission } from "@/lib/authMiddleware";
import { todayBA } from "@/lib/trainingDay";
import { feeStanding, type FeeStanding, type Installment } from "@/lib/tournamentFees";
import { loadTeam, memberKey, paymentsByMember, paymentsForTeams, type TeamPaymentRow } from "@/lib/tournaments";

export type TeamPlayer = {
  id: string;
  name: string;
  last_name: string;
  role: "starter" | "substitute";
  standing: FeeStanding;
  payments: Omit<TeamPaymentRow, "player_id" | "team_id">[];
};

export type TeamDetail = {
  team: { id: string; name: string };
  tournament: { id: string; name: string; is_active: boolean };
  category: {
    id: string;
    name: string;
    upfront_price: number | null;
    installments: Installment[];
  };
  /** YYYY-MM, hoy en Buenos Aires. */
  today: string;
  players: TeamPlayer[];
};

// El equipo: sus jugadores, cómo viene cada uno con la cuota y sus pagos.
export const GET = withPermission('api', '/api/torneos/equipos', 'GET', async (_sess, req) => {
  try {
    const parts = new URL(req.url).pathname.split("/");
    const teamId = parts[parts.length - 1];
    const s = supabaseAdmin();

    const head = await loadTeam(s, teamId);
    if (!head) return new NextResponse("Equipo inexistente", { status: 404 });

    const [membersRes, payments] = await Promise.all([
      s.from("team_players")
        .select("player_id,role,players(id,name,last_name)")
        .eq("team_id", teamId),
      paymentsForTeams(s, [teamId]),
    ]);
    if (membersRes.error) return new NextResponse(membersRes.error.message, { status: 500 });

    const today = todayBA().slice(0, 7);
    const byMember = paymentsByMember(payments);

    type MemberRow = {
      player_id: string;
      role: string;
      players: { id: string; name: string; last_name: string } | { id: string; name: string; last_name: string }[] | null;
    };
    const players: TeamPlayer[] = (membersRes.data as unknown as MemberRow[] ?? [])
      .map((m) => {
        const p = Array.isArray(m.players) ? m.players[0] : m.players;
        const mine = byMember.get(memberKey(teamId, String(m.player_id))) ?? [];
        return {
          id: String(m.player_id),
          name: p?.name ?? "?",
          last_name: p?.last_name ?? "?",
          role: (m.role === "substitute" ? "substitute" : "starter") as TeamPlayer["role"],
          standing: feeStanding(head.category.installments, head.category.upfront_price, mine, today),
          payments: mine.map(({ id, amount, concept, is_cash, created_at, registered_by }) => ({
            id, amount, concept, is_cash, created_at, registered_by,
          })),
        };
      })
      // Titulares primero; dentro de cada grupo, por apellido.
      .sort((a, b) =>
        a.role === b.role
          ? `${a.last_name} ${a.name}`.localeCompare(`${b.last_name} ${b.name}`, "es")
          : a.role === "starter" ? -1 : 1
      );

    const detail: TeamDetail = { ...head, today, players };
    return NextResponse.json(detail);
  } catch (e) {
    console.error(e);
    return new NextResponse("Internal server error", { status: 500 });
  }
});
