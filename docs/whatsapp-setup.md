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
  agenda is the `ACTIVE_MONTHS` list in `whatsapp-webhook/status.ts` — extend it each
  semester; months not listed there (e.g. July) never appear. Each month line reads
  attendance / payment, and the icon says whether the money covers the attendance
  (a monthly payment always does; partial payments cover `total / SESSION_PRICE`
  sessions). Full-scholarship players only get their attendance reported.
- **Guardian** (wa_id matches `players.guardian_phone`): one section per player in
  their care, in third person.
- **Admin** (wa_id matches `users.phone`): greeting plus a single-use magic link into
  the dashboard (15 minutes, hash-stored in `whatsapp_login_tokens`).
- Someone who is both gets both sections in one message; an unknown number gets
  "Hola! Te conozco?".

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
