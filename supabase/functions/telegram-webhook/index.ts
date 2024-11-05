// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
    Bot,
    CallbackQueryContext,
    CommandContext,
    Context,
    InlineKeyboard,
    session,
    SessionFlavor,
} from "https://deno.land/x/grammy@v1.31.0/mod.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

console.log("Hello from telegram-webhook!");

const CMD_PAGO2 = "pago2";
const CMD_RP = "rp";
const CMD_PAGO = "pago";
const CMD_CP = "cp";
const VALID_CATEGORIES = ["E1", "E2", "M", "C", "B", "A", "OTHER"];

const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

interface Session {
    payment: {
        playerId: string | null;
        playerLastName: string | null;
        playerName: string | null;
        amount: number | null;
    };
}

type ContextWithSession = Context & SessionFlavor<Session>;

const bot = new Bot<ContextWithSession>((Deno.env.get("TELEGRAM_BOT_TOKEN"))!);

bot.use(session({
    getSessionKey: (ctx) => ctx.from?.id.toString(), // a session per user/bot combination
}));

bot.use(async (ctx, next) => {
    const sessionId = ctx.from!.id.toString();

    const { data, error } = await supabaseAdmin
        .from("grammy_sessions")
        .select()
        .eq("id", sessionId)
        .maybeSingle<{ session: string }>();
    if (!error) {
        ctx.session = data
            ? JSON.parse(data.session)
            : { payment: { playerId: null, amount: null } } as Session;
    }

    await next();

    const upsert = await supabaseAdmin
        .from("grammy_sessions")
        .upsert([{ id: sessionId, session: JSON.stringify(ctx.session) }]);
    if (upsert.error) {
        console.error(upsert.error);
    }
});

bot.command(
    "start",
    (ctx) => reply(ctx, "Welcome! Up and running."),
);

bot.command(
    CMD_RP,
    async (ctx) => {
        console.log(`Ejecutando comando ${CMD_RP}`);

        // text = /rp nombre,apellido,dni,categoria,alias
        const [
            name,
            last_name,
            dni,
            categoryAnyCase,
            maybeAlias,
            ...rest
        ] = ctx.match.split(",").map((_) => _.trim());

        if (rest && rest.length > 0) {
            console.warn(`There are many more parameters: ${rest}`);
        }

        const category = categoryAnyCase.toUpperCase();
        const alias = (maybeAlias && maybeAlias.length > 0)
            ? maybeAlias.toLowerCase()
            : name.toLowerCase() + dni.slice(-3);

        if (!VALID_CATEGORIES.includes(category)) {
            return reply(
                ctx,
                `Categoria ${category} invalida. Validas: ${VALID_CATEGORIES}`,
            );
        }

        const { data, error } = await supabaseAdmin
            .from("players")
            .insert([{
                name,
                last_name,
                dni,
                category,
                alias,
            }])
            .select().single();

        if (error) {
            console.error(error);
            return reply(ctx, "Error al registrar jugador");
        } else {
            return reply(ctx, "persona registrada! " + JSON.stringify(data));
        }
    },
);

bot.command(
    CMD_PAGO,
    async (ctx) => {
        console.log(`Ejecutando comando ${CMD_PAGO}`);

        // text = /pago id,monto,detalle?
        const [
            idInput,
            montoInput,
            detalle,
            ...rest
        ] = ctx.match.split(",").map((_) => _.trim());

        if (rest && rest.length > 0) {
            console.warn(`There are many more parameters: ${rest}`);
        }

        const id = idInput.toLowerCase();

        if (!(montoInput && montoInput.length > 0)) {
            const errorMsg = `Monto no ingresado.`;
            console.error(errorMsg);
            return reply(ctx, errorMsg);
        }

        let monto: number;
        let factor = 1;
        // Verifica si el último carácter es una 'k' (indicador de mil)
        if (montoInput.slice(-1).toLowerCase() === "k") {
            monto = parseFloat(montoInput.slice(0, -1));
            factor = 1000;
        } else {
            monto = parseFloat(montoInput);
        }
        // Verifica que el monto sea un número válido
        if (isNaN(monto)) {
            const errorMsg = `El monto ingresado (${montoInput}) es inválido.`;
            console.error(errorMsg);
            return reply(ctx, errorMsg);
        }
        monto = monto * factor;

        const concept = detalle ?? new Date().toISOString().substring(0, 7);
        const [maybeName, maybeLastName] = id.split(".");

        const { data: player_data, error: player_error } = await supabaseAdmin
            .from("players")
            .select("*")
            .or(`dni.eq.${id},alias.ilike.${id},nick.ilike.${id},and(name.ilike.${maybeName},last_name.ilike.${maybeLastName})`)
            .single();

        if (player_error) {
            console.error(
                "Player not found in DB " + JSON.stringify(player_error),
            );
            return reply(
                ctx,
                `Jugador con id ${id} no encontrado.`,
            );
        }

        const { data: paymentData, error } = await supabaseAdmin
            .from("payments")
            .insert([{
                player_id: player_data.id,
                amount: monto,
                concept,
            }])
            .select().single();

        if (error) {
            console.error(error);
            return reply(ctx, "Error al registrar el pago");
        } else {
            const jsonPayment = JSON.stringify(paymentData);
            return reply(ctx, `pago registrado! ${jsonPayment}`);
        }
    },
);

