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
    Filter,
    InlineKeyboard,
    webhookCallback,
} from "https://deno.land/x/grammy@v1.40.0/mod.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import type {
    CallbackQuery,
    InlineKeyboardButton,
    Message,
    ParseMode,
} from "https://deno.land/x/grammy@v1.40.0/types.ts";
import { sortBy, sum } from "https://deno.land/x/lodash@4.17.15-es/lodash.js";

console.log("Hello from telegram-webhook!");

const DryRun = false;

const TitleAddPayment = "Registro de pago";
const TitleListPayments = "Lista de pagos del mes";
const TitleAttendance = "Registro de asistencia";
const TitleOperationCancelled = "OPERACION CANCELADA";
const TitleOperationFinished = "OPERACION FINALIZADA";

const ErrorMsgPaymentContextLost =
    "Error: no se puede recuperar la información de pago. Reintente";
const ErrorMsgNoPlayers = (cats: string[]) =>
    `No hay jugadores para las categorias ${cats}`;
const NoKeyboard = { reply_markup: new InlineKeyboard() };

const CMD_PAGO = "registrarpago";
const CMD_LISTAR_PAGOS = "listarpagos";
const CMD_PAGO_VIEJO = "rpag";
const CMD_RP = "rper";
const CMD_CP = "cper";
const CmdAsist = "asist";
const CmdAsistPago = "asistpago";
const CMD_ANUAL = "anual";

