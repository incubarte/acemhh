// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Application } from "jsr:@oak/oak/application";
import { Router } from "jsr:@oak/oak/router";
import {
    Bot,
    CommandContext,
    Context,
    webhookCallback,
} from "https://deno.land/x/grammy@v1.31.0/mod.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

console.log("Hello from telegram-webhook!");

const CMD_REGISTRAR_PERSONA = "rp";
const CMD_REGISTRAR_PAGO = "pago";
const CMD_CONSULTAR_PERSONA = "cp";
const VALID_CATEGORIES = ["E1", "E2", "M", "C", "B", "A", "OTHER"];

const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const bot = new Bot((Deno.env.get("TELEGRAM_BOT_TOKEN"))!);

bot.command(
    "start",
    (ctx) => reply(ctx, "Welcome! Up and running."),
);
bot.command(
    CMD_REGISTRAR_PERSONA,
    async (ctx) => {
        console.log(`Ejecutando comando ${CMD_REGISTRAR_PERSONA}`);
        const text = ctx.msg.text;

        // text = /rp nombre,apellido,dni,categoria,alias
        const [
            name,
            last_name,
            dni,
            categoryAnyCase,
            maybeAlias,
            ...rest
        ] = text.trim()
            .substring(`/${CMD_REGISTRAR_PERSONA}`.length).trim()
            .split(",").map((_) => _.trim());

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
    CMD_REGISTRAR_PAGO,
    async (ctx) => {
        console.log(`Ejecutando comando ${CMD_REGISTRAR_PAGO}`);
        const text = ctx.msg.text;

        // text = /pago id,monto,detalle?
        const [
            idInput,
            montoInput,
            detalle,
            ...rest
        ] = text.trim()
            .substring(`/${CMD_REGISTRAR_PAGO}`.length).trim()
            .split(",").map((_) => _.trim());

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
            return reply(ctx, "pago registrado! " + JSON.stringify(paymentData));
        }
    },
);

bot.command(
    CMD_CONSULTAR_PERSONA,
    async (ctx) => {
        console.log(`Ejecutando comando ${CMD_CONSULTAR_PERSONA}`);
        const text = ctx.msg.text;

        // text = /cp id
        const [
            idInput,
            ...rest
        ] = text.trim()
            .substring(`/${CMD_CONSULTAR_PERSONA}`.length).trim()
            .split(",").map((_) => _.trim());

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

bot.on(
    "message",
    (ctx) => ctx.reply(`Unexpected message: ${ctx.msg.text}`),
);

function reply(ctx: CommandContext<Context>, msg: string) {
    if ((ctx.update as any).test) {
        return;
    }
    return ctx.reply(msg);
}

const app = new Application();
app.use(webhookCallback(bot, "oak"));
const router = new Router();
router.get("/", (ctx) => {
    ctx.response.body = "Hello world";
});
app.use(router.routes());
app.use(router.allowedMethods());
app.listen({ port: 8000 });

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:64321/functions/v1/telegram-webhook' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
