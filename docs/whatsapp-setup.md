# WhatsApp Cloud API setup

Public entrypoint for members. Admin operations stay on the Telegram bot — the two
channels share the database, not code.

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
5 whitelisted recipients — enough to build and debug every flow first.

## Meta setup

1. Create an app at developers.facebook.com (type: Business) and add the **WhatsApp** product.
2. From **WhatsApp > API Setup**, note the **Phone number ID** and the test number.
3. Create a **System User** in Business Settings with a permanent access token scoped to
   `whatsapp_business_messaging` and `whatsapp_business_management`. The 24h token shown in
   the setup panel is for testing only — it will expire mid-flow otherwise.
4. Under **App Settings > Basic**, copy the **App Secret** — this signs the webhooks.
5. Business verification is free but takes days and may need resubmission. Have the
   asociación civil's legal documents ready. Unverified businesses are capped on
   *business-initiated* conversations (currently 250/24h); inbound replies are unaffected,
   so you can run the member-facing flows before verification completes.

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

## Adding a flow

Declare a `Flow` in `index.ts` and register it in the `FLOWS` map. It appears in the main
menu automatically. Each step handler either calls `saveSession` to advance, or
`clearSession` to end.

Constraints that differ from Telegram and will shape your flows:

- **No message editing.** State lives in `whatsapp_sessions`, never in message text.
- **Max 3 reply buttons, max 10 list rows.** Longer option sets need pagination or a Flow.
  The send helpers truncate titles and log when they drop options.
- **24h window.** A stalled flow expires with the session and must be restarted.
- Handlers must be idempotent — `whatsapp_processed_messages` guards redeliveries, but only
  after a successful insert.

## Open decision: identity

There is no phone → player mapping in the schema, and an inbound `wa_id` proves only that
someone controls that number. `consulta_socio` therefore confirms registration and category
but discloses no payment or attendance data. Decide the verification policy before adding
any flow that reveals personal or financial information.