bot.command(
    CMD_CP,
    async (ctx) => {
        console.log(`Ejecutando comando ${CMD_CP}`);

        // text = /cp id
        const [
            idInput,
            ...rest
        ] = ctx.match.split(",").map((_) => _.trim());

        if (rest && rest.length > 0) {
            console.warn(`There are many more parameters: ${rest}`);
        }

        const id = idInput.toLowerCase();
        const [maybeName, maybeLastName] = id.split(".");

        const { data: playerData, error: player_error } = await supabaseAdmin
            .from("players")
            .select("*")
            .or(`dni.eq.${id},alias.ilike.${id},nick.ilike.${id},and(name.ilike.${maybeName},last_name.ilike.${maybeLastName})`)
            .single();

        if (player_error) {
            console.error(
                "Player not found in DB " + JSON.stringify(player_error),
            );
            return reply(
                ctx,
                `Jugador con id ${id} no encontrado.`,
            );
        }

        const { data: paymentsData, error: payments_error } =
            await supabaseAdmin
                .from("payments")
                .select("*")
                .eq("player_id", playerData.id);

        if (payments_error) {
            console.error(payments_error);
            return reply(ctx, "Error al levantar pagos");
        } else {
            // const payments = paymentsData.map(_ => _.monto).join(",");
            const jsonPlayer = JSON.stringify(playerData, null, 2);
            const jsonPayments = JSON.stringify(paymentsData, null, 2);
            return reply(
                ctx,
                `Devolviendo informacion de Player ${jsonPlayer} y sus payments: ${jsonPayments}`,
            );
        }
    },
);

bot.command(
    CMD_PAGO2,
    async (ctx) => {
        console.log(`Ejecutando comando ${CMD_PAGO2}`);

        const inlineKeyboard = new InlineKeyboard()
            .text("Escuela 1", "pago cat esc-1")
            .row().text("Escuela 2", "pago cat esc-2")
            .row().text("Menores", "pago cat u-14")
            .row().text("Cat C", "pago cat cat-c")
            .row().text("Cat B", "pago cat cat-b")
            .row().text("Cat A", "pago cat cat-a");

        return ctx.reply("Elija categoría", { reply_markup: inlineKeyboard });
    },
);

bot.callbackQuery(
    /pago cat (.*)$/,
    async (ctx) => {
        const category = ctx.match[1];
        console.log("Pago - categoria elegida: " + category);

        const { data, error } = await supabaseAdmin
            .from("players")
            .select<"*", Player>()
            .eq("category", category)
            .order("last_name, name");

        if (error) {
            console.error(error);
            return reply(ctx, "Error al buscar jugadores de categoria esc-1");
        }

        if (data.length == 0) {
            return ctx.editMessageText(
                `No hay jugadores para la categoria ${category}`,
                { reply_markup: new InlineKeyboard() },
            );
        }

        const name = (player: Player) => `${player.last_name}, ${player.name}`;
        const [head, ...tail] = data;
        const inlineKeyboard = tail.reduce(
            (kb, player) =>
                kb.row().text(name(player), `/pago jugador ${player.id}`),
            new InlineKeyboard().text(name(head)),
        );

        return ctx.editMessageText(`Elija jugador de la categoria ${category}`, {
            reply_markup: inlineKeyboard,
        });
    },
);

bot.callbackQuery(
    /pago jugador (.+)$/,
    async (ctx) => {
        console.log(ctx);
        const playerId = ctx.match[1];
        console.log(`Pago - jugador seleccionado ${playerId}`);
        const session = ctx.session.payment;
        ctx.session.payment.playerId = playerId;

        const { data } = await supabaseAdmin
            .from("players")
            .select()
            .eq("id", playerId)
            .single<Player>();
        if (data) {
            session.playerLastName = data.last_name;
            session.playerName = data.name;
        }

        const inlineKeyboard = new InlineKeyboard()
            .text("13.000", `pago monto 13`)
            .text("15.000", `pago monto 15`)
            .text("30.000", `pago monto 30`)
            .row()
            .text("45.000", `pago monto 45`)
            .text("60.000", `pago monto 60`)
            .text("otro", `pago monto otro`);

        const alias = session.playerLastName
            ? `${session.playerLastName}, ${session.playerName}`
            : "le jugadore";
        return ctx.editMessageText(
            `Elija el monto del pago a registrar para ${alias}`,
            {
                reply_markup: inlineKeyboard,
            },
        );
    },
);

bot.callbackQuery(
    /pago monto (\d+)$/,
    async (ctx) => {
        const amount = ctx.match[1];
        const session = ctx.session.payment;
        const alias = session.playerLastName
            ? `${session.playerLastName}, ${session.playerName}`
            : "le jugadore";
        console.log(`Pago - registrando pago de ${amount} para ${alias}`);

        session.amount = Number(amount) * 1000;

        return ctx.answerCallbackQuery();
    },
);

bot.callbackQuery(
    /pago monto otro/,
    async (ctx) => {
        const playerId = ctx.callbackQuery.data.split(" ", 2)[1];
        console.log(`requiriendo monto especial de pago para ${playerId}`);

        // await ctx.answerCallbackQuery("ASDF", {
        //     force_reply: true,
        // });
        return bot.api.sendMessage(
            ctx.chat!.id,
            "Escriba el monto para el jugador:",
            { reply_markup: { force_reply: true } },
        );
    },
);

bot.callbackQuery(
    /.*/,
    (ctx) => console.error(`Unmatched callback to ${ctx.callbackQuery.data}`),
);

bot.on(
    "message",
    (ctx) => {
        console.log(ctx);
        ctx.reply(`Unexpected message: ${ctx.msg.text}`)
    },
);

function reply(
    ctx: CommandContext<Context> | CallbackQueryContext<Context>,
    msg: string,
) {
    if ((ctx.update as any).test) {
        return;
    }
    return ctx.reply(msg);
}

type Player = {
    id: string;
    name: string;
    last_name: string;
};

bot.catch((err) => console.error(err));
bot.start();

// const app = new Application();
// app.use(webhookCallback(bot, "oak"));
// app.listen({ port: 8000 });

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:64321/functions/v1/telegram-webhook' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
