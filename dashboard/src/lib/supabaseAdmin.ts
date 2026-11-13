import { createClient } from "@supabase/supabase-js";
import { activityHeaders } from "@/lib/requestContext";

export function supabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, {
    auth: { persistSession: false },
    // Who is writing and for which submit, for the activity log's triggers.
    global: { headers: activityHeaders() },
  });
}
