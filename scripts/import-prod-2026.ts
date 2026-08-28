// Copies the 2026 season from production into the LOCAL database, so the ledger
// can be exercised against real data instead of a handful of seeded rows.
//
// Production is read-only here, and the script refuses to write anywhere that
// is not localhost. Local is wiped and replaced.
//
// Production now carries the same shape as local, so the agenda is a straight
// copy. What is still checked afterwards is that no session resolves to NULL
// features — that would mean a slot with no configuration in force, which the
// ledger refuses to price.
//
//   deno run --allow-net --allow-env --allow-read scripts/import-prod-2026.ts

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const YEAR = "2026";

function env(name: string, file: string): string {
    const fromEnv = Deno.env.get(name);
    if (fromEnv) return fromEnv;
    const text = Deno.readTextFileSync(file);
    const line = text.split("\n").find((l) => l.startsWith(`${name}=`));
    if (!line) throw new Error(`${name} missing from ${file}`);
    return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, "");
}

function client(url: string, key: string): SupabaseClient {
    return createClient(url, key, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
}

const prodUrl = env("SUPABASE_URL", "dashboard/.env.prod");
const prod = client(prodUrl, env("SUPABASE_SERVICE_ROLE_KEY", "dashboard/.env.prod"));

const localUrl = Deno.env.get("LOCAL_SUPABASE_URL") ?? "http://127.0.0.1:54321";
// Refuse to be pointed at anything but a local stack: this script deletes.
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(localUrl)) {
    throw new Error(`Destino no local, me niego a escribir: ${localUrl}`);
}
if (localUrl === prodUrl) throw new Error("Origen y destino son el mismo");

const local = client(
    localUrl,
    Deno.env.get("LOCAL_SERVICE_ROLE_KEY") ??
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU",
);

/** PostgREST caps a page at 1000 rows; walk until short. */
async function readAll(
    from: SupabaseClient,
    table: string,
    filter: (q: ReturnType<SupabaseClient["from"]>) => unknown = (q) => q,
): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    for (let page = 0;; page++) {
        // deno-lint-ignore no-explicit-any
        let q: any = from.from(table).select("*");
        q = filter(q) ?? q;
        const { data, error } = await q.range(page * 1000, page * 1000 + 999);
        if (error) throw new Error(`${table}: ${error.message}`);
        out.push(...(data ?? []));
        if ((data ?? []).length < 1000) return out;
    }
}

/** PostgREST refuses an unfiltered delete, so each table names a column that is
 * never null to stand in for "everything". */
const WIPE_KEY: Record<string, string> = {
    whatsapp_login_tokens: "token_hash",
    training_slot_features: "weekday",
    prices: "valid_from",
};

async function wipe(table: string) {
    const { error } = await local.from(table).delete()
        .not(WIPE_KEY[table] ?? "id", "is", null);
    if (error) throw new Error(`wipe ${table}: ${error.message}`);
}

async function insert(table: string, rows: Record<string, unknown>[]) {
    for (let i = 0; i < rows.length; i += 500) {
        const { error } = await local.from(table).insert(rows.slice(i, i + 500));
        if (error) throw new Error(`insert ${table}: ${error.message}`);
    }
    console.log(`  ${table}: ${rows.length}`);
}

console.log(`Leyendo producción (${prodUrl.replace(/https:\/\/([^.]{6}).*/, "https://$1….")})`);

const [users, players, prices, features, sessions, attendances, payments, expenses, handoffs] =
    await Promise.all([
        readAll(prod, "users"),
        readAll(prod, "players"),
        readAll(prod, "prices"),
        readAll(prod, "training_slot_features"),
        readAll(prod, "training_sessions", (q) =>
            // deno-lint-ignore no-explicit-any
            (q as any).gte("date", `${YEAR}-01-01`).lte("date", `${YEAR}-12-31`)),
        readAll(prod, "attendances", (q) =>
            // deno-lint-ignore no-explicit-any
            (q as any).gte("session", `${YEAR}-01-01`).lte("session", `${YEAR}-12-31z`)),
        readAll(prod, "payments", (q) =>
            // deno-lint-ignore no-explicit-any
            (q as any).gte("month", `${YEAR}-01`).lte("month", `${YEAR}-12`)),
        readAll(prod, "expenses"),
        readAll(prod, "cash_handoffs"),
    ]);

console.log("Escribiendo local");
// Children first: every one of these points at users or players.
for (const t of [
    "payments", "attendances", "whatsapp_login_tokens", "cash_handoffs",
    "expenses", "training_sessions", "training_slot_features", "prices",
    "players", "users",
]) await wipe(t);

await insert("users", users);
await insert("players", players);
// Local's schema can run ahead of production, and then the imported row would
// silently undo a migration — which is exactly what happened with the
// goalkeeper price. Where a column does not exist there yet, the import
// replays what the migration did to it.
const CLUB_GOALKEEPER_PRICE = 20000; // 20260828100000_goalkeeper_invitee_price
await insert("prices", prices.map((p) => {
    // Before the split there was one goalkeeper price and it held the GUEST
    // one; the club's is the value the migration introduced.
    const hasSplit = p.goalkeeper_invitee_session_price !== undefined;
    return {
        ...p,
        goalkeeper_session_price: hasSplit
            ? p.goalkeeper_session_price
            : CLUB_GOALKEEPER_PRICE,
        goalkeeper_invitee_session_price: hasSplit
            ? p.goalkeeper_invitee_session_price
            : (p.goalkeeper_session_price ?? p.prepaid_session_price),
    };
}));
await insert("training_slot_features", features);
await insert("training_sessions", sessions);
// attendances.id is a sequence, and nothing references it — the real key is
// (session, player_id). Importing without the ids lets the local sequence
// assign fresh ones, instead of leaving it behind production's numbering and
// colliding on the very next insert.
await insert("attendances", attendances.map(({ id: _id, ...rest }) => rest));
await insert("payments", payments);
await insert("expenses", expenses);
await insert("cash_handoffs", handoffs);

// --- A session whose slot has no features in force cannot be priced: the
// ledger refuses it rather than guessing, so it must not exist.
const resolved = await readAll(local, "training_sessions_resolved");
const orphans = resolved.filter((r) => r.categories === null);
for (const o of orphans.slice(0, 5)) {
    console.error(`  ✗ ${o.date} ${o.hour}hs sin configuración de slot`);
}

console.log(`\n${features.length} configuraciones de slot para ${sessions.length} sesiones`);
for (
    const f of (features as { hour: number; valid_from: string; categories: string[]; goalies: boolean }[])
        .sort((a, b) => `${a.hour}${a.valid_from}`.localeCompare(`${b.hour}${b.valid_from}`))
) {
    console.log(`  ${f.hour}hs desde ${f.valid_from}: ${JSON.stringify(f.categories)} goalies=${f.goalies}`);
}

if (orphans.length > 0) {
    console.error(`\n✗ ${orphans.length} sesiones sin configuración de slot`);
    Deno.exit(1);
}
console.log(`\n✓ las ${resolved.length} sesiones resuelven su configuración`);
