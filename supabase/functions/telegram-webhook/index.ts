// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {Application} from "jsr:@oak/oak/application";
import {
    Bot,
    CallbackQueryContext,
    CommandContext,
    Context,
    Filter,
    InlineKeyboard,
    webhookCallback,
} from "https://deno.land/x/grammy@v1.31.0/mod.ts";
import {createClient} from "jsr:@supabase/supabase-js@2";
import {CallbackQuery, InlineKeyboardButton,} from "https://deno.land/x/grammy_types@v3.15.0/markup.ts";
import {Message, ParseMode,} from "https://deno.land/x/grammy_types@v3.15.0/mod.ts";
import {sortBy, sum} from "https://deno.land/x/lodash@4.17.15-es/lodash.js";

console.log("Hello from telegram-webhook!");

const DryRun = false;

const TitleAddPayment = "Registro de pago";
const TitleListPayments = "Lista de pagos del mes";
const TitleOperationCancelled = "OPERACION CANCELADA";

const ErrorMsgPaymentContextLost =
    "Error: no se puede recuperar la información de pago. Reintente";
const ErrorMsgNoPlayers = (cat: string) =>
    `No hay jugadores para la categoria ${cat}`;
const NoKeyboard = { reply_markup: new InlineKeyboard() };

const CMD_PAGO = "registrarpago";
const CMD_LISTAR_PAGOS = "listarpagos";
const CMD_PAGO_VIEJO = "rpag";
const CMD_RP = "rper";
const CMD_CP = "cper";

const VALID_CATEGORIES = [
    "esc-1",
    "esc-2",
    "u-14",
    "cat-c",
    "cat-b",
    "cat-a",
    "other",
];

const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const bot = new Bot((Deno.env.get("TELEGRAM_BOT_TOKEN"))!);

bot.command("start", (ctx) => reply(ctx, "Welcome! Up and running."));
bot.command(CMD_RP, catchAll(CmdRegistrarPersona));
bot.command(CMD_PAGO_VIEJO, catchAll(CmdPagoViejo));
bot.command(CMD_CP, catchAll(CmdConsultarPersona));
bot.command(CMD_PAGO, catchAll(CmdPago));
bot.command(CMD_LISTAR_PAGOS, catchAll(CmdListarPagos));

bot.callbackQuery(/registrarpago cat (.*)$/, catchAll(callbackPagoCategoria));
bot.callbackQuery(/registrarpago jugador (.+)$/, catchAll(callbackPagoJugador));
bot.callbackQuery(/registrarpago traino categoria$/, catchAll(callbackPagoTrainoCategoria));
bot.callbackQuery(/registrarpago traino (\d\d\d\d-\d\d-\d\d) (\d\d?)$/, catchAll(callbackPagoTrainoInvitado));
bot.callbackQuery(/registrarpago monto (\d+)$/, catchAll(callbackPagoMonto));
bot.callbackQuery("registrarpago confirmar", catchAll(callbackPagoConfirmar));
bot.callbackQuery(/registrarpago monto otro/, catchAll(callbackPagoOtroMonto));
bot.callbackQuery(/listarpagos cat (.*)$/, catchAll(callbackListarPagosCateg));

bot.callbackQuery("cancelar", catchAll(callbackCancelar));
bot.callbackQuery(
    /.*/,
    (ctx) => console.error(`Unmatched callback to ${ctx.callbackQuery.data}`),
);

bot.on("message", OnMessage);

// bot.catch((err) => console.error(err));
// bot.start();

const app = new Application();
app.use(webhookCallback(bot, "oak"));
app.listen({ port: 8000 });

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:64321/functions/v1/telegram-webhook' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/

// ////////////////////////////////////
// HANDLERS - PAGO
// ////////////////////////////////////

async function CmdRegistrarPersona(ctx: CommandContext<Context>) {
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

    const category = categoryAnyCase.toLowerCase();
    const alias = (maybeAlias && maybeAlias.length > 0)
        ? maybeAlias.toLowerCase()
        : (name + "." + last_name).toLowerCase().replaceAll(" ", ".");

    if (!VALID_CATEGORIES.includes(category)) {
        return reply(
            ctx,
            `Categoria ${category} invalida. Validas: ${VALID_CATEGORIES}`,
        );
    }

    const maybeDni = dni ? { dni } : {};
    const { data, error } = await supabaseAdmin
        .from("players")
        .insert({ name, last_name, ...maybeDni, category, alias })
        .select().single();

    if (error) {
        console.error(error);
        return reply(ctx, "Error al registrar jugador");
    } else {
        return reply(ctx, "persona registrada! " + JSON.stringify(data));
    }
}