const VALID_CATEGORIES = [
    "esc-2",
    "u-14",
    "cat-c",
    "cat-b",
    "cat-a"
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
bot.command(CmdAsist, catchAll(CmdRegistrarAsistencia));
bot.command(CmdAsistPago, catchAll(CmdRegistrarAsistenciaPago));
bot.command(CMD_ANUAL, catchAll(CmdAnual));

bot.callbackQuery(/registrarpago cat (.*)$/, catchAll(callbackPagoCategoria));
bot.callbackQuery(/registrarpago jugador (.+)$/, catchAll(callbackPagoJugador));
bot.callbackQuery(/registrarpago traino categoria$/, catchAll(callbackPagoTrainoCategoria));
bot.callbackQuery(/registrarpago traino (\d\d\d\d-\d\d-\d\d) (\d\d?)$/, catchAll(callbackPagoTrainoInvitado));
bot.callbackQuery(/registrarpago monto (\d+)$/, catchAll(callbackPagoMonto));
bot.callbackQuery("registrarpago confirmar", catchAll(callbackPagoConfirmar));
bot.callbackQuery(/registrarpago monto otro/, catchAll(callbackPagoOtroMonto));

bot.callbackQuery(/listarpagos cat (.*)$/, catchAll(callbackListarPagosCateg));

const rDate = "\\d\\d\\d\\d-\\d\\d-\\d\\d";
const rDateCompact = "\\d{8}";
const rUuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const r = (str: string) => new RegExp(str, "i");
bot.callbackQuery(r(`asist (${rDate})$`), catchAll(cbAsistenciaDia));
bot.callbackQuery(r(`asist (${rDate}) (\\d\\d)$`), catchAll(cbAsistenciaSlot));
bot.callbackQuery(r(`asist (${rDate}) (\\d\\d) (${rUuid}) ([yn])$`), catchAll(cbAsistenciaSlot));

bot.callbackQuery(r(`apd[|](${rDateCompact})$`), catchAll(cbAsistenciaPagoDia));
bot.callbackQuery(r(`ap[|](${rDateCompact})[|](\\d\\d)$`), catchAll(cbAsistenciaPagoSlot));
bot.callbackQuery(
    r(`ap[|](${rDateCompact})[|](\\d\\d)[|]([a])[|](${rUuid})[|]([yn])$`),
    catchAll(cbAsistenciaPagoSlot),
);
bot.callbackQuery(
    r(`ap[|](${rDateCompact})[|](\\d\\d)[|]([x])[|](${rUuid})$`),
    catchAll(cbAsistenciaPagoSlot),
);
bot.callbackQuery(
    r(`ap[|](${rDateCompact})[|](\\d\\d)[|]([m])[|](${rUuid})[|](\\d+)$`),
    catchAll(cbAsistenciaPagoSlot),
);
bot.callbackQuery(
    r(`ap[|](${rDateCompact})[|](\\d\\d)[|]o[|](${rUuid})$`),
    catchAll(cbAsistenciaPagoPayOther),
);

bot.callbackQuery("cancelar", catchAll(callbackCancelar));
bot.callbackQuery("noop", (ctx) => ctx.answerCallbackQuery());
bot.callbackQuery(
    /.*/,
    (ctx) => console.error(`Unmatched callback to ${ctx.callbackQuery.data}`),
);

bot.on("message", OnMessage);

bot.catch((err: unknown) => console.error(err));

const TelegramOperationMode = (Deno.env.get("TELEGRAM_OPERATION_MODE") ?? "setWebhook").trim();

if (TelegramOperationMode === "getUpdates") {
    bot.start();
    console.log("Using long-polling mode")
} else {
    const app = new Application();
    const TelegramWebhookSecretToken = Deno.env.get("TELEGRAM_WEBHOOK_SECRET_TOKEN");

    app.use(async (ctx, next) => {
        if (!TelegramWebhookSecretToken) {
            ctx.response.status = 500;
            ctx.response.body = "Server not configured";
            return;
        }
        const token = ctx.request.headers.get("x-telegram-bot-api-secret-token");
        if (token !== TelegramWebhookSecretToken) {
            ctx.response.status = 401;
            ctx.response.body = "Unauthorized";
            return;
        }

        await next();
    });
    app.use(webhookCallback(bot, "oak"));

    Deno.serve(async (req: Request) => {
        return await app.handle(req) ?? new Response("Not Found", { status: 404 });
    });
}

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

async function CmdAnual(ctx: CommandContext<Context>) {
    const url = (Deno.env.get("DASHBOARD_URL") ?? "").trim();
    if (!url) {
        return ctx.reply(
            "Dashboard no configurado. Falta la variable de entorno DASHBOARD_URL",
        );
    }

    const kb = new InlineKeyboard().webApp(
        "Abrir pago anual",
        url,
    );
    return ctx.reply(
        "Abrí el mini app para registrar el pago anual:",
        { reply_markup: kb },
    );
}

async function CmdRegistrarPersona(ctx: CommandContext<Context>) {
    console.log(`Ejecutando comando ${CMD_RP}`);

    // text = /rp nombre,apellido,dni,categoria
    const tokens = ctx.match.split(",");
    if (tokens.length < 4) {
        return ctx.reply("Uso: /rp nombre,apellido,dni,categoria");
    }

    const [
        name,
        last_name,
        dni,
        categoryAnyCase,
        ...rest
    ] = tokens.map((_) => _.trim());

    if (rest && rest.length > 0) {
        console.warn(`There are many more parameters: ${rest}`);
    }

    const category = categoryAnyCase.toLowerCase();

    if (!VALID_CATEGORIES.includes(category)) {
        return reply(
            ctx,
            `Categoria ${category} invalida. Validas: ${VALID_CATEGORIES}`,
        );
    }

    const maybeDni = dni ? { dni } : {};
    const { data, error } = await supabaseAdmin
        .from("players")
        .insert({ name, last_name, ...maybeDni, category })
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

    const month = detalle ?? currentYearMonth();
    const [maybeName, maybeLastName] = id.split(".");

    const {
        data: player_data,
        error: player_error,
    } = await supabaseAdmin
        .from("players")
        .select("*")
        .or(`dni.eq.${id},and(name.ilike.${maybeName},last_name.ilike.${maybeLastName})`)
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
            return telegramRegisteredBy(ctx);
        } catch (error) {
            console.error(error);
            return "[unknown]";
        }
    }

    const slot = catToSlot(player_data.category);
    const { data: paymentData, error } = await supabaseAdmin.from("payments")
        .insert({
            id: crypto.randomUUID(),
            player_id: player_data.id,
            amount: monto,
            concept: "monthly",
            month,
            registered_by: GetRegisteredBy(),
            slot,
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
        .or(`dni.eq.${id},and(name.ilike.${maybeName},last_name.ilike.${maybeLastName})`)
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
        .order("last_name")
        .order("name");

    if (error) {
        console.error(error);
        return reply(ctx, "Error al buscar jugadores de categoria esc-1");
    }

    if (data.length == 0) {
        return ctx.editMessageText(ErrorMsgNoPlayers([cat]), NoKeyboard);
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
        (day) => slotsForDay(day).map((hour) => [day, Number(hour)]),
    ) as [Date, number][];
    const text = (d: Date, h: number) => `Invitado ${toString(d)} - ${h}hs`;
    const data = (d: Date, h: number) =>
        `${CMD_PAGO} traino ${toISODate(d)} ${h}`;
    const kb = previousTrainos.reduce(
        (_kb, [day, hour]) => _kb.row().text(text(day, hour), data(day, hour)),
        new InlineKeyboard().text(
            `Entrenamiento categoria (${catToSlot(header.cat!)})`,
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
    const slot = catToSlot(header.cat);
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

    const slot = toSpecificSlot(isoDate, time);
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

    const chatId = ctx.callbackQuery.message?.chat?.id;
    if (!chatId) {
        return ctx.editMessageText(
            paymentMessage("Error: no se pudo determinar chat_id", header),
            {
                reply_markup: new InlineKeyboard(),
                parse_mode: "MarkdownV2",
            },
        );
    }

    const maybeSessionMatch = new RegExp(`^(${rDate}) (\\d\\d)hs$`, "i").exec(
        header.slot ?? "",
    );
    const isSessionPayment = Boolean(maybeSessionMatch);
    const sessionIsoDate = isSessionPayment ? maybeSessionMatch![1] : undefined;
    const sessionHour = isSessionPayment ? maybeSessionMatch![2] : undefined;
    const paymentConcept = isSessionPayment ? "session" : "monthly";
    const paymentMonth = isSessionPayment ? sessionIsoDate!.substring(0, 7) : currentYearMonth();
    const paymentSlot = isSessionPayment
        ? toGenericSlot(sessionIsoDate!, sessionHour!)
        : header.slot;
    const paymentSession = isSessionPayment ? header.slot : null;

    const paymentId = await _uuidv5(
        "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
        `telegram:pago:${chatId}:${header.id}:${header.amount}:${paymentConcept}:${paymentMonth}:${paymentSlot}:${paymentSession ?? ""}`,
    );

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

    const registeredBy = telegramRegisteredBy(ctx);
    const { data, error } = await supabaseAdmin
        .from("payments")
        .insert([{
            id: paymentId,
            player_id: header.player_id,
            amount: header.amount!,
            concept: paymentConcept,
            month: paymentMonth,
            registered_by: registeredBy,
            slot: paymentSlot,
            session: paymentSession,
        }])
        .select().single<Payment>();

    if (error) {
        if (error.code === "23505") {
            const msg = `*Operacion finalizada con exito\!*\nID de pago: ${escape(paymentId)}`;
            return ctx.editMessageText(
                paymentMessage(msg, header),
                {
                    reply_markup: new InlineKeyboard(),
                    parse_mode: "MarkdownV2",
                },
            );
        }
        console.error(error);
        const msg = `*Operacion finalzada con errores*\n${escape(error.message)}`;
        return ctx.editMessageText(
            paymentMessage(msg, header),
            {
                reply_markup: new InlineKeyboard(),
                parse_mode: "MarkdownV2",
            },
        );
    }

    const msg = `*Operacion finalizada con exito\\!*\nID de pago: ${escape(data.id)}`;
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
    } else if (title === TitleAttendance) {
        message = `*${TitleAttendance}*\n\n${TitleOperationFinished}`;
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
// HANDLERS - LISTAR PAGOS
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
        .eq("payments.concept", "monthly")
        .eq("payments.month", currentYearMonth());

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
            amount: (player.payments?.length ?? 0) > 0
                ? sum((player.payments ?? []).map((_) => _.amount))
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
// HANDLERS - REGISTRAR ASISTENCIA
// ////////////////////////////////////

function CmdRegistrarAsistencia(ctx: CommandContext<Context>) {
    console.log(`Ejecutando comando ${CmdAsist}`);

    const date = searchPrevDayWithSlots(new Date(), true);
    return ctx.reply(
        attendanceMessage("_Eligir sesión de entrenamiento:_"),
        {
            reply_markup: keyboardForChooseSession(date),
            parse_mode: "MarkdownV2",
        },
    );
}

function CmdRegistrarAsistenciaPago(ctx: CommandContext<Context>) {
    console.log(`Ejecutando comando ${CmdAsistPago}`);

    const date = searchPrevDayWithSlots(new Date(), true);
    return ctx.reply(
        attendanceMessage("_Eligir sesión de entrenamiento:_"),
        {
            reply_markup: keyboardForChooseSessionAsistPago(date),
            parse_mode: "MarkdownV2",
        },
    );
}

function cbAsistenciaDia(ctx: CallbackQueryContext<Context>) {
    const dateText = ctx.match[1];
    console.log(`Callback asistencia - dia: ${dateText}`);

    const date = new Date(Date.parse(`${dateText}T12:00:00`));
    const dateWithSlots = searchPrevDayWithSlots(date, true);
    return ctx.editMessageText(
        attendanceMessage("_Eligir sesión de entrenamiento:_"),
        {
            reply_markup: keyboardForChooseSession(dateWithSlots),
            parse_mode: "MarkdownV2",
        },
    );
}

function cbAsistenciaPagoDia(ctx: CallbackQueryContext<Context>) {
    const dateCompact = ctx.match[1];
    if (!dateCompact) {
        console.error("Callback asistencia pago - dia: missing dateCompact");
        return ctx.answerCallbackQuery({ text: "Error: fecha invalida" });
    }
    const dateText = compactDateToIso(dateCompact);
    console.log(`Callback asistencia pago - dia: ${dateText}`);

    const date = new Date(Date.parse(`${dateText}T12:00:00`));
    return safeEditMessageText(
        ctx,
        attendanceMessage("_Eligir sesión de entrenamiento:_"),
        {
            reply_markup: keyboardForChooseSessionAsistPago(date),
            parse_mode: "MarkdownV2",
        },
    );
}

async function cbAsistenciaSlot(ctx: CallbackQueryContext<Context>) {
    const [, isoDate, hs, player_id, attendance] = ctx.match;
    console.log(`Callback asist: ${isoDate} ${hs} ${player_id} ${attendance}`);

    const specificSlot = toSpecificSlot(isoDate, hs);
    const genericSlot = toGenericSlot(isoDate, hs);
    const cats = slotToCat(genericSlot);

    const { data: players, error } = await supabaseAdmin
        .from("players")
        .select<"*", Player>()
        .in("category", cats)
        .order("last_name")
        .order("name");
    if (error) {
        console.error(error);
        return reply(ctx, "Error al buscar jugadores de categoria esc-1");
    }

    if (players.length == 0) {
        return ctx.editMessageText(ErrorMsgNoPlayers(cats), NoKeyboard);
    }

    if (player_id && attendance) {
        const attended = attendance === "y";
        const { error: insertErr } = await supabaseAdmin
            .from("attendances")
            .insert({ session: specificSlot, player_id, attended });

        if (insertErr) {
            if (insertErr.code !== "23505") {
                return ctx.editMessageText("Error al marcar asistencia");
            }

            const { error: updateErr } = await supabaseAdmin
                .from("attendances")
                .update({ attended })
                .eq("session", specificSlot)
                .eq("player_id", player_id);

            if (updateErr) {
                return ctx.editMessageText("Error al marcar asistencia");
            }
        }
    }

    const { data: attendances, error: attendanceError } = await supabaseAdmin
        .from("attendances")
        .select<"*", Attendance>()
        .eq("session", specificSlot);
    if (attendanceError) {
        console.error(error);
        return reply(ctx, "Error al buscar asistencias para la sesion");
    }
    const attendees = attendances!.filter((_) => _.attended).map(
        (_) => _.player_id,
    );

    const status = (p: Player) =>
        attendees.includes(p.id) ? "PRESENTE" : "AUSENTE";
    const yn = (p: Player) => attendees.includes(p.id) ? "n" : "y";
    const lbl = (p: Player) => `${p.last_name}, ${p.name} está ${status(p)}`;
    const dat = (p: Player) => `${CmdAsist} ${isoDate} ${hs} ${p.id} ${yn(p)}`;
    const kb = players.reduce(
        (_kb, player) => _kb.row().text(lbl(player), dat(player)),
        new InlineKeyboard(),
    ).row().text("Finalizar", "cancelar");

    const res = await safeEditMessageText(
        ctx,
        attendanceMessage("_Ajuste asistencia:_"),
        {
            reply_markup: kb,
            parse_mode: "MarkdownV2",
        },
    );

    try {
        await ctx.answerCallbackQuery();
    } catch {
        // ignore
    }

    return res;
}

async function cbAsistenciaPagoSlot(ctx: CallbackQueryContext<Context>) {
    const t0Full = Date.now();
    const match = ctx.match as unknown as string[];
    const dateCompact = match[1];
    const isoDate = compactDateToIso(dateCompact);
    const hs = match[2];
    const action = match.length >= 4 ? match[3] : undefined;
    const player_id = match.length >= 5 ? match[4] : undefined;
    const arg = match.length >= 6 ? match[5] : undefined;
    console.log(
        `Callback asistpago: ${isoDate} ${hs} ${action ?? "(none)"} ${player_id ?? ""} ${arg ?? ""}`,
    );

    const specificSlot = toSpecificSlot(isoDate, hs);
    const genericSlot = toGenericSlot(isoDate, hs);
    const cats = slotToCat(genericSlot);
    const selectedMonth = isoDate.substring(0, 7);

    const expandedPlayerId = action === "x" ? player_id : undefined;

    let tAfterAnswer = Date.now();
    try {
        await ctx.answerCallbackQuery();
        tAfterAnswer = Date.now();
    } catch {
        // ignore
        tAfterAnswer = Date.now();
    }

    const t0 = tAfterAnswer;
    let tAfterWrite = t0;
    let tAfterBuildKb = t0;
    let optimisticSucceeded = false;
    let optimisticKeyboard: InlineKeyboardButton[][] | null = null;

    const tryOptimisticToggle = async () => {
        if (action !== "a" || !player_id) return;
        const message = ctx.callbackQuery.message;
        const chatId = message?.chat?.id;
        const messageId = message?.message_id;
        const inlineKb = message?.reply_markup?.inline_keyboard;
        if (!chatId || !messageId || !inlineKb) return;

        const oldPrefix = `ap|${dateCompact}|${hs}|a|${player_id}|`;
        type InlineCallbackButton = Extract<InlineKeyboardButton, { callback_data: string }>;
        const isCallbackButton = (b: InlineKeyboardButton): b is InlineCallbackButton => {
            return "callback_data" in b;
        };

        const newKb: InlineKeyboardButton[][] = inlineKb.map((row) =>
            row.map((btn) => {
                if (!isCallbackButton(btn)) return btn;
                if (!btn.callback_data.startsWith(oldPrefix)) return btn;
                const next = btn.callback_data.substring(oldPrefix.length);
                if (next !== "y" && next !== "n") return btn;
                const flipped = next === "y" ? "n" : "y";

                const oldIcon = btn.text.startsWith("🙂")
                    ? "🙂"
                    : (btn.text.startsWith("🫥") ? "🫥" : "");

                if (!oldIcon) {
                    return { ...btn, callback_data: `${oldPrefix}${flipped}` };
                }

                const newIcon = oldIcon === "🙂" ? "🫥" : "🙂";
                const restText = btn.text.substring(oldIcon.length);
                return {
                    ...btn,
                    text: `${newIcon}${restText}`,
                    callback_data: `${oldPrefix}${flipped}`,
                };
            })
        );

        optimisticKeyboard = newKb;
        optimisticSucceeded = await safeEditMessageReplyMarkup(chatId, messageId, newKb);
    };

    await tryOptimisticToggle();

    try {
        if (action === "a" && player_id && arg) {
            const attended = arg === "y";
            const { error: upsertErr } = await supabaseAdmin
                .from("attendances")
                .upsert(
                    { session: specificSlot, player_id, attended },
                    { onConflict: "session,player_id" },
                );
            if (upsertErr) {
                console.error(upsertErr);
                throw upsertErr;
            }

            tAfterWrite = Date.now();
        }

        if (action === "m" && player_id && arg) {
            const [valid, amount] = tryParseAmount(arg);
            if (!valid) {
                return ctx.answerCallbackQuery({ text: "Monto invalido" });
            }

            const chatId = ctx.callbackQuery.message?.chat?.id;
            const messageId = ctx.callbackQuery.message?.message_id;
            if (!chatId || !messageId) {
                return ctx.editMessageText("Error al determinar chat_id/message_id");
            }

            const paymentId = await _uuidv5(
                "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
                `telegram:asistpago:${chatId}:${messageId}:${player_id}:${selectedMonth}:${genericSlot}`,
            );

            const registeredBy = telegramRegisteredBy(ctx);
            const { error: insertErr } = await supabaseAdmin
                .from("payments")
                .insert([{
                    id: paymentId,
                    player_id,
                    registered_by: registeredBy,
                    slot: genericSlot,
                    concept: "monthly",
                    month: selectedMonth,
                    amount,
                    is_cash: true,
                }]);

            if (insertErr) {
                if (insertErr.code === "23505") {
                    await ctx.answerCallbackQuery({ text: "Pago ya registrado" });
                } else {
                    console.error(insertErr);
                    throw insertErr;
                }
            }

            tAfterWrite = Date.now();
        }

        const kb = await buildAsistPagoKeyboard(
            specificSlot,
            genericSlot,
            cats,
            dateCompact,
            hs,
            expandedPlayerId,
        );

        tAfterBuildKb = Date.now();

        if (
            action === "a" && optimisticSucceeded && optimisticKeyboard &&
            inlineKeyboardEquals((kb as unknown as InlineKeyboard).inline_keyboard, optimisticKeyboard)
        ) {
            const tDone = Date.now();
            console.log(
                `asistpago_timing action=${action ?? "(none)"} write=${tAfterWrite - t0}ms buildKb=${tAfterBuildKb - tAfterWrite}ms edit=0ms total=${tDone - t0}ms (skipped_rerender_equal)`,
            );
            console.log(
                `asistpago_full_timing action=${action ?? "(none)"} answerCbq=${tAfterAnswer - t0Full}ms handler=${tDone - tAfterAnswer}ms fullTotal=${tDone - t0Full}ms (skipped_rerender_equal)`,
            );
            return;
        }

        const res = await safeEditMessageText(
            ctx,
            attendanceMessage("_Ajuste asistencia:_"),
            {
                reply_markup: kb,
                parse_mode: "MarkdownV2",
            },
        );

        const tAfterEdit = Date.now();
        console.log(
            `asistpago_timing action=${action ?? "(none)"} write=${tAfterWrite - t0}ms buildKb=${tAfterBuildKb - tAfterWrite}ms edit=${tAfterEdit - tAfterBuildKb}ms total=${tAfterEdit - t0}ms`,
        );
        console.log(
            `asistpago_full_timing action=${action ?? "(none)"} answerCbq=${tAfterAnswer - t0Full}ms handler=${tAfterEdit - tAfterAnswer}ms fullTotal=${tAfterEdit - t0Full}ms`,
        );
        return res;
    } catch {
        return ctx.editMessageText(
            "Error al procesar la accion. Reintente.",
            NoKeyboard,
        );
    }
}

async function cbAsistenciaPagoPayOther(ctx: CallbackQueryContext<Context>) {
    const [, dateCompact, hs, player_id] = ctx.match;
    const isoDate = compactDateToIso(dateCompact);
    console.log(`Callback asistpago custom amount: ${isoDate} ${hs} ${player_id}`);

    const messageId = ctx.callbackQuery.message?.message_id;
    if (!messageId) {
        return ctx.editMessageText("Error: no se pudo determinar message_id");
    }

    await ctx.answerCallbackQuery();
    return bot.api.sendMessage(
        ctx.chat!.id,
        `ASISTPAGO_CTX: ${isoDate} ${hs} ${player_id} ${messageId}\n` +
            "Escriba monto en miles (ej: 60):",
        {
            reply_markup: { force_reply: true },
        },
    );
}

const playersCacheByCatsKey = new Map<
    string,
    { ts: number; players: Array<Pick<Player, "id" | "name" | "last_name">> }
>();

function isoDateToCompact(isoDate: string) {
    return isoDate.replaceAll("-", "");
}

function compactDateToIso(compact: string) {
    return `${compact.substring(0, 4)}-${compact.substring(4, 6)}-${compact.substring(6, 8)}`;
}

async function buildAsistPagoKeyboard(
    specificSlot: string,
    genericSlot: string,
    cats: string[],
    dateCompact: string,
    hs: string,
    expandedPlayerId?: string,
): Promise<InlineKeyboard> {
    const t0 = Date.now();
    let tAfterPlayers = t0;
    let tAfterFetches = t0;
    let tAfterProcess = t0;
    let tAfterKb = t0;
    let playersCacheHit = false;

    const paymentThresholdForSlot = (isoDate: string, slot: string): number => {
        void isoDate;
        void slot;
        return 100;
    };

    const catsKey = [...cats].sort().join(",");
    const cachedPlayers = playersCacheByCatsKey.get(catsKey);
    const cacheTtlMs = 5 * 60 * 1000;
    let players: Array<Pick<Player, "id" | "name" | "last_name">> | null = null;

    if (cachedPlayers && (Date.now() - cachedPlayers.ts) < cacheTtlMs) {
        playersCacheHit = true;
        players = cachedPlayers.players;
        tAfterPlayers = Date.now();
    } else {
        const { data: playersData, error } = await supabaseAdmin
            .from("players")
            .select("id,name,last_name")
            .in("category", cats)
            .order("last_name")
            .order("name");
        tAfterPlayers = Date.now();
        if (error) {
            console.error(error);
            return new InlineKeyboard().row().text("Finalizar", "cancelar");
        }
        players = playersData;
        if (players) {
            playersCacheByCatsKey.set(catsKey, { ts: Date.now(), players });
        }
    }

    if (!players || players.length === 0) {
        return new InlineKeyboard().row().text("Finalizar", "cancelar");
    }

    const playerIds = players.map((p) => p.id);

    const isoDate = compactDateToIso(dateCompact);
    const selectedMonth = isoDate.substring(0, 7);
    const monthStart = new Date(`${isoDate.substring(0, 7)}-01T00:00:00.000Z`);
    const nextMonthStart = new Date(monthStart);
    nextMonthStart.setUTCMonth(nextMonthStart.getUTCMonth() + 1);
    const monthStartNoon = new Date(`${selectedMonth}-01T12:00:00.000Z`);
    const selectedDayStartNoon = new Date(`${isoDate}T12:00:00.000Z`);
    const expectedWeekday = selectedDayStartNoon.getUTCDay();
    const [payRes, monthAttRes] = await Promise.all([
        supabaseAdmin
            .from("payments")
            .select("player_id,amount,concept,slot,session,month")
            .in("player_id", playerIds)
            .eq("month", selectedMonth)
            .eq("slot", genericSlot),
        supabaseAdmin
            .from("attendances")
            .select("player_id,attended,session")
            .in("player_id", playerIds)
            .eq("attended", true)
            // Only fetch attendances for this month AND this hour to avoid scanning unrelated sessions
            .like("session", `${selectedMonth}-% ${hs}hs`),
    ]);
    tAfterFetches = Date.now();
    if (payRes.error) {
        console.error(payRes.error);
        return new InlineKeyboard().row().text("Finalizar", "cancelar");
    }

    if (monthAttRes.error) {
        console.error(monthAttRes.error);
        return new InlineKeyboard().row().text("Finalizar", "cancelar");
    }

    const attendees = (monthAttRes.data ?? [])
        .filter((_) => _.session === specificSlot)
        .map((_) => _.player_id);
    const payments = payRes.data;

    const parseSpecificSessionFast = (s: string): { isoDate: string; hour: string } | null => {
        // Expected format from toSpecificSlot(): YYYY-MM-DD HHhs
        // Use fixed positions to avoid regex/split overhead in hot loops.
        if (s.length < 14) return null;
        if (s[4] !== "-" || s[7] !== "-" || s[10] !== " ") return null;
        const iso = s.slice(0, 10);
        const hour = s.slice(11, 13);
        if (s.slice(13, 15) !== "hs") return null;
        return { isoDate: iso, hour };
    };

    const isPresent = (p: Player) => attendees.includes(p.id);

    const attendedCountThisMonthByPlayerId = new Map<string, number>();
    for (
        const row of (monthAttRes.data ?? []) as Array<
            { player_id: string; attended?: boolean; session?: string | null }
        >
    ) {
        if (!row.session) continue;
        const parsed = parseSpecificSessionFast(row.session);
        if (!parsed) continue;
        if (parsed.hour !== hs) continue;
        const d = new Date(`${parsed.isoDate}T12:00:00.000Z`);
        if (d.getUTCDay() !== expectedWeekday) continue;
        if (d < monthStartNoon) continue;
        if (d >= selectedDayStartNoon) continue;
        attendedCountThisMonthByPlayerId.set(
            row.player_id,
            (attendedCountThisMonthByPlayerId.get(row.player_id) ?? 0) + 1,
        );
    }

    const paidAmountByPlayerId = new Map<string, number>();
    for (
        const row of (payments ?? []) as Array<
            { player_id: string; amount?: number | string; concept?: string; slot?: string | null; session?: string | null }
        >
    ) {
        const pid = row.player_id;
        const amt = Number(row.amount ?? 0);
        paidAmountByPlayerId.set(pid, (paidAmountByPlayerId.get(pid) ?? 0) + amt);
    }

    tAfterProcess = Date.now();

    const paidAmount = (p: Player) => paidAmountByPlayerId.get(p.id) ?? 0;
    const yn = (p: Player) => isPresent(p) ? "n" : "y";
    const attendIcon = (p: Player) => isPresent(p) ? "🙂" : "🫥";

    const threshold = paymentThresholdForSlot(isoDate, genericSlot);
    const meetsThreshold = (p: Player) => paidAmount(p) >= threshold;

    const firstSlotDayThisMonthISO = (() => {
        const firstDayNoon = new Date(`${isoDate.substring(0, 7)}-01T12:00:00.000Z`);
        const firstSlotDay = searchNextDayWithSlots(firstDayNoon, true);
        return firstSlotDay.toISOString().substring(0, 10);
    })();
    const showMonthAttendanceCount = isoDate !== firstSlotDayThisMonthISO;

    const payIcon = (p: Player) => {
        const amt = paidAmount(p);
        if (amt <= 0) return "Registrar Pago";
        if (amt < threshold) return `⚠️ ${amt}`;
        return `💶 ${amt}`;
    };
    const anyMonthAttendanceCountShown = showMonthAttendanceCount &&
        players.some((p) =>
            !meetsThreshold(p) && (attendedCountThisMonthByPlayerId.get(p.id) ?? 0) > 0
        );

    const owingPlayers = players.filter((p) => !meetsThreshold(p));
    const paidPlayers = players.filter((p) => meetsThreshold(p));

    const shortenLastName = (last: string): string => {
        if (last === "Burgess-Webb") return "Burgess-W";
        if (last === "Burguess-Webb") return "Burguess-W";
        return last;
    };

    const shortenFirstName = (name: string): string => {
        if (name === "Maximiliano") return "Maxi";
        return name;
    };

    const addPlayerRow = (acc: InlineKeyboard, p: Player) => {
        const monthCt = attendedCountThisMonthByPlayerId.get(p.id) ?? 0;
        const countLbl = (showMonthAttendanceCount && !meetsThreshold(p) && monthCt > 0)
            ? ` (${monthCt})`
            : "";
        const lastNameLbl = shortenLastName(p.last_name);
        const firstNameLbl = shortenFirstName(p.name);
        const nameLbl = `${lastNameLbl}, ${firstNameLbl}${countLbl} `;
        acc = acc.row()
            .text(`${attendIcon(p)} ${nameLbl}`, `ap|${dateCompact}|${hs}|a|${p.id}|${yn(p)}`);
        acc = acc.text(payIcon(p), `ap|${dateCompact}|${hs}|x|${p.id}`);

        if (expandedPlayerId && expandedPlayerId === p.id) {
            acc = acc.row()
                .text("100k", `ap|${dateCompact}|${hs}|m|${p.id}|100`)
                .text("75k", `ap|${dateCompact}|${hs}|m|${p.id}|75`)
                .text("50k", `ap|${dateCompact}|${hs}|m|${p.id}|50`)
                .text("30k", `ap|${dateCompact}|${hs}|m|${p.id}|30`)
                .text("Otro", `ap|${dateCompact}|${hs}|o|${p.id}`);
        }
        return acc;
    };

    let kb = new InlineKeyboard();
    kb = kb.row().text("Summary", "noop").primary();
    const dateNoon = new Date(`${isoDate}T12:00:00.000Z`);
    const catsLbl = cats.map(categorySlugToLabel);
    const catLbl = catsLbl.length === 1 ? `Categoria ${catsLbl[0]}` : `Categorias ${catsLbl.join(",")}`;
    kb = kb.row().text(`${catLbl}  |  ${strDate(dateNoon)}, ${hs}hs`, "noop");
    if (anyMonthAttendanceCountShown) {
        kb = kb.row().text("(n) » Vinieron pero no pagaron", "noop");
    }
    kb = kb.row().text("--- Deben: ---", "noop").danger();
    kb = owingPlayers.reduce(addPlayerRow, kb);

    if (paidPlayers.length > 0) {
        kb = kb.row().text("--- Pagaron: ---", "noop").success();
        kb = paidPlayers.reduce(addPlayerRow, kb);
    }
    kb = kb.row().text("Atras", `apd|${dateCompact}`).primary();
    kb = kb.text("Finalizar", "cancelar").primary();

    tAfterKb = Date.now();
    console.log(
        `asistpago_buildkb_timing players=${players.length} att=${attendees.length} pay=${payRes.data?.length ?? 0} monthAtt=${monthAttRes.data?.length ?? 0} cacheHit=${playersCacheHit} ` +
            `playersQ=${tAfterPlayers - t0}ms fetchQ=${tAfterFetches - tAfterPlayers}ms process=${tAfterProcess - tAfterFetches}ms kb=${tAfterKb - tAfterProcess}ms total=${tAfterKb - t0}ms`,
    );
    return kb;
}

function cbAsistenciaJugador(ctx: CallbackQueryContext<Context>) {
    const [, dateText, slot, player, attends] = ctx.match;
    console.log(
        `Callback asistencia - jugador: ${dateText} at ${slot} player ${player} attends? ${attends}`,
    );

    // TODO mostrar categorias
}

function slotsForDay(date: Date): string[] {
    return (date.getDay() === 4)
        ? ["21", "22", "23"]
        : [];
}

function searchPrevDayWithSlots(someDate: Date, includeCurrent = false) {
    const date = new Date(someDate);
    if (!includeCurrent) {
        date.setDate(date.getDate() - 1);
    }
    for (let i = 0; i < 14; i++) {
        if (slotsForDay(date).length > 0) return date;
        date.setDate(date.getDate() - 1);
    }
    return date;
}

function searchNextDayWithSlots(someDate: Date, includeCurrent = false) {
    const date = new Date(someDate);
    if (!includeCurrent) {
        date.setDate(date.getDate() + 1);
    }
    for (let i = 0; i < 14; i++) {
        if (slotsForDay(date).length > 0) return date;
        date.setDate(date.getDate() + 1);
    }
    return date;
}

function keyboardForChooseSession(date: Date) {
    const noonDate = new Date(Date.parse(`${date.toISOString().substring(0, 10)}T12:00:00`));
    const prevSlotDay = searchPrevDayWithSlots(noonDate);
    const prevDateISO = `${prevSlotDay.toISOString().substring(0, 10)}`;

    const slots = slotsForDay(date);

    const dateISO = date.toISOString().substring(0, 10);
    return slots.reduce(
        (kb, slot) =>
            kb.row().text(
                `${slot}hs`,
                `${CmdAsist} ${dateISO} ${slot}`,
            ),
        new InlineKeyboard().text(
            strDate(date),
            `${CmdAsist} dummy`,
        ),
    ).row()
        .text(`« Dia anterior`, `${CmdAsist} ${prevDateISO}`)
        .text("Cancelar", "cancelar");
}

function keyboardForChooseSessionWithCmd(cmd: string, date: Date) {
    const noonDate = new Date(Date.parse(`${date.toISOString().substring(0, 10)}T12:00:00`));
    const prevSlotDay = searchPrevDayWithSlots(noonDate);
    const prevDateISO = `${prevSlotDay.toISOString().substring(0, 10)}`;

    const slots = slotsForDay(date);

    const dateISO = date.toISOString().substring(0, 10);
    return slots.reduce(
        (kb, slot) =>
            kb.row().text(
                `${slot}hs`,
                `${cmd} ${dateISO} ${slot}`,
            ),
        new InlineKeyboard().text(
            strDate(date),
            `${cmd} dummy`,
        ),
    ).row()
        .text(`« Dia anterior`, `${cmd} ${prevDateISO}`)
        .text("Cancelar", "cancelar");
}

function keyboardForChooseSessionAsistPago(date: Date) {
    const noonDate = new Date(Date.parse(`${date.toISOString().substring(0, 10)}T12:00:00`));
    const prevSlotDay = searchPrevDayWithSlots(noonDate);
    const prevDateISO = `${prevSlotDay.toISOString().substring(0, 10)}`;
    const prevDateCompact = isoDateToCompact(prevDateISO);

    const nextSlotDay = searchNextDayWithSlots(noonDate);
    const nextDateISO = `${nextSlotDay.toISOString().substring(0, 10)}`;
    const nextDateCompact = isoDateToCompact(nextDateISO);

    const slots = slotsForDay(date);

    const dateISO = date.toISOString().substring(0, 10);
    const dateCompact = isoDateToCompact(dateISO);

    return slots.reduce(
        (kb, slot) => kb.row().text(`${slot}hs`, `ap|${dateCompact}|${slot}`),
        new InlineKeyboard().text(strDate(date), `apd|${dateCompact}`),
    ).row()
        .text(`« Antes`, `apd|${prevDateCompact}`)
        .text("Finalizar", "cancelar")
        .text(`Despues »`, `apd|${nextDateCompact}`);
}

function attendanceMessage(msg: string, h: Partial<HeaderAttendance> = {}) {
    return `*${TitleAttendance}*\n` +
        escape(
            (h.day ? `Dia: ${h.day}\n` : "") +
                (h.slot ? `Horario: ${h.slot}\n` : "") +
                (h.categories ? `Categorias: ${h.categories}\n` : "") +
                "\n",
        ) + msg;
}

function parseAttendanceMessage(text: string): Partial<HeaderAttendance> {
    const RegexDay = /^Dia: (\d\d\d\d-\d\d-\d\d)$/;
    const RegexSlot = /^Horario: (\d\d)$/;
    const RegexCategories = /^Categorias: ([a-zA-Z0-9-_]+)$/;

    const mapOrEmpty = <T>(
        regex: RegExp,
        text: string,
        arrayToJson: (array: string[]) => T,
    ) => regex.test(text) ? arrayToJson(regex.exec(text)!) : {};

    const [, l1, l2, l3] = text.split("\n");

    const jsonDay = mapOrEmpty(RegexDay, l1, (arr) => ({
        day: arr[1],
    }));

    const jsonSlot = mapOrEmpty(RegexSlot, l2, (arr) => ({
        slot: Number(arr[1]),
    }));

    const jsonCategories = mapOrEmpty(RegexCategories, l3, (arr) => ({
        categories: arr[1].split(","),
    }));

    return {
        ...jsonDay,
        ...jsonSlot,
        ...jsonCategories,
    };
}

// ////////////////////////////////////
// DEFAULT MESSAGE HANDLER
// ////////////////////////////////////

async function OnMessage(
    ctx: Filter<Context, "message">,
): Promise<Message.TextMessage> {
    const repliedText = ctx.update.message?.reply_to_message?.text;
    if (repliedText) {
        if (repliedText.includes("ASISTPAGO_CTX:") || repliedText.includes("ASISTPAGO\\_CTX:")) {
            const match = new RegExp(
                `ASISTPAGO\\_?CTX: (${rDate}) (\\d\\d) (${rUuid}) (\\d+)`,
                "i",
            ).exec(repliedText);
            if (!match) {
                return reply(ctx, "Error: contexto asistpago invalido");
            }
            const [, isoDate, hs, player_id, rosterMessageIdStr] = match;
            const rosterMessageId = Number.parseInt(rosterMessageIdStr, 10);

            const [valid, amount] = ctx.message?.text
                ? tryParseAmount(ctx.message.text)
                : [false, -1];
            if (!valid) {
                return reply(ctx, "Monto ingresado no valido");
            }

            const selectedMonth = isoDate.substring(0, 7);
            const genericSlot = toGenericSlot(isoDate, hs);
            const cats = slotToCat(genericSlot);
            const paymentId = await _uuidv5(
                "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
                `telegram:asistpago:${ctx.chat!.id}:${rosterMessageId}:${player_id}:${selectedMonth}:${genericSlot}`,
            );

            const registeredBy = telegramRegisteredBy(ctx);
            const { error: insertErr } = await supabaseAdmin
                .from("payments")
                .insert([{
                    id: paymentId,
                    player_id,
                    registered_by: registeredBy,
                    slot: genericSlot,
                    concept: "monthly",
                    month: selectedMonth,
                    amount,
                    is_cash: true,
                }]);

            if (insertErr) {
                if (insertErr.code === "23505") {
                    // Duplicate send: payment already registered
                    return reply(ctx, "Pago ya registrado");
                }
                console.error(insertErr);
                return reply(ctx, "Error al registrar pago");
            }

            const specificSlot = toSpecificSlot(isoDate, hs);
            const kb = await buildAsistPagoKeyboard(
                specificSlot,
                genericSlot,
                cats,
                isoDateToCompact(isoDate),
                hs,
            );
            await bot.api.editMessageText(
                ctx.chat!.id,
                rosterMessageId,
                attendanceMessage("_Ajuste asistencia:_"),
                {
                    parse_mode: "MarkdownV2",
                    reply_markup: kb,
                },
            );

            return reply(ctx, "Pago registrado");
        }

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
    ctx: Context,
    msg: string,
) {
    // deno-lint-ignore no-explicit-any
    if ((ctx.update as any).test) {
        return;
    }
    return ctx.reply(msg);
}

async function safeEditMessageText(
    ctx: CallbackQueryContext<Context>,
    text: string,
    extra: Parameters<CallbackQueryContext<Context>["editMessageText"]>[1],
) {
    try {
        return await ctx.editMessageText(text, extra);
    } catch (err) {
        const msg = String(err);
        if (msg.includes("message is not modified")) {
            try {
                return await ctx.answerCallbackQuery();
            } catch {
                return;
            }
        }
        throw err;
    }
}

async function safeEditMessageReplyMarkup(
    chatId: number,
    messageId: number,
    inline_keyboard: InlineKeyboardButton[][],
) {
    try {
        await bot.api.editMessageReplyMarkup(
            chatId,
            messageId,
            { reply_markup: { inline_keyboard } },
        );
        return true;
    } catch {
        return false;
    }
}

function inlineKeyboardEquals(
    a: InlineKeyboardButton[][] | undefined,
    b: InlineKeyboardButton[][],
): boolean {
    if (!a) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        const ar = a[i];
        const br = b[i];
        if (ar.length !== br.length) return false;
        for (let j = 0; j < ar.length; j++) {
            const ab = ar[j] as unknown as { text?: string; callback_data?: string };
            const bb = br[j] as unknown as { text?: string; callback_data?: string };
            if ((ab.text ?? "") !== (bb.text ?? "")) return false;
            if ((ab.callback_data ?? "") !== (bb.callback_data ?? "")) return false;
        }
    }
    return true;
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

type HeaderAttendance = {
    day: string;
    slot: number;
    categories: string[];
};

type Attendance = {
    session: string;
    player_id: string;
    attended: boolean;
};

type Player = {
    id: string;
    name: string;
    last_name: string;
    payments?: Payment[];
};

type Payment = {
    id: string;
    player_id: string;
    amount: number;
};

async function _uuidv5(namespace: string, name: string): Promise<string> {
    const nsBytes = uuidToBytes(namespace);
    const nameBytes = new TextEncoder().encode(name);

    const data = new Uint8Array(nsBytes.length + nameBytes.length);
    data.set(nsBytes, 0);
    data.set(nameBytes, nsBytes.length);

    const hash = new Uint8Array(await crypto.subtle.digest("SHA-1", data));
    const bytes = hash.slice(0, 16);

    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    return bytesToUuid(bytes);
}

function uuidToBytes(uuid: string): Uint8Array {
    const hex = uuid.replaceAll("-", "");
    if (hex.length !== 32) throw new Error(`Invalid UUID: ${uuid}`);
    const bytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
        bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}

function bytesToUuid(bytes: Uint8Array): string {
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20, 32)}`;
}

type Middleware<T> = (ctx: CommandContext<Context>) => Promise<T>;

// ////////////////////////////////////
// HELPERS
// ////////////////////////////////////

function selectCategoriesKeyboard(cmd: string) {
    return new InlineKeyboard()
        .text("Menores", `${cmd} cat u-14`)
        .row().text("Cat A (jue 21hs)", `${cmd} cat cat-a`)
        .row().text("Cat B (jue 22hs)", `${cmd} cat cat-b`)
        .row().text("Cat C (jue 23hs)", `${cmd} cat cat-c`)
        .row().text("Cancelar", "cancelar");
}

function categorySlugToLabel(c: string): string {
    if (c === "cat-a") return "A";
    if (c === "cat-b") return "B";
    if (c === "cat-c") return "C";
    return c;
}

function telegramRegisteredBy(ctx: Context): string {
    try {
        const from = ctx.from;
        if (!from) return "[unknown]";
        const name = `${from.first_name}${from.last_name ? ` ${from.last_name}` : ""}`;
        const uname = from.username ? `@${from.username}` : "";
        return `${name}${uname ? ` (${uname})` : ""} [id=${from.id}]`;
    } catch (error) {
        console.error(error);
        return "[unknown]";
    }
}

function catchAll<C extends CommandContext<Context> | CallbackQueryContext<Context>, T>(
    f: (ctx: C) => Promise<T>,
): (ctx: C) => Promise<T | Message.TextMessage> {
    return async (ctx: C) => {
        try {
            return await f(ctx);
        } catch (error: unknown) {
            console.error(error);
            const msg = error instanceof Error ? error.message : String(error);
            return await ctx.reply(
                `Error while executing handler: ${msg}`,
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

// returns: "jue 3"
function toString(date: Date): string {
    return date.toLocaleString("es-AR", {
        weekday: "short",
        day: "numeric",
    });
}

// returns: "Hoy" | "jueves, 3 de marzo"
function strDate(d: Date) {
    return (d.toLocaleDateString() == new Date().toLocaleDateString())
        ? `Hoy (${d.toLocaleDateString("es-AR", { month: "long", day: "numeric" })})`
        : d.toLocaleDateString("es-AR", {
            weekday: "long",
            day: "numeric",
            month: "long",
        });
}

function toISODate(date: Date) {
    return date.toISOString().substring(0, 10);
}

function catToSlot(category: string): string {
    switch (category) {
        case "cat-a":
            return "jue 21hs";
        case "cat-b":
            return "jue 22hs";
        case "cat-c":
            return "jue 23hs";
        case "u-14":
            return "dom 11hs";
        default:
            throw new Error(`Unexpected category ${category}`);
    }
}

function slotToCat(slot: string): string[] {
    switch (slot) {
        case "jue 21hs":
            return ["cat-a"];
        case "jue 22hs":
            return ["cat-b"];
        case "jue 23hs":
            return ["cat-c"];
        case "dom 11hs":
            return ["u-14"];
        default:
            throw new Error(`Unexpected slot ${slot}`);
    }
}

function toSpecificSlot(isoDate: string, hour: string): string {
    // Must uniquely identify a single training session.
    // Using weekday+day-of-month caused collisions across months (e.g. 2026-03-05 vs 2026-02-05).
    return `${isoDate} ${hour}hs`;
}

function toGenericSlot(isoDate: string, hour: string): string {
    const date = new Date(`${isoDate}T${hour}:00`);
    return date.toLocaleString("es-AR", {
        weekday: "short",
        hour: "numeric",
        hour12: false,
    }).replace(",", "") + "hs";
}
