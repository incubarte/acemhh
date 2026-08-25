// Before/after check for the migrations that restructure money data:
// training_slots -> training_sessions + training_slot_features, and
// payments.slot -> (slot_weekday, slot_hour).
//
// Both rewrite data the ledger reads, and both DROP the old columns — so the
// only way to know they landed right is to write down what production said
// beforehand and compare afterwards.
//
//   deno run --allow-net --allow-env --allow-read --allow-write \
//     scripts/verify-prod-migration.ts snapshot   # ANTES de db push
//   deno run --allow-net --allow-env --allow-read --allow-write \
//     scripts/verify-prod-migration.ts verify     # DESPUÉS
//
// Production is only ever read.

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const FILE = "/tmp/acemhh-prod-snapshot.json";

function env(name: string): string {
    const fromEnv = Deno.env.get(name);
    if (fromEnv) return fromEnv;
    const text = Deno.readTextFileSync("dashboard/.env.prod");
    const line = text.split("\n").find((l) => l.startsWith(`${name}=`));
    if (!line) throw new Error(`${name} missing from dashboard/.env.prod`);
    return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, "");
}

const prod: SupabaseClient = createClient(
    env("SUPABASE_URL"),
    env("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
);

async function readAll(table: string, columns: string): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    for (let page = 0;; page++) {
        const { data, error } = await prod.from(table).select(columns)
            .range(page * 1000, page * 1000 + 999);
        if (error) throw new Error(`${table}: ${error.message}`);
        out.push(...((data ?? []) as unknown as Record<string, unknown>[]));
        if ((data ?? []).length < 1000) return out;
    }
}

const WEEKDAY_ES: Record<string, number> = {
    lun: 1, mar: 2, "mié": 3, mie: 3, jue: 4, vie: 5, "sáb": 6, sab: 6, dom: 7,
};

if (Deno.args[0] === "snapshot") {
    const slots = await readAll("training_slots", "date,hour,categories,goalies");
    const payments = await readAll("payments", "id,concept,slot");
    Deno.writeTextFileSync(FILE, JSON.stringify({ slots, payments }, null, 0));
    console.log(`Guardado en ${FILE}`);
    console.log(`  ${slots.length} sesiones y ${payments.length} pagos`);
    console.log("\nAhora sí: npx supabase db push");
} else if (Deno.args[0] === "verify") {
    const before = JSON.parse(Deno.readTextFileSync(FILE));
    let bad = 0;

    // Every session must resolve exactly the features it had.
    const resolved = await readAll("training_sessions_resolved", "date,hour,categories,goalies");
    const byKey = new Map(resolved.map((r) => [`${r.date}|${r.hour}`, r]));
    for (const s of before.slots) {
        const got = byKey.get(`${s.date}|${s.hour}`);
        if (
            !got ||
            JSON.stringify(got.categories) !== JSON.stringify(s.categories) ||
            got.goalies !== s.goalies
        ) {
            if (++bad <= 5) {
                console.error(
                    `  ✗ ${s.date} ${s.hour}hs: antes ${JSON.stringify(s.categories)}/${s.goalies}, ` +
                        `ahora ${JSON.stringify(got?.categories)}/${got?.goalies}`,
                );
            }
        }
    }
    console.log(`Sesiones: ${before.slots.length} comparadas, ${bad} distintas`);

    // Every payment's slot must have become the same pair it spelled out.
    const after = await readAll("payments", "id,slot_weekday,slot_hour");
    const payBydId = new Map(after.map((p) => [p.id, p]));
    let badPay = 0;
    for (const p of before.payments) {
        const got = payBydId.get(p.id);
        if (!got) {
            if (++badPay <= 5) console.error(`  ✗ pago ${p.id} desapareció`);
            continue;
        }
        const expected = p.slot
            ? {
                w: WEEKDAY_ES[String(p.slot).split(" ")[0].toLowerCase()],
                h: Number(String(p.slot).split(" ")[1].replace(/\D/g, "")),
            }
            : { w: null, h: null };
        if (got.slot_weekday !== expected.w || got.slot_hour !== expected.h) {
            if (++badPay <= 5) {
                console.error(
                    `  ✗ pago ${p.id}: "${p.slot}" quedó como ${got.slot_weekday}/${got.slot_hour}`,
                );
            }
        }
    }
    console.log(`Pagos: ${before.payments.length} comparados, ${badPay} distintos`);

    if (bad + badPay > 0) {
        console.error("\n✗ La migración cambió datos que tenían que quedar iguales");
        Deno.exit(1);
    }
    console.log("\n✓ Todo resuelve exactamente lo que producción tenía antes");
} else {
    console.error("Usá: snapshot (antes de db push) o verify (después)");
    Deno.exit(1);
}