async function CmdPagoViejo(ctx: CommandContext<Context>) {
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

    const concept = detalle ?? currentYearMonth();
    const [maybeName, maybeLastName] = id.split(".");

    const {
        data: player_data,
        error: player_error,
    } = await supabaseAdmin
        .from("players")
        .select("*")
        .or(`dni.eq.${id},alias.ilike.${id},nick.ilike.${id},and(name.ilike.${maybeName},last_name.ilike.${maybeLastName})`)
        .single();

    if (player_error) {
        console.error("Player not found in DB " + JSON.stringify(player_error));
        return reply(
            ctx,
            `Jugador con id ${id} no encontrado.`,
        );
    }

    function GetRegisteredBy() {
        try {
            const from = ctx.update.message!.from;
            return `${from.last_name}, ${from.first_name} (${from.username})`;
        } catch (error) {
            console.error(error);
            return "[unknown]";
        }
    }

    const { data: paymentData, error } = await supabaseAdmin.from("payments")
        .insert({
            player_id: player_data.id,
            amount: monto,
            concept,
            registered_by: GetRegisteredBy(),
        }).select().single();

    if (error) {
        console.error(error);
        return reply(ctx, "Error al registrar el pago");
    } else {
        const jsonPayment = JSON.stringify(paymentData);
        return reply(ctx, `pago registrado! ${jsonPayment}`);
    }
}

async function CmdConsultarPersona(ctx: CommandContext<Context>) {
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
        console.error("Player not found in DB " + JSON.stringify(player_error));
        return reply(
            ctx,
            `Jugador con id ${id} no encontrado.`,
        );
    }

    const { data: paymentsData, error: payments_error } = await supabaseAdmin
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
}

function CmdPago(ctx: CommandContext<Context>) {
    console.log(`Ejecutando comando ${CMD_PAGO}`);

    const inlineKeyboard = selectCategoriesKeyboard(CMD_PAGO);
    return ctx.reply(
        paymentMessage("_Elegir categoria:_"),
        { reply_markup: inlineKeyboard, parse_mode: "MarkdownV2" },
    );
}

async function callbackPagoCategoria(ctx: CallbackQueryContext<Context>) {
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
        return ctx.editMessageText(ErrorMsgNoPlayers(cat), NoKeyboard);
    }

    const name = (player: Player) => `${player.last_name}, ${player.name}`;
    const [head, ...tail] = data;
    const inlineKeyboard = tail.reduce(
        (kb, player) =>
            kb.row().text(name(player), `${CMD_PAGO} jugador ${player.id}`),
        new InlineKeyboard().text(name(head), `${CMD_PAGO} jugador ${head.id}`),
    ).row().text("Cancelar", "cancelar");

    const id = ctx.update.callback_query.message!.message_id;
    return ctx.editMessageText(
        paymentMessage("_Elegir jugador:_", { id, cat }),
        {
            reply_markup: inlineKeyboard,
            parse_mode: "MarkdownV2",
        },
    );
}

function callbackPagoJugador(ctx: CallbackQueryContext<Context>) {
    const playerId = ctx.match[1];
    console.log(`Pago - jugador seleccionado ${playerId}`);

    const maybePaymentMessage = ctx.callbackQuery.message?.text;
    if (!maybePaymentMessage) {
        return ctx.editMessageText(ErrorMsgPaymentContextLost, NoKeyboard);
    }

    const [last_name, name] = findInlineKeyboardButton(
        ctx.callbackQuery,
        (_) => _.callback_data.endsWith(playerId),
    )!.text.split(", ");
    const header = {
        ...parsePaymentMessage(maybePaymentMessage),
        last_name,
        name,
        player_id: playerId,
    };

    const last = previousTrainingDay(todayAtNoon());
    const previousToLast = previousTrainingDay(getDayBefore(last));

    const previousTrainos = [last, previousToLast].flatMap(
        (day) => hoursFor(day.getDay()).map((hour) => [day, hour]),
    ) as [Date, number][];
    const text = (d: Date, h: number) => `Invitado ${toString(d)} - ${h}hs`;
    const data = (d: Date, h: number) => `${CMD_PAGO} traino ${toISODate(d)} ${h}`;
    const kb = previousTrainos.reduce(
        (_kb, [day, hour]) => _kb.row().text(text(day, hour), data(day, hour)),
        new InlineKeyboard().text(
            `Entrenamiento categoria (${slotForTraino(header.cat!)})`,
            `${CMD_PAGO} traino categoria`,
        ),
    ).row().text("Cancelar", "cancelar");

    return ctx.editMessageText(
        paymentMessage("_Elegir horario de entrenamiento:_", header),
        {
            reply_markup: kb,
            parse_mode: "MarkdownV2",
        },
    );
}

