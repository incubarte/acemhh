// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Application } from "jsr:@oak/oak/application";
import {
    Bot,
    CallbackQueryContext,
    CommandContext,
    Context,
    InlineKeyboard,
    webhookCallback
} from "https://deno.land/x/grammy@v1.31.0/mod.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
    CallbackQuery,
    InlineKeyboardButton,
} from "https://deno.land/x/grammy_types@v3.15.0/markup.ts";

console.log("Hello from telegram-webhook!");

const DryRun = true;

const CMD_PAGO = "pago";
const CMD_PAGO_VIEJO = "pagoviejo";
const CMD_RP = "rp";
const CMD_CP = "cp";
const VALID_CATEGORIES = ["E1", "E2", "M", "C", "B", "A", "OTHER"];

const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const MsgConfirm = "*Confirmar?*";
const ConfirmInlineButtons = new InlineKeyboard()
    .text("Si", "pago confirmar")
    .text("Cancelar", "pago cancelar");

const bot = new Bot((Deno.env.get("TELEGRAM_BOT_TOKEN"))!);

bot.command(
    "start",
    (ctx) => reply(ctx, "Welcome! Up and running."),
);

bot.command(
    CMD_RP,
    async (ctx) => {
        console.log(`Ejecutando comando ${CMD_RP}`);

        // text = /rp nombre,apellido,dni,categoria,alias
        const tokens = ctx.match.split(",");
        if (tokens.length < 4) {
            return ctx.reply("Uso: /rp nombre,apellido,dni,categoria,alias");
        }

        const [
            name,
            last_name,
            dni,
            categoryAnyCase,
            maybeAlias,
            ...rest
        ] = tokens.map((_) => _.trim());

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
    CMD_PAGO_VIEJO,
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

        // Verifica si el último carácter es una 'k' (indicador de mil)
        const monto = parseAmount(montoInput);
        // Verifica que el monto sea un número válido
        if (isNaN(monto)) {
            const errorMsg = `El monto ingresado (${montoInput}) es inválido.`;
            console.error(errorMsg);
            return reply(ctx, errorMsg);
        }

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
    CMD_PAGO,
    (ctx) => {
        console.log(`Ejecutando comando ${CMD_PAGO}`);

        const inlineKeyboard = new InlineKeyboard()
            .text("Escuela 1", "pago cat esc-1")
            .row().text("Escuela 2", "pago cat esc-2")
            .row().text("Menores", "pago cat u-14")
            .row().text("Cat C", "pago cat cat-c")
            .row().text("Cat B", "pago cat cat-b")
            .row().text("Cat A", "pago cat cat-a");

        return ctx.reply(
            msgWithHeader("_Elegir categoria:_"),
            { reply_markup: inlineKeyboard, parse_mode: "MarkdownV2" },
        );
    },
);

bot.callbackQuery(
    /pago cat (.*)$/,
    async (ctx) => {
        const cat = ctx.match[1];
        console.log("Pago - categoria elegida: " + cat);

        const { data, error } = await supabaseAdmin
            .from("players")
            .select<"*", Player>()
            .eq("category", cat)
            .order("last_name, name");

        if (error) {
            console.error(error);
            return reply(ctx, "Error al buscar jugadores de categoria esc-1");
        }

        if (data.length == 0) {
            return ctx.editMessageText(
                `No hay jugadores para la categoria ${cat}`,
                { reply_markup: new InlineKeyboard() },
            );
        }

        const name = (player: Player) => `${player.last_name}, ${player.name}`;
        const [head, ...tail] = data;
        const inlineKeyboard = tail.reduce(
            (kb, player) =>
                kb.row().text(
                    name(player),
                    `pago jugador ${player.id}`,
                ),
            new InlineKeyboard().text(name(head), `pago jugador ${head.id}`),
        );

        return ctx.editMessageText(
            msgWithHeader("_Elegir jugador:_", { cat }),
            {
                reply_markup: inlineKeyboard,
                parse_mode: "MarkdownV2",
            },
        );
    },
);

bot.callbackQuery(
    /pago jugador (.+)$/,
    (ctx) => {
        const playerId = ctx.match[1];
        console.log(`Pago - jugador seleccionado ${playerId}`);

        const header = parseHeader(ctx.callbackQuery.message!.text!);
        const [last_name, name] = findInlineKeyboardButton(
            ctx.callbackQuery,
            (_) => _.callback_data.endsWith(playerId),
        )!.text.split(", ");

        const inlineKeyboard = new InlineKeyboard()
            .text("13.000", `pago monto 13000`)
            .text("15.000", `pago monto 15000`)
            .text("30.000", `pago monto 30000`)
            .row()
            .text("45.000", `pago monto 45000`)
            .text("60.000", `pago monto 60000`)
            .text("otro", `pago monto otro`);
        return ctx.editMessageText(
            msgWithHeader("_Elegir monto:_", {
                ...header,
                last_name,
                name,
                id: playerId,
            }),
            {
                reply_markup: inlineKeyboard,
                parse_mode: "MarkdownV2",
            },
        );
    },
);

bot.callbackQuery(
    /pago monto (\d+)$/,
    (ctx) => {
        const amount = Number(ctx.match[1]);
        console.log(`Pago - registrando pago por $${amount}`);

        const header = parseHeader(ctx.callbackQuery.message!.text!);

        return ctx.editMessageText(
            msgWithHeader(MsgConfirm, { ...header, amount }),
            {
                reply_markup: ConfirmInlineButtons,
                parse_mode: "MarkdownV2",
            },
        );
    },
);

bot.callbackQuery(
    "pago confirmar",
    async (ctx) => {
        console.log(`Pago - confirmacion`);

        const header = parseHeader(ctx.callbackQuery.message!.text!);

        if (DryRun) {
            return ctx.editMessageText(
                msgWithHeader(
                    "*Operacion finalizada con exito\\!*\nID de pago: dummy\\-payment\\-id",
                ),
                {
                    reply_markup: new InlineKeyboard(),
                    parse_mode: "MarkdownV2",
                },
            );
        }

        const { data, error } = await supabaseAdmin
            .from("payments")
            .insert([{
                player_id: header.id,
                amount: header.amount!,
                concept: new Date().toISOString().substring(0, 7),
            }])
            .select().single<Payment>();

        if (error) {
            console.log(error);
        }

        const msg = error
            ? `*Operacion finalzada con errores*\n${error.message}`
            : `*Operacion finalizada con exito\\!*\nID de pago: ${data.id}`;
        return ctx.editMessageText(
            msgWithHeader(msg),
            {
                reply_markup: new InlineKeyboard(),
                parse_mode: "MarkdownV2",
            },
        );
    },
);

bot.callbackQuery(
    "pago cancelar",
    // deno-lint-ignore require-await
    async (ctx) => {
        console.log(`Pago - cancelacion`);

        const header = parseHeader(ctx.callbackQuery.message!.text!);

        return ctx.editMessageText(
            msgWithHeader("*OPERACION CANCELADA*", header),
            {
                reply_markup: new InlineKeyboard(),
                parse_mode: "MarkdownV2",
            },
        );
    },
);

bot.callbackQuery(
    /pago monto otro/,
    async (ctx) => {
        console.log(`Pago - pidiendo monto arbitrario`);

        const header = parseHeader(ctx.callbackQuery.message!.text!);

        await ctx.editMessageText(
            msgWithHeader("Continuando operacion debajo\\.\\.\\.", header),
            {
                reply_markup: new InlineKeyboard(),
                parse_mode: "MarkdownV2",
            },
        );
        return bot.api.sendMessage(
            ctx.chat!.id,
            msgWithHeader("_Escriba monto:_", header),
            {
                reply_markup: { force_reply: true },
                parse_mode: "MarkdownV2",
            },
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
        const repliedText = ctx.update.message?.reply_to_message?.text;
        if (repliedText) {
            const header = parseHeader(repliedText);
            if (header.cat && header.id) {
                const amount = Number(ctx.message.text);
                return ctx.reply(
                    msgWithHeader(MsgConfirm, { ...header, amount }),
                    {
                        reply_markup: ConfirmInlineButtons,
                        parse_mode: "MarkdownV2",
                    },
                );
            }
        }
        return ctx.reply(`Unexpected message: ${ctx.msg.text}`);
    },
);

function reply(
    ctx: CommandContext<Context> | CallbackQueryContext<Context>,
    msg: string,
) {
    // deno-lint-ignore no-explicit-any
    if ((ctx.update as any).test) {
        return;
    }
    return ctx.reply(msg);
}

// bot.catch((err) => console.error(err));
// bot.start();

const app = new Application();
app.use(webhookCallback(bot, "oak"));
app.listen({ port: 8000 });

type Header = {
    cat: string;
    last_name: string;
    name: string;
    id: string;
    amount: number;
};

type Player = {
    id: string;
    name: string;
    last_name: string;
};

type Payment = {
    id: string;
};

function parseAmount(strAmount: string) {
    if (strAmount.slice(-1).toLowerCase() === "k") {
        const unscaledAmount = parseFloat(strAmount.slice(0, -1));
        return isNaN(unscaledAmount) ? unscaledAmount : unscaledAmount * 1000;
    } else {
        return parseFloat(strAmount);
    }
}

function findInlineKeyboardButton(
    callbackQuery: CallbackQuery,
    predicate: (button: InlineKeyboardButton.CallbackButton) => boolean,
): InlineKeyboardButton.CallbackButton | undefined {
    return callbackQuery.message!.reply_markup!
        .inline_keyboard.flatMap((_) =>
            _ as InlineKeyboardButton.CallbackButton[]
        )
        .find((button) => predicate(button));
}

function parseHeader(text: string): Partial<Header> {
    const RegexCategory = /^Categoria: ([a-zA-Z0-9-_]+)$/;
    const RegexFrom = /^De: (\w+), (\w+) \((.*)\)$/;
    const RegexAmount = /^Monto: (\d+)$/;

    const mapOrEmpty = <T>(
        regex: RegExp,
        text: string,
        arrayToJson: (array: string[]) => T,
    ) => regex.test(text) ? arrayToJson(regex.exec(text)!) : {};

    const [, l1, l2, l3] = text.split("\n");

    const jsonCategory = mapOrEmpty(RegexCategory, l1, (arr) => ({
        cat: arr[1],
    }));

    const jsonFrom = mapOrEmpty(RegexFrom, l2, (arr) => ({
        last_name: arr[1],
        name: arr[2],
        id: arr[3],
    }));

    const jsonAmount = mapOrEmpty(RegexAmount, l3, (arr) => ({
        amount: Number(arr[1]),
    }));

    return {
        ...jsonCategory,
        ...jsonFrom,
        ...jsonAmount,
    };
}

function msgWithHeader(msg: string, h: Partial<Header> = {}) {
    const safe = (txt: string) => txt.replaceAll("-", "\\-");
    return "*Registro de pago*\n" +
        (h.cat ? `Categoria: ${safe(h.cat)}\n` : "") +
        (h.id ? `De: ${h.last_name}, ${h.name} \\(${safe(h.id)}\\)\n` : "") +
        (h.amount ? `Monto: ${h.amount}\n` : "") +
        "\n" +
        msg;
}

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:64321/functions/v1/telegram-webhook' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
