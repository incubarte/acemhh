// Copies the 2026 season from production into the LOCAL database, so the ledger
// can be exercised against real data instead of a handful of seeded rows.
//
// Production is read-only here, and the script refuses to write anywhere that
// is not localhost. Local is wiped and replaced.
//
// Production still has the pre-split schema (training_slots carrying its own
// categories), so the agenda is imported by deriving training_slot_features the
// same way the migration does, and then verified: every session must resolve
// back to exactly the features production had on it.
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

/** ISO weekday (1 = Monday .. 7 = Sunday). */
function isoWeekday(date: string): number {
    const d = new Date(`${date}T12:00:00Z`).getUTCDay();
    return d === 0 ? 7 : d;
}

console.log(`Leyendo producción (${prodUrl.replace(/https:\/\/([^.]{6}).*/, "https://$1….")})`);

const [users, players, prices, slots, attendances, payments, expenses, handoffs] =
    await Promise.all([
        readAll(prod, "users"),
        readAll(prod, "players"),
        readAll(prod, "prices"),
        readAll(prod, "training_slots", (q) =>
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

// --- The agenda: sessions say when, features say what.
const sessions = slots.map((s) => ({ id: s.id, date: s.date, hour: s.hour }));

const eras = new Map<string, Record<string, unknown>>();
for (const s of slots) {
    const key = `${isoWeekday(String(s.date))}|${s.hour}|${JSON.stringify(s.categories)}|${s.goalies}`;
    const existing = eras.get(key);
    if (!existing || String(s.date) < String(existing.valid_from)) {
        eras.set(key, {
            weekday: isoWeekday(String(s.date)),
            hour: s.hour,
            valid_from: s.date,
            categories: s.categories,
            goalies: s.goalies,
        });
    }
}
const features = [...eras.values()];

console.log("Escribiendo local");
// Children first: every one of these points at users or players.
for (const t of [
    "payments", "attendances", "whatsapp_login_tokens", "cash_handoffs",
    "expenses", "training_sessions", "training_slot_features", "prices",
    "players", "users",
]) await wipe(t);

await insert("users", users);
await insert("players", players);
// Local's schema runs ahead of production: the goalkeeper rate does not exist
// there yet. Today it equals the prepaid rate, which is the honest default for
// rows that predate the column — they are kept apart precisely so changing one
// does not move the other from here on.
await insert("prices", prices.map((p) => ({
    ...p,
    goalkeeper_session_price: p.goalkeeper_session_price ?? p.prepaid_session_price,
})));
await insert("training_slot_features", features);
await insert("training_sessions", sessions);
// attendances.id is a sequence, and nothing references it — the real key is
// (session, player_id). Importing without the ids lets the local sequence
// assign fresh ones, instead of leaving it behind production's numbering and
// colliding on the very next insert.
await insert("attendances", attendances.map(({ id: _id, ...rest }) => rest));
// Production still stores the slot as a locale-formatted string; local wants
// the pair that identifies it. Membership dues belong to no slot.
const WEEKDAY_ES: Record<string, number> = {
    lun: 1, mar: 2, "mié": 3, mie: 3, jue: 4, vie: 5, "sáb": 6, sab: 6, dom: 7,
};
await insert("payments", payments.map(({ slot, ...rest }) => {
    if (!slot) return { ...rest, slot_weekday: null, slot_hour: null };
    const [day, hour] = String(slot).split(" ");
    const weekday = WEEKDAY_ES[day.toLowerCase()];
    const h = Number(String(hour).replace(/\D/g, ""));
    if (!weekday || !Number.isFinite(h)) {
        throw new Error(`No pude interpretar el slot "${slot}" del pago ${rest.id}`);
    }
    return { ...rest, slot_weekday: weekday, slot_hour: h };
}));
await insert("expenses", expenses);
await insert("cash_handoffs", handoffs);

// --- Verify the split did not change a single session's features.
const resolved = await readAll(local, "training_sessions_resolved");
const byKey = new Map(
    resolved.map((r) => [`${r.date}|${r.hour}`, r]),
);
let mismatches = 0;
for (const s of slots) {
    const got = byKey.get(`${s.date}|${s.hour}`);
    const same = got &&
        JSON.stringify(got.categories) === JSON.stringify(s.categories) &&
        got.goalies === s.goalies;
    if (!same) {
        mismatches++;
        if (mismatches <= 5) {
            console.error(`  ✗ ${s.date} ${s.hour}hs: prod ${JSON.stringify(s.categories)}/${s.goalies}, local ${JSON.stringify(got?.categories)}/${got?.goalies}`);
        }
    }
}

console.log(`\n${features.length} configuraciones de slot para ${sessions.length} sesiones`);
for (const f of features.sort((a, b) => `${a.hour}${a.valid_from}`.localeCompare(`${b.hour}${b.valid_from}`))) {
    console.log(`  ${f.hour}hs desde ${f.valid_from}: ${JSON.stringify(f.categories)} goalies=${f.goalies}`);
}

if (mismatches > 0) {
    console.error(`\n✗ ${mismatches} sesiones resuelven distinto de lo que tenía producción`);
    Deno.exit(1);
}
console.log(`\n✓ las ${slots.length} sesiones resuelven exactamente lo que tenía producción`);