function callbackPagoTrainoCategoria(ctx: CallbackQueryContext<Context>) {
    console.log("Pago - entrenamiento de la categoria");

    const maybePaymentMessage = ctx.callbackQuery.message?.text;
    if (!maybePaymentMessage) {
        return ctx.editMessageText(ErrorMsgPaymentContextLost, NoKeyboard);
    }
    const header = parsePaymentMessage(maybePaymentMessage);

    if (!header.cat) {
        return ctx.editMessageText(ErrorMsgPaymentContextLost, NoKeyboard);
    }
    const slot = slotForTraino(header.cat);
    return editTextChooseAmount(ctx, { ...header, slot });
}

function callbackPagoTrainoInvitado(ctx: CallbackQueryContext<Context>) {
    const [, isoDate, time] = ctx.match;
    console.log(`Pago - entrenamiento de invitado ${isoDate} ${time}hs`);

    const maybePaymentMessage = ctx.callbackQuery.message?.text;
    if (!maybePaymentMessage) {
        return ctx.editMessageText(ErrorMsgPaymentContextLost, NoKeyboard);
    }
    const header = parsePaymentMessage(maybePaymentMessage);

    const slot = toSlot(isoDate, time);
    return editTextChooseAmount(ctx, { ...header, slot });
}

function editTextChooseAmount(
    ctx: CallbackQueryContext<Context>,
    header: Partial<Header>,
) {
    return ctx.editMessageText(
        paymentMessage("_Elegir monto:_", header),
        {
            reply_markup: new InlineKeyboard()
                .text("60k", `${CMD_PAGO} monto 60`)
                .text("45k", `${CMD_PAGO} monto 45`)
                .text("30k", `${CMD_PAGO} monto 30`)
                .text("15k", `${CMD_PAGO} monto 15`)
                .text("13k", `${CMD_PAGO} monto 13`)
                .text("10k", `${CMD_PAGO} monto 10`)
                .row()
                .text("Otro", `${CMD_PAGO} monto otro`)
                .text("Cancelar", "cancelar"),
            parse_mode: "MarkdownV2",
        },
    );
}

function callbackPagoMonto(ctx: CallbackQueryContext<Context>) {
    const strAmount = ctx.match[1];
    console.log(`Pago - registrando pago por $${strAmount}`);

    const maybePaymentMessage = ctx.callbackQuery.message?.text;
    if (!maybePaymentMessage) {
        return ctx.editMessageText(ErrorMsgPaymentContextLost, NoKeyboard);
    }
    const header = parsePaymentMessage(maybePaymentMessage);

    const [valid, amount] = tryParseAmount(strAmount);
    if (!valid) {
        return ctx.editMessageText(
            paymentMessage("*Monto ingresado no valido*", header),
            {
                reply_markup: new InlineKeyboard(),
                parse_mode: "MarkdownV2",
            },
        );
    }

    return ctx.editMessageText(
        confirmMessage(header, amount),
        replyWithConfirmButtons(amount),
    );
}

