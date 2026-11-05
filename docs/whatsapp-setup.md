# WhatsApp Cloud API setup

Public entrypoint for members and admins. Single-response bot: any inbound message
gets one reply built from the sender's identity, resolved by phone (players.phone /
players.guardian_phone / users.phone). No menu, no flows, no conversation state.

## Cost

- Inbound message → our free-form replies within the 24h customer service window: **free**.
- Utility templates sent *inside* an open 24h window: **free**.
- Business-initiated messages outside the window (e.g. "tu cuota vence el viernes"):
  **paid per message per recipient**. Check Meta's current Argentina rate card.
- The Cloud API itself has no platform fee. Supabase edge function invocations for this
  volume sit inside the free tier.

The only guaranteed cost is the SIM.

## The phone number

- Must be able to receive an SMS or voice call once, for verification.
- Must **not** already be registered on WhatsApp or WhatsApp Business. If it is, delete
  that account first.
- Once migrated to the Cloud API it can no longer be used in the consumer apps at all.
  Do not use a number members already message.
- Avoid VoIP/virtual numbers — WhatsApp rejects many known ranges. A cheap prepaid
  physical SIM is the reliable path. Keep the line alive in case re-verification is needed.

You do not need the SIM to start. Meta provides a free test number that can message up to
5 whitelisted recipients — enough to build and debug everything first.

## Meta setup

1. Create an app at developers.facebook.com (type: Business) and add the **WhatsApp** product.
2. From **WhatsApp > API Setup**, note the **Phone number ID** and the test number.
3. Create a **System User** in Business Settings with a permanent access token scoped to
   `whatsapp_business_messaging` and `whatsapp_business_management`. The 24h token shown in
   the setup panel expires after 24h and then every send fails with OAuth error 190;
   only use it for a quick smoke test.
4. Under **App Settings > Basic**, copy the **App Secret** — this signs the webhooks.
5. Business verification is free but takes days and may need resubmission. Have the
   asociación civil's legal documents ready. Unverified businesses are capped on
   *business-initiated* conversations (currently 250/24h); inbound replies are unaffected,
   so the reply-to-inbound bot works fully before verification completes.

## Environment variables

Add to `supabase/functions/.env`:

```
WHATSAPP_APP_SECRET=        # App Settings > Basic > App Secret
WHATSAPP_VERIFY_TOKEN=      # any random string you invent; used only for the handshake
WHATSAPP_ACCESS_TOKEN=      # System User permanent token
WHATSAPP_PHONE_NUMBER_ID=   # WhatsApp > API Setup
WHATSAPP_GRAPH_VERSION=     # optional, defaults to the value in index.ts
```

## Webhook registration

The function must be publicly reachable over HTTPS. Locally, reuse the cloudflared tunnel
from `scripts/startup-local-env.sh`; in production point Meta at the deployed function URL.

In **WhatsApp > Configuration > Webhook**, set:

- Callback URL: `https://<host>/functions/v1/whatsapp-webhook`
- Verify token: the same value as `WHATSAPP_VERIFY_TOKEN`

Meta immediately sends a `GET` with `hub.challenge`; the function echoes it back. Then
subscribe to the **`messages`** field — without that subscription no inbound messages arrive.

`config.toml` sets `verify_jwt = false` because Meta does not send a Supabase JWT. The
`X-Hub-Signature-256` HMAC check is what authenticates requests, so `WHATSAPP_APP_SECRET`
must be set — the function returns 500 rather than accepting unsigned traffic without it.

## The reply

Whatever the message says, the sender gets one reply, composed by `handleIncoming`:

- **Player** (wa_id matches `players.phone`): greeting plus their payment/attendance
  record for the last up-to-3 active months of the current semester. The activity
  agenda derives from the `training_slots` table (a month is active when it has at
  least one training), and tariffs come from the `prices` table: singles vs the
  prepaid rate for buying a whole month, whose price is therefore the slot's
  trainings x prepaid rate (no bundle under 2 trainings). Each month line reads
  attendance / payment; the icon reflects the semester ledger: prepaid months are
  use-it-or-lose-it, unpaid attendance becomes single-rate debt, payments settle
  the current month first and old debt next, and only money paid beyond the
  month's capacity (the club's fault: a holiday miscount, a cancelled training)
  becomes bonified sessions for the following month. Closing lines report
  bonified sessions and "Deuda pendiente". Full-scholarship players only get
  their attendance reported.
- **Guardian** (wa_id matches `players.guardian_phone`): one section per player in
  their care, in third person.
