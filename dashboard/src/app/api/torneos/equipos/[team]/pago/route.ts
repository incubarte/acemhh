import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { withPermission } from "@/lib/authMiddleware";
import { todayBA } from "@/lib/trainingDay";
import { feeStanding, TournamentConcepts, type TournamentConcept } from "@/lib/tournamentFees";
import { feeKindOf, loadTeam, paymentsForTeams, registeredBy } from "@/lib/tournaments";

// Registrar un pago de la cuota del torneo para un jugador del equipo.
//
// El monto es libre: puede pagar menos o más que una cuota, y la pantalla
// muestra hasta dónde llegó. Lo único que el servicio no deja pasar es el
// torneo anticipado fuera de su regla — es plata, así que la regla vive acá y
// no sólo en el botón.
export const POST = withPermission('api', '/api/torneos/pago', 'POST', async (sess, req) => {
  try {
    const parts = new URL(req.url).pathname.split("/");
    const teamId = parts[parts.length - 2];

    const body = await req.json() as {
      player_id?: string;
      amount?: number;
      concept?: TournamentConcept;
      is_cash?: boolean;
    };
    if (!body?.player_id || body?.amount === undefined) {
      return new NextResponse("Missing fields", { status: 400 });
    }
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return new NextResponse("Invalid amount", { status: 400 });
    }
    const concept: TournamentConcept = body.concept ?? "tournament";
    if (!(TournamentConcepts as readonly string[]).includes(concept)) {
      return new NextResponse("Concepto inválido", { status: 400 });
    }
    const isCash = body.is_cash ?? true;

    const s = supabaseAdmin();
    const head = await loadTeam(s, teamId);
    if (!head) return new NextResponse("Equipo inexistente", { status: 404 });
    if (!head.tournament.is_active) {
      return new NextResponse("El torneo ya no está activo", { status: 409 });
    }

    const { data: member, error: memberError } = await s
      .from("team_players")
      .select("player_id,role,players(player_type)")
      .eq("team_id", teamId)
      .eq("player_id", body.player_id)
      .maybeSingle();
    if (memberError) return new NextResponse(memberError.message, { status: 500 });
    if (!member) return new NextResponse("El jugador no integra este equipo", { status: 400 });
    const memberPlayer = Array.isArray(member.players) ? member.players[0] : member.players;
    const fee = feeKindOf(String(member.role), (memberPlayer as { player_type?: string } | null)?.player_type);
    if (fee === "exempt") {
      return new NextResponse("Los arqueros no pagan la cuota del torneo", { status: 409 });
    }
    // El suplente paga suelto, sin cuotas: no hay torneo entero que anticipar.
    if (fee === "substitute" && concept === "tournament upfront") {
      return new NextResponse("Los suplentes no tienen cuota: se les registra un pago suelto", { status: 409 });
    }

    const today = todayBA().slice(0, 7);

    if (concept === "tournament upfront") {
      const mine = (await paymentsForTeams(s, [teamId]))
        .filter((p) => p.player_id === body.player_id);
      const standing = feeStanding(
        head.category.installments,
        head.category.upfront_price,
        mine,
        today,
      );
      if (head.category.upfront_price === null) {
        return new NextResponse("Esta categoría no tiene precio anticipado", { status: 409 });
      }
      if (!standing.upfrontAvailable) {
        return new NextResponse(
          mine.length > 0
            ? "El torneo anticipado es sólo para quien no pagó nada todavía"
            : "El torneo anticipado se paga antes de que venza la primera cuota",
          { status: 409 },
        );
      }
      if (amount < head.category.upfront_price) {
        return new NextResponse(
          "El torneo anticipado es el total con descuento, no admite pagos parciales",
          { status: 409 },
        );
      }
    }

    const paymentId = crypto.randomUUID();
    const { error } = await s.from("payments").insert([{
      id: paymentId,
      player_id: body.player_id,
      team_id: teamId,
      registered_by: registeredBy(sess),
      registered_by_user_id: sess.id,
      concept,
      // El mes no dice a qué cuota va — eso lo decide el orden —, sólo cuándo
      // se cobró. La columna es obligatoria para todos los conceptos.
      month: today,
      amount,
      is_cash: isCash,
    }]);
    if (error) {
      console.error(error);
      return new NextResponse("Error registering payment", { status: 500 });
    }

    return NextResponse.json({ ok: true, payment_id: paymentId });
  } catch (e) {
    console.error(e);
    return new NextResponse("Internal server error", { status: 500 });
  }
});
