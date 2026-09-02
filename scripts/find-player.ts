// Busca jugadores en producción por nombre o apellido y muestra la fila completa,
// para diagnosticar por qué una búsqueda del dashboard no los encuentra.
//
//   deno run --allow-net --allow-env --allow-read scripts/find-player.ts romero
//
// Producción sólo se lee.

import { createClient } from "jsr:@supabase/supabase-js@2";

function env(name: string): string {
    const fromEnv = Deno.env.get(name);
    if (fromEnv) return fromEnv;
    const text = Deno.readTextFileSync("dashboard/.env.prod");
    const line = text.split("\n").find((l) => l.startsWith(`${name}=`));
    if (!line) throw new Error(`${name} missing from dashboard/.env.prod`);
    return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, "");
}

const term = Deno.args[0];
if (!term) {
    console.error("uso: find-player.ts <texto>");
    Deno.exit(1);
}

const prod = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
});

const like = `%${term}%`;
const { data, error } = await prod
    .from("players")
    .select("*")
    .or(`name.ilike.${like},last_name.ilike.${like}`)
    .order("last_name")
    .order("name");
if (error) throw new Error(error.message);

for (const p of data ?? []) {
    // JSON.stringify sobre name/last_name hace visibles espacios y caracteres raros.
    console.log(JSON.stringify(p));
}
console.log(`total: ${data?.length ?? 0}`);