- **Admin** (wa_id matches `users.phone`): greeting plus a single-use magic link into
  the dashboard (15 minutes, hash-stored in `whatsapp_login_tokens`).
- Someone who is both gets both sections in one message; an unknown number gets
  "Hola! Te conozco?".
- Whoever's message reached the Telegram group also gets "Le pasamos tu mensaje
  al club.". While the club is answering from the group (it wrote in the last
  24h), there is no automatic reply at all (see below).

Identity note: an inbound `wa_id` arrives Meta-signed and is matched against phone
columns we curate, so it is as trustworthy as a login. Names in replies come from our
tables, never from the sender-controlled profile name. Handlers must stay idempotent —
`whatsapp_processed_messages` guards redeliveries, but only after a successful insert.

The old menu/flows engine (and its `whatsapp_sessions` state) was removed in favor of
this single response; the `whatsapp_sessions` table still exists but is unused.

## Testing with the Meta test number

1. **Whitelist your personal number**: WhatsApp > API Setup, "To" field → Manage phone
   number list → add your number, confirm the code you receive on WhatsApp. Up to 5.
2. **Local stack**: `supabase start`, then
   `supabase functions serve whatsapp-webhook --env-file supabase/functions/.env`, and
   expose it with `cloudflared tunnel --url http://127.0.0.1:54321`. Point the webhook
   (WhatsApp > Configuration) at
   `https://<tunnel>.trycloudflare.com/functions/v1/whatsapp-webhook`.
3. **Find your exact wa_id**: message the bot once and read it back —
   `SELECT wa_id FROM whatsapp_processed_messages ORDER BY processed_at DESC LIMIT 1;`
   Argentine numbers arrive as `549...`. Never type it by hand: store what Meta sends.
4. **Map your wa_id to roles**: `UPDATE users SET phone = '<wa_id>' WHERE ...` to test
   the admin reply, `UPDATE players SET phone/guardian_phone = '<wa_id>' WHERE ...` to
   test the player reply.
5. For the magic link to point at your dev server, set `DASHBOARD_URL` in the env file
   (defaults to the production URL).

## Production checklist