async function callbackPagoOtroMonto(ctx: CallbackQueryContext<Context>) {
    console.log(`Pago - pidiendo monto arbitrario`);

    const maybePaymentMessage = ctx.callbackQuery.message?.text;
    if (!maybePaymentMessage) {
        return ctx.editMessageText(ErrorMsgPaymentContextLost, NoKeyboard);
    }
    const header = parsePaymentMessage(maybePaymentMessage);

    await ctx.editMessageText(
        paymentMessage("Continuando operacion debajo\\.\\.\\.", header),
        {
            reply_markup: new InlineKeyboard(),
            parse_mode: "MarkdownV2",
        },
    );
    return bot.api.sendMessage(
        ctx.chat!.id,
        paymentMessage("_Escriba monto en miles \\(ej: 60\\):_", header),
        {
            reply_markup: { force_reply: true },
            parse_mode: "MarkdownV2",
        },
    );
}

async function callbackPagoConfirmar(ctx: CallbackQueryContext<Context>) {
    console.log(`Pago - confirmacion`);

    const maybePaymentMessage = ctx.callbackQuery.message?.text;
    if (!maybePaymentMessage) {
        return ctx.editMessageText(ErrorMsgPaymentContextLost, NoKeyboard);
    }

    const header = parsePaymentMessage(maybePaymentMessage);

    if (DryRun) {
        return ctx.editMessageText(
            paymentMessage(
                "*Operacion finalizada con exito\\!*\nID de pago: dummy\\-payment\\-id",
                header,
            ),
            {
                reply_markup: new InlineKeyboard(),
                parse_mode: "MarkdownV2",
            },
        );
    }

    function GetRegisteredBy() {
        try {
            const from = ctx.update.callback_query.from;
            return `${from.last_name}, ${from.first_name} (${from.username})`;
        } catch (error) {
            console.error(error);
            return "[unknown]";
        }
    }
    const { data, error } = await supabaseAdmin
        .from("payments")
        .insert([{
            id: header.id,
            player_id: header.player_id,
            amount: header.amount!,
            concept: currentYearMonth(),
            registered_by: GetRegisteredBy(),
            slot: header.slot,
        }])
        .select().single<Payment>();

    if (error) {
        console.error(error);
    }

    const msg = error
        ? `*Operacion finalzada con errores*\n${escape(error.message)}`
        : `*Operacion finalizada con exito\\!*\nID de pago: ${data.id}`;
    return ctx.editMessageText(
        paymentMessage(msg, header),
        {
            reply_markup: new InlineKeyboard(),
            parse_mode: "MarkdownV2",
        },
    );
}

function callbackCancelar(ctx: CallbackQueryContext<Context>) {
    console.log("Cancelacion");

    const flowDescription = ctx.callbackQuery.message?.text;

    if (!flowDescription) {
        return ctx.editMessageText(
            `*${TitleOperationCancelled}*`,
            {
                reply_markup: new InlineKeyboard(),
                parse_mode: "MarkdownV2",
            },
        );
    }

    const title = flowDescription.substring(0, flowDescription.indexOf("\n"));
    console.log(title);

    let message: string;
    if (title === TitleAddPayment) {
        const header = parsePaymentMessage(flowDescription);
        message = paymentMessage(TitleOperationCancelled, header);
    } else if (title === TitleListPayments) {
        message = `*${TitleListPayments}*\n\n${TitleOperationCancelled}`;
    } else {
        message = TitleOperationCancelled;
    }
    return ctx.editMessageText(
        message,
        {
            reply_markup: new InlineKeyboard(),
            parse_mode: "MarkdownV2",
        },
    );
}

// ////////////////////////////////////
// HANDLERS = LISTAR PAGOS
// ////////////////////////////////////

function CmdListarPagos(ctx: CommandContext<Context>) {
    console.log(`Ejecutando comando ${CMD_LISTAR_PAGOS}`);

    const inlineKeyboard = selectCategoriesKeyboard(CMD_LISTAR_PAGOS);
    return ctx.reply(
        `*${TitleListPayments}*\n\n_Elegir categoria:_`,
        { reply_markup: inlineKeyboard, parse_mode: "MarkdownV2" },
    );
}

