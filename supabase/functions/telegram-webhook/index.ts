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
        console.log("ZPQ");
        const text = ctx.msg.text;
        console.log(`Mensaje recibido: ${text}`);

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

        const category = categoryAnyCase.toUpperCase();
        const alias = (maybeAlias && maybeAlias.length > 0)
            ? maybeAlias.toLowerCase()
            : name.toLowerCase() + dni.slice(-3);

        if (rest) {
            console.error(`There are many more parameters: ${rest}`);
        }

        if (!VALID_CATEGORIES.includes(category)) {
            reply(
                ctx,
                `Categoria ${category} invalida. Validas: ${VALID_CATEGORIES}`,
            );
            return;
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
            reply(ctx, "Error al registrar jugador");
            throw new Error(error.message);
        } else {
            reply(ctx, "persona registrada! " + JSON.stringify(data));
            return new Response("todo fue bien: " + JSON.stringify(data));
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
    ctx.reply(msg);
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