- Secrets (`supabase secrets set NAME=value`; the function restarts on its own):
  `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN` (the
  **permanent System User token** — the panel's 24h token dies with OAuth error 190),
  `WHATSAPP_PHONE_NUMBER_ID` (the number's own id, not the WABA id), and optionally
  `DASHBOARD_URL`.
- The System User must have the **WhatsApp account asset assigned** before generating
  the token, or sends fail with error 190 even with a fresh token. Validate a token
  with `curl -s "https://graph.facebook.com/v21.0/me" -H "Authorization: Bearer <t>"`.
- Deploy with `supabase functions deploy whatsapp-webhook`.
- Admin identity in prod is manual: set each admin's `users.phone` by hand.

## Recordatorio de deuda de los jueves

`supabase/functions/debt-reminders`. pg_cron la llama todos los jueves a las 11:00
UTC (8am en Buenos Aires). Si ese día no tiene `training_sessions`, no hace nada.
Si tiene, le escribe a cada jugador que deba algo: meses cerrados del período, el
mes en curso o los dos. Los montos son los mismos que muestra el dashboard
(deuda cerrada y saldo del mes). El mensaje va al teléfono del jugador **y** al
del tutor. Las becas completas no reciben nada.

Cada envío queda en `whatsapp_reminders`, con una fila por (día, jugador,
teléfono), lo que se le dijo y si Meta lo aceptó. Una corrida repetida no le
escribe dos veces a nadie, y los envíos fallidos se reintentan.

### El template

Un mensaje que inicia el club, fuera de la ventana de 24h, tiene que ser un
template aprobado, y Meta cobra cada uno. Se crea en **WhatsApp Manager >
Message templates**:

- Nombre: `recordatorio_deuda`, categoría **Utility**, idioma **Spanish (ARG)** (`es_AR`)
- Cuerpo:

  ```
  Hola! Te escribimos del club porque {{1}} tiene un saldo pendiente de {{2}}. Hoy hay entrenamiento y se puede regularizar ahí. Si ya está pago, respondé este mensaje y lo revisamos.
  ```

- Ejemplos para la revisión: `{{1}}` = `tu cuenta`, `{{2}}` = `$30.000 de meses anteriores y $35.000 de noviembre`

`{{1}}` es `tu cuenta` para el jugador y `la cuenta de <nombre>` para el tutor. Si
el template se aprueba con otro nombre o idioma, se cambia con
`WHATSAPP_REMINDER_TEMPLATE` / `WHATSAPP_REMINDER_LANGUAGE`. Hasta que esté
aprobado, cada envío falla y queda `failed` con el error de Meta.

Sin la verificación del negocio, Meta limita los mensajes que inicia el club a 250
por día. Los recordatorios entran de sobra.

### Puesta en producción

1. El secreto que comparten el cron y la función:

   ```
   SECRET=$(openssl rand -hex 32)
   supabase secrets set DEBT_REMINDERS_SECRET=$SECRET
   ```

2. El mismo secreto y la URL del proyecto en el vault (SQL editor):

   ```sql
   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
   select vault.create_secret('<SECRET>', 'debt_reminders_secret');
   ```

   Sin `project_url`, el job corre y no llama a nadie.

3. `supabase db push` (tabla y cron) y `supabase functions deploy debt-reminders --no-verify-jwt`.

4. Antes del primer jueves, revisar a quién le escribiría sin mandar nada:

   ```
   curl -s -X POST 'https://<ref>.supabase.co/functions/v1/debt-reminders' \
     -H "x-reminders-secret: $SECRET" -H 'content-type: application/json' \
     -d '{"dry": true, "date": "2026-11-12"}'
   ```

   `dry` calcula y devuelve la lista. `date` sólo se acepta junto con `dry`.

Para ver qué salió: `select * from whatsapp_reminders order by created_at desc;`
Las corridas del cron: `select * from cron.job_run_details order by start_time desc;`
Las respuestas de la función: `select * from net._http_response order by created desc;`

## Las conversaciones, en un grupo de Telegram con topics

El número vive en la Cloud API y no se puede abrir desde la app. Las
conversaciones se leen y se contestan en un supergrupo de Telegram con
**topics**, un topic por número.

**Cuando alguien escribe**, el webhook busca el topic de ese número. Si no hay,
lo crea, con el nombre del jugador, "Tutor de …" o el número. Si estaba cerrado,
lo reabre. Si alguien lo borró, crea otro. Después publica, en este orden:

1. un separador `━━━━  12/11  ━━━━`, si en el topic no hubo movimiento en las
   últimas 24h: marca dónde empieza una conversación nueva;
2. los recordatorios que esa persona recibió y el topic todavía no mostró, con el
   texto exacto que le llegó;
3. su mensaje. De un audio o una imagen solo llega el aviso.

**Un recordatorio no abre topic.** Se muestra la primera vez que la persona
escribe después de recibirlo. Si nunca contesta, el único rastro en Telegram es
el resumen del jueves, que va al topic General: enviados, fallidos y el error de
cada uno.

**Lo que el club escribe en el topic** le llega a esa persona por WhatsApp como un
mensaje del club, sin firma. Excepciones:

- lo que empieza con `//` es un comentario interno y queda en el grupo;
- fotos, audios y archivos no se reenvían; el bot avisa en el topic;
- WhatsApp solo deja escribir texto libre hasta 24h después del último mensaje
  de la persona. Un recordatorio **no** abre esa ventana. Pasadas las 24h, el bot
  avisa en el topic que no le llegó, y hay que esperar a que vuelva a escribir.

**La respuesta automática** (el registro de pagos) no sale mientras el club haya
escrito en el topic en las últimas 24h: alguien le está contestando. Fuera de eso,
a cada mensaje le sigue respondiendo como siempre, más "Le pasamos tu mensaje al
club.". Los mensajes de los admins, que escriben para pedir el link de login, no
van al grupo, salvo que estén contestando un recordatorio o que el club ya esté
hablando con ellos.

### Puesta en marcha

1. Crear un grupo en Telegram y activar **Topics** en la configuración del grupo
   (eso lo convierte en supergrupo).
2. Agregar al bot del club (el de `telegram-webhook`) y hacerlo **administrador**
   con permiso para **gestionar topics**. Siendo admin recibe todos los mensajes
   del grupo, no solo los comandos: es lo que necesita para reenviar lo que
   escriben en los topics.
3. Escribir `/chatid` en el grupo. El bot contesta el id (empieza con `-100`).
4. `supabase secrets set WHATSAPP_INBOX_TELEGRAM_CHAT_ID=<id>`. `TELEGRAM_BOT_TOKEN`
   y los de WhatsApp ya están cargados: los secretos son de todo el proyecto.
5. `supabase db push` y desplegar `whatsapp-webhook`, `telegram-webhook` y
   `debt-reminders`.

Fuera de los topics de conversaciones, el bot no contesta en el grupo lo que no
es un comando suyo.