async function callbackListarPagosCateg(
    ctx: CallbackQueryContext<Context>,
) {
    const cat = ctx.match[1];
    console.log("ListarPagosCategoria - categoria elegida: " + cat);

    const selectType = "*, payments(amount)";
    const { data, error } = await supabaseAdmin
        .from("players")
        .select<"*, payments(amount)", Player>(selectType)
        .eq("category", cat)
        .eq("payments.concept", currentYearMonth());

    if (error) {
        console.error(error);
        return ctx.editMessageText(
            `Unexpected error while getting list of payments: ${error.message}`,
        );
    }

    type PlayerWithAmount = { last_name: string; name: string; amount: number };
    const aggregated = data.map((player) =>
        ({
            ...player,
            amount: player.payments.length > 0
                ? sum(player.payments.map((_) => _.amount))
                : 0,
        }) as PlayerWithAmount
    );

    const sorted = sortBy(aggregated, [
        "amount",
        (_: PlayerWithAmount) => _.last_name.toLowerCase(),
        "name",
    ]) as PlayerWithAmount[];

    const messages = sorted.map((payment) =>
        `${payment.amount} - ${payment.last_name}, ${payment.name}`
    );
    return ctx.editMessageText(
        "*Lista de pagos del mes*\n\n" +
            escape(`Categoria: ${cat}\n\n`) +
            escape(`${messages.join("\n")}`),
        { parse_mode: "MarkdownV2" },
    );
}

// ////////////////////////////////////
// DEFAULT MESSAGE HANDLER
// ////////////////////////////////////

function OnMessage(
    ctx: Filter<Context, "message">,
): Promise<Message.TextMessage> {
    const repliedText = ctx.update.message?.reply_to_message?.text;
    if (repliedText) {
        const header = parsePaymentMessage(repliedText);
        if (header.cat && header.player_id) {
            const [valid, amount] = ctx.message?.text
                ? tryParseAmount(ctx.message.text)
                : [false, -1];

            if (!valid) {
                return ctx.reply(
                    paymentMessage("*Monto ingresado no valido*", header),
                    {
                        parse_mode: "MarkdownV2",
                    },
                );
            }

            return ctx.reply(
                confirmMessage(header, amount),
                replyWithConfirmButtons(amount),
            );
        }
    }
    return ctx.reply(`Unexpected message: ${ctx.msg.text}`);
}

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

// ////////////////////////////////////
// TYPES
// ////////////////////////////////////

type Header = {
    id: number;
    cat: string;
    last_name: string;
    name: string;
    player_id: string;
    slot: string;
    amount: number;
};

type Player = {
    id: string;
    name: string;
    last_name: string;
    payments: Payment[];
};

type Payment = {
    id: string;
    player_id: string;
    amount: number;
};

type Middleware<T> = (ctx: CommandContext<Context>) => Promise<T>;

// ////////////////////////////////////
// HELPERS
// ////////////////////////////////////

function selectCategoriesKeyboard(cmd: string) {
    return new InlineKeyboard()
        .text("Escuela 1", `${cmd} cat esc-1`)
        .row().text("Escuela 2", `${cmd} cat esc-2`)
        .row().text("Menores", `${cmd} cat u-14`)
        .row().text("Cat C", `${cmd} cat cat-c`)
        .row().text("Cat B", `${cmd} cat cat-b`)
        .row().text("Cat A", `${cmd} cat cat-a`)
        .row().text("Cancelar", "cancelar");
}

function catchAll<T>(f: Middleware<T>): Middleware<T | Message.TextMessage> {
    return async (ctx) => {
        try {
            return await f(ctx);
        } catch (error) {
            console.error(error);
            return await ctx.reply(
                `Error while executing handler: ${error.message}`,
            );
        }
    };
}

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

function parsePaymentMessage(text: string): Partial<Header> {
    const RegexFlowID = /^ID: (\d+)$/;
    const RegexCategory = /^Categoria: ([a-zA-Z0-9-_]+)$/;
    const RegexFrom = /^De: ([A-zÀ-ú- ]+), ([A-zÀ-ú- ]+) \((.*)\)$/;
    const RegexSlot = /^Horario: (.*)$/;
    const RegexAmount = /^Monto: (\d+).000$/;

    const mapOrEmpty = <T>(
        regex: RegExp,
        text: string,
        arrayToJson: (array: string[]) => T,
    ) => regex.test(text) ? arrayToJson(regex.exec(text)!) : {};

    const [, l1, l2, l3, l4, l5] = text.split("\n");

    const jsonID = mapOrEmpty(RegexFlowID, l1, (arr) => ({
        id: Number(arr[1]),
    }));

    const jsonCategory = mapOrEmpty(RegexCategory, l2, (arr) => ({
        cat: arr[1],
    }));

    const jsonFrom = mapOrEmpty(RegexFrom, l3, (arr) => ({
        last_name: arr[1],
        name: arr[2],
        player_id: arr[3],
    }));

    const jsonSlot = mapOrEmpty(RegexSlot, l4, (arr) => ({
        slot: arr[1],
    }));

    const jsonAmount = mapOrEmpty(RegexAmount, l5, (arr) => ({
        amount: Number(arr[1]),
    }));

    return {
        ...jsonID,
        ...jsonCategory,
        ...jsonFrom,
        ...jsonSlot,
        ...jsonAmount,
    };
}

