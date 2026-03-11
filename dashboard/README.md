# ACEMHH Dashboard

Vercel/Next.js dashboard for registering membership dues payments.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env.local`:

```bash
cp .env.example .env.local
```

3. Run dev server:

```bash
npm run dev
```

## Environment variables

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TELEGRAM_BOT_TOKEN` (used to verify Telegram Login Widget payload)
- `DASHBOARD_SESSION_SECRET` (HMAC secret for signing session cookie)
- `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` (bot username shown in Telegram login widget)

## Pages

- `/login` Telegram login
- `/dues` Register dues payment
- `/players/new` New player form

## API

- `POST /api/auth/telegram` verify Telegram login payload and set session cookie
- `GET /api/me` session check
- `GET /api/players?query=...` search players
- `GET /api/players?id=...` get player by id
- `POST /api/players` create player
- `POST /api/payments/dues` register payment
