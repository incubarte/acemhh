import crypto from "crypto";

export type TelegramAuthPayload = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
};

export type TelegramSessionUser = {
  id: number;
  first_name: string;
  last_name?: string | null;
  username?: string | null;
  auth_date: number;
};

function sha256(data: string | Buffer) {
  return crypto.createHash("sha256").update(data).digest();
}

export function verifyTelegramAuth(payload: TelegramAuthPayload): boolean {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) throw new Error("Missing TELEGRAM_BOT_TOKEN");

  const { hash, ...rest } = payload;

  const dataCheckString = Object.entries(rest)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");

  const secretKey = sha256(botToken);
  const hmac = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  return hmac === hash;
}

export function verifyTelegramWebAppInitData(initData: string): TelegramSessionUser | null {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) throw new Error("Missing TELEGRAM_BOT_TOKEN");

  const sp = new URLSearchParams(initData);
  const hash = sp.get("hash");
  if (!hash) return null;

  const pairs: string[] = [];
  for (const [k, v] of sp.entries()) {
    if (k === "hash") continue;
    pairs.push(`${k}=${v}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const expectedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (expectedHash !== hash) return null;

  const userRaw = sp.get("user");
  const authDateRaw = sp.get("auth_date");
  if (!userRaw || !authDateRaw) return null;

  try {
    const user = JSON.parse(userRaw) as {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
    };
    const auth_date = Number(authDateRaw);
    if (!Number.isFinite(auth_date) || auth_date <= 0) return null;
    if (!user?.id || !user?.first_name) return null;
    return {
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name ?? null,
      username: user.username ?? null,
      auth_date,
    };
  } catch {
    return null;
  }
}

export function makeSessionCookieValueFromUser(user: TelegramSessionUser): string {
  const secret = process.env.DASHBOARD_SESSION_SECRET;
  if (!secret) throw new Error("Missing DASHBOARD_SESSION_SECRET");

  const body = JSON.stringify({
    id: user.id,
    username: user.username ?? null,
    first_name: user.first_name,
    last_name: user.last_name ?? null,
    auth_date: user.auth_date,
  });

  const b64 = Buffer.from(body, "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(b64).digest("base64url");
  return `${b64}.${sig}`;
}

export function makeSessionCookieValue(payload: TelegramAuthPayload): string {
  return makeSessionCookieValueFromUser({
    id: payload.id,
    username: payload.username ?? null,
    first_name: payload.first_name,
    last_name: payload.last_name ?? null,
    auth_date: payload.auth_date,
  });
}

export function verifySessionCookieValue(value: string): TelegramSessionUser | null {
  const secret = process.env.DASHBOARD_SESSION_SECRET;
  if (!secret) throw new Error("Missing DASHBOARD_SESSION_SECRET");

  const parts = value.split(".");
  if (parts.length !== 2) return null;
  const [b64, sig] = parts;
  const expected = crypto.createHmac("sha256", secret).update(b64).digest("base64url");
  if (sig !== expected) return null;

  try {
    const json = Buffer.from(b64, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as Partial<TelegramSessionUser> & { id?: number };
    if (!parsed?.id) return null;
    return {
      id: parsed.id,
      first_name: parsed.first_name ?? "",
      last_name: parsed.last_name ?? null,
      username: parsed.username ?? null,
      auth_date: parsed.auth_date ?? 0,
    };
  } catch {
    return null;
  }
}