function paymentMessage(msg: string, h: Partial<Header> = {}) {
    return `*${TitleAddPayment}*\n` +
        escape(
            (h.id ? `ID: ${h.id}\n` : "") +
                (h.cat ? `Categoria: ${h.cat}\n` : "") +
                (h.player_id
                    ? `De: ${h.last_name}, ${h.name} (${h.player_id})\n`
                    : "") +
                (h.slot ? `Horario: ${h.slot}\n` : "") +
                (h.amount ? `Monto: ${h.amount}.000\n` : "") +
                "\n",
        ) + msg;
}

function currentYearMonth() {
    return new Date().toLocaleString("sv-SE").substring(0, 7);
}

function escape(txt: string) {
    return txt.replaceAll(/[_*\[\]()~`>#+\-=|{}.!]/g, "\\$&");
}

function tryParseAmount(strAmount: string): [boolean, number] {
    const verboseRegex = /^\d{1,3}\.\d\d\d$/;
    const kRegex = /^\d{1,3}k$/;
    const shortRegex = /^\d{1,3}$/;
    const longRegex = /^\d{4,6}$/;

    if (verboseRegex.test(strAmount)) {
        return [true, parseInt(strAmount.slice(0, -4))];
    } else if (kRegex.test(strAmount)) {
        return [true, parseInt(strAmount.slice(0, -1))];
    } else if (shortRegex.test(strAmount)) {
        return [true, parseInt(strAmount)];
    } else if (longRegex.test(strAmount)) {
        return [true, parseInt(strAmount.slice(0, -3))];
    } else {
        return [false, -1];
    }
}

function confirmMessage(header: Partial<Header>, amount: number) {
    return paymentMessage("*Confirmar?*", { ...header, amount });
}

function replyWithConfirmButtons(amount: number) {
    return {
        reply_markup: new InlineKeyboard()
            .text(`${amount} mil`, `${CMD_PAGO} confirmar`)
            .text("Cancelar", "cancelar"),
        parse_mode: "MarkdownV2" as ParseMode,
    };
}

function todayAtNoon() {
    const today = new Date();
    today.setHours(12);
    return today;
}

function previousTrainingDay(date: Date) {
    const prev = new Date(date);
    while (prev.getDay() != 0 && prev.getDay() != 4) {
        prev.setDate(prev.getDate() - 1);
    }
    return prev;
}

function getDayBefore(date: Date) {
    const dayBefore = new Date(date);
    dayBefore.setDate(dayBefore.getDate() - 1);
    return dayBefore;
}

function toString(date: Date): string {
    return date.toLocaleString("es-AR", {
        weekday: "short",
        day: "numeric",
    });
}

function toISODate(date: Date) {
    return date.toISOString().substring(0, 10);
}

function hoursFor(day: number) {
    if (day === 0) return [23, 11, 10];
    else if (day === 4) return [23, 22, 21];
    else throw new Error(`Unexpected training day ${day}`);
}

function slotForTraino(category: string): string {
    switch (category) {
        case "cat-c":
            return "jue 21hs";
        case "cat-b":
            return "jue 22hs";
        case "cat-a":
            return "jue 23hs";
        case "esc-1":
            return "dom 10hs";
        case "esc-2":
        case "u-14":
            return "dom 11hs";
        default:
            throw new Error(`Unexpected category ${category}`);
    }
}

function toSlot(isoDate: string, hour: string): string {
    const date = new Date(`${isoDate}T${hour}:00`);
    return date.toLocaleString("es-AR", {
        weekday: "short",
        day: "numeric",
        hour: "numeric",
        hour12: false,
    }).replace(",", "") + "hs";
}
