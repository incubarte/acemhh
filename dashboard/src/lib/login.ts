import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { SessionUser, TelegramWebAppUser } from "@/lib/telegramAuth";

// Upserts a verified Telegram identity into users (the identity store) and
// returns the SessionUser for the cookie: uuid id plus DB-resolved groups.
// A first login creates the row with no groups — authenticated but
// unauthorized until someone grants membership.
export async function sessionFromTelegramIdentity(
  tg: TelegramWebAppUser,
): Promise<SessionUser | null> {
  const { data, error } = await supabaseAdmin()
    .from("users")
    .upsert({
      tg_id: tg.id,
      tg_username: tg.username || null,
      first_name: tg.first_name,
      last_name: tg.last_name || null,
      last_login_at: new Date().toISOString(),
    }, { onConflict: "tg_id" })
    .select("id,first_name,last_name,tg_username,groups")
    .single();

  if (error || !data) {
    console.error("[LOGIN] users upsert failed:", error);
    return null;
  }

  return {
    id: data.id,
    first_name: data.first_name,
    last_name: data.last_name,
    username: data.tg_username,
    auth_date: tg.auth_date,
    groups: data.groups ?? [],
  };
}
