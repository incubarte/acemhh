#!/usr/bin/env -S deno run --allow-read --allow-env --allow-net
//
// Backfills players.phone and players.guardian_phone from Google Forms CSV exports.
//
// Sources are given in priority order: the first file that yields a *valid* number
// for a player wins that field. Validity is checked per field, so a truncated number
// in a high-priority file falls through to the next source instead of winning.
//
// Dry run by default. Nothing is written without --apply.
//
//   deno run --allow-read --allow-env --allow-net scripts/backfill-phones.ts \
//     ~/backfill/inscripcion-nivelatorio.csv \
//     ~/backfill/relevamiento-2025.csv \
//     ~/backfill/torneo-relampago.csv
//
// Flags:
//   --apply       write the updates (default is a dry run)
//   --overwrite   also replace phones already stored (default only fills nulls)
//   --sql         emit UPDATE statements (keyed by player id) instead of a report
//   --seed        same, but keyed by DNI, for pasting into supabase/seed.sql
//   --roster-only read only id/name/dni, for a schema without the phone columns.
//                 Detected automatically too; the flag just skips the probe.

import { load } from "jsr:@std/dotenv";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { parsePhoneNumberFromString } from "npm:libphonenumber-js@1";

// The credentials live in supabase/functions/.env, which is not the working
// directory the script is run from — resolve it from this file's own location so
// the command works from anywhere. Variables already set in the shell win, which is
// how you point a single run at a different database.
try {
    await load({
        envPath: new URL("../supabase/functions/.env", import.meta.url).pathname,
        export: true,
    });
} catch {
    // No env file is fine as long as the variables are exported in the shell.
}

// ////////////////////////////////////
// PHONE NORMALIZATION
// ////////////////////////////////////
// Kept in sync with dashboard/src/lib/phone.ts — see that file for the reasoning
// behind the two Argentine rules.

function restoreBuenosAiresAreaCode(nationalNumber: string): string {
    if (nationalNumber.length === 10 && nationalNumber.startsWith("15")) {
        return `11${nationalNumber.slice(2)}`;
    }
    return nationalNumber;
}

export function normalizeWhatsappPhone(raw: string | null | undefined): string | null {
    const trimmed = (raw ?? "").trim();
    if (!trimmed) return null;

    const parsed = parsePhoneNumberFromString(trimmed, "AR");
    if (!parsed) return null;

    let nationalNumber = parsed.nationalNumber;
    if (parsed.country === "AR") {
        nationalNumber = restoreBuenosAiresAreaCode(nationalNumber);
        if (!nationalNumber.startsWith("9")) nationalNumber = `9${nationalNumber}`;
    }

    const candidate = `${parsed.countryCallingCode}${nationalNumber}`;
    const final = parsePhoneNumberFromString(`+${candidate}`);
    return final?.isValid() ? candidate : null;
}

// ////////////////////////////////////
// CSV
// ////////////////////////////////////

function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
            } else field += c;
        } else if (c === '"') inQuotes = true;
        else if (c === ",") { row.push(field); field = ""; }
        else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
        else if (c !== "\r") field += c;
    }
    if (field || row.length) { row.push(field); rows.push(row); }

    return rows.filter((r) => r.some((c) => c.trim()));
}

// Columns are located by header text rather than position, so the exports can gain
// or reorder questions without breaking this.
//
// guardianPhone deliberately requires an explicit madre/padre/tutor header. The
// relevamiento export's "CELULAR DEL FAMILAIR" is an emergency contact, which is not
// the same thing as the guardian of an underage player — it is left alone for a human
// to sort out. Requiring "celular" as well keeps it from matching the nivelatorio
// export's "Nombre y apellido de madre o padre", which holds a name, not a number.
const HeaderPatterns = {
    name: /^nombre$/i,
    lastName: /^apellido$/i,
    combinedName: /apellido,\s*nombre/i,
    dni: /^dni$/i,
    phone: /tel[eé]fono de contacto|celular del deportista|n[uú]mero de whatsapp/i,
    guardianPhone: /celular.*(madre|padre|tutor)/i,
} as const;

function findColumn(header: string[], pattern: RegExp): number {
    return header.findIndex((h) => pattern.test(h.trim()));
}

type CsvRecord = {
    source: string;
    name: string;
    lastName: string;
    dni: string | null;
    phoneRaw: string;
    guardianPhoneRaw: string;
};

export function readSource(path: string): CsvRecord[] {
    const source = path.split("/").pop() ?? path;
    const rows = parseCsv(Deno.readTextFileSync(path));
    if (rows.length < 2) return [];

    const header = rows[0];
    const cols = {
        name: findColumn(header, HeaderPatterns.name),
        lastName: findColumn(header, HeaderPatterns.lastName),
        combinedName: findColumn(header, HeaderPatterns.combinedName),
        dni: findColumn(header, HeaderPatterns.dni),
        phone: findColumn(header, HeaderPatterns.phone),
        guardianPhone: findColumn(header, HeaderPatterns.guardianPhone),
    };

    if (cols.phone < 0 && cols.guardianPhone < 0) {
        console.error(`  ! ${source}: no phone column found, skipping`);
        return [];
    }

    return rows.slice(1).map((r) => {
        let name = cols.name >= 0 ? (r[cols.name] ?? "") : "";
        let lastName = cols.lastName >= 0 ? (r[cols.lastName] ?? "") : "";

        // "Apellido, Nombre" in a single field. Without the comma, assume the first
        // token is the surname, as the question label instructs.
        if (cols.combinedName >= 0) {
            const combined = (r[cols.combinedName] ?? "").trim();
            if (combined.includes(",")) {
                const [l, ...rest] = combined.split(",");
                lastName = l;
                name = rest.join(" ");
            } else {
                const tokens = combined.split(/\s+/).filter(Boolean);
                lastName = tokens[0] ?? "";
                name = tokens.slice(1).join(" ");
            }
        }

        return {
            source,
            name: name.trim(),
            lastName: lastName.trim(),
            dni: cols.dni >= 0 ? (r[cols.dni] ?? "").replace(/\D/g, "") || null : null,
            phoneRaw: cols.phone >= 0 ? (r[cols.phone] ?? "").trim() : "",
            guardianPhoneRaw: cols.guardianPhone >= 0 ? (r[cols.guardianPhone] ?? "").trim() : "",
        };
    });
}

// ////////////////////////////////////
// MATCHING
// ////////////////////////////////////

/** Lowercase, strip accents and punctuation, collapse whitespace. */
function normalizeName(value: string): string {
    return value
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

export type Player = {
    id: string;
    name: string;
    last_name: string;
    dni: string | null;
    phone: string | null;
    guardian_phone: string | null;
};

function nameTokens(value: string): Set<string> {
    return new Set(normalizeName(value).split(" ").filter(Boolean));
}

function isSubset(subset: Set<string>, superset: Set<string>): boolean {
    for (const t of subset) if (!superset.has(t)) return false;
    return true;
}

type Index = {
    byDni: Map<string, Player>;
    tokenized: { player: Player; tokens: Set<string> }[];
};

export function buildIndex(players: Player[]): Index {
    const byDni = new Map<string, Player>();
    for (const p of players) {
        if (p.dni) byDni.set(p.dni.replace(/\D/g, ""), p);
    }

    return {
        byDni,
        tokenized: players.map((p) => ({
            player: p,
            tokens: nameTokens(`${p.name} ${p.last_name}`),
        })),
    };
}

type MatchResult =
    | { kind: "matched"; player: Player; how: string }
    | { kind: "ambiguous"; candidates: Player[] }
    | { kind: "unmatched" };

/**
 * Names are matched as unordered token sets rather than "first last".
 *
 * The forms were filled in inconsistently — the torneo export asks for
 * "Apellido, Nombre" but contains "Nahuel zorrilla", "De Lio, Alejandro" and bare
 * "Berko" — so token order carries no information. Extra tokens are tolerated in the
 * CSV direction only ("Joaquín Hernan Carrascosa" matches "Joaquin Carrascosa"),
 * never the reverse, and only when exactly one player qualifies.
 *
 * Spelling differences are deliberately not bridged. "Laboratto"/"Laborato" and
 * "Maxi"/"Maximiliano" stay unmatched and get reported, because guessing at those
 * risks writing a phone number onto the wrong person.
 */
export function matchPlayer(record: CsvRecord, index: Index): MatchResult {
    if (record.dni) {
        const byDni = index.byDni.get(record.dni);
        if (byDni) return { kind: "matched", player: byDni, how: "dni" };
    }

    const tokens = nameTokens(`${record.name} ${record.lastName}`);
    if (tokens.size === 0) return { kind: "unmatched" };

    const exact = index.tokenized.filter(
        (t) => t.tokens.size === tokens.size && isSubset(t.tokens, tokens),
    );
    if (exact.length === 1) return { kind: "matched", player: exact[0].player, how: "name" };
    if (exact.length > 1) return { kind: "ambiguous", candidates: exact.map((e) => e.player) };

    const partial = index.tokenized.filter((t) => isSubset(t.tokens, tokens));
    if (partial.length === 1) {
        return { kind: "matched", player: partial[0].player, how: "name-subset" };
    }
    if (partial.length > 1) {
        return { kind: "ambiguous", candidates: partial.map((p) => p.player) };
    }

    return { kind: "unmatched" };
}

/**
 * Suggestion only — never applied automatically. Surfaces roster players who share a
 * name token with an unmatched row, which is how spelling variants and nicknames
 * ("Laboratto"/"Laborato", "Maxi"/"Maximiliano") get spotted for manual fixing.
 */
export function nearMissHint(label: string, index: Index): string {
    const tokens = nameTokens(label);
    if (tokens.size === 0) return "";

    const near = index.tokenized
        .filter((t) => [...t.tokens].some((token) => tokens.has(token)))
        .map((t) => `${t.player.name} ${t.player.last_name}`);

    return near.length ? `  -> did you mean: ${near.join(", ")}?` : "";
}

// ////////////////////////////////////
// MAIN
// ////////////////////////////////////

type Planned = {
    player: Player;
    phone?: { value: string; source: string; raw: string };
    guardianPhone?: { value: string; source: string; raw: string };
};

/**
 * Loads the roster, tolerating a schema where the phone columns do not exist yet.
 *
 * That is the state of any database the migration has not reached, and it is still
 * a perfectly good source of players — the matching and the generated SQL do not
 * need the current values. Falls back automatically on the undefined-column error
 * so a first run against prod reports instead of dying; --roster-only skips the
 * optimistic attempt when you already know the columns are missing.
 */
export async function loadPlayers(
    // deno-lint-ignore no-explicit-any
    supabase: any,
    rosterOnly: boolean,
): Promise<{ players: Player[]; hasPhoneColumns: boolean }> {
    const RosterColumns = "id,name,last_name,dni";

    if (!rosterOnly) {
        const { data, error } = await supabase
            .from("players")
            .select(`${RosterColumns},phone,guardian_phone`);

        if (!error) return { players: data as Player[], hasPhoneColumns: true };

        // 42703 is Postgres' undefined_column. Anything else is a real failure.
        const undefinedColumn = error.code === "42703" ||
            /column .*(phone).* does not exist/i.test(error.message ?? "");
        if (!undefinedColumn) {
            console.error("Failed to load players:", error.message);
            Deno.exit(1);
        }
    }

    const { data, error } = await supabase.from("players").select(RosterColumns);
    if (error) {
        console.error("Failed to load players:", error.message);
        Deno.exit(1);
    }

    const players = (data as Omit<Player, "phone" | "guardian_phone">[]).map((p) => ({
        ...p,
        phone: null,
        guardian_phone: null,
    }));

    return { players, hasPhoneColumns: false };
}

async function main() {
    const args = [...Deno.args];
    const apply = args.includes("--apply");
    const overwrite = args.includes("--overwrite");
    const emitSql = args.includes("--sql");
    const emitSeed = args.includes("--seed");
    const rosterOnly = args.includes("--roster-only");
    const paths = args.filter((a) => !a.startsWith("--"));

    if (paths.length === 0) {
        console.error(
            "Usage: backfill-phones.ts <csv> [csv...] [--apply] [--overwrite] [--roster-only] [--sql|--seed]",
        );
        console.error("CSVs are processed in priority order: the first valid value wins.");
        Deno.exit(1);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
        console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
        Deno.exit(1);
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const { players, hasPhoneColumns } = await loadPlayers(supabase, rosterOnly);

    if (!hasPhoneColumns) {
        console.log(
            "\nNote: players.phone / players.guardian_phone are not in this schema.\n" +
            "      Using the database as a roster source only. Every matched number is\n" +
            "      reported as new, since there is nothing to compare against.\n" +
            "      Re-run with --sql once the migration has been applied, or use the\n" +
            "      emitted statements directly.",
        );

        if (apply) {
            console.error(
                "\nRefusing --apply: the phone columns do not exist yet. Apply migration\n" +
                "20260805130000_add_phone_to_players.sql first, or re-run with --sql to\n" +
                "generate the statements.",
            );
            Deno.exit(1);
        }
    }

    const index = buildIndex(players);
    const planned = new Map<string, Planned>();
    const unmatched: { record: CsvRecord; reason: string }[] = [];
    const rejected: { record: CsvRecord; field: string; raw: string }[] = [];

    for (const path of paths) {
        console.log(`\nReading ${path}`);
        const records = readSource(path);
        console.log(`  ${records.length} rows`);

        for (const record of records) {
            const match = matchPlayer(record, index);
            if (match.kind !== "matched") {
                const reason = match.kind === "ambiguous"
                    ? `ambiguous (${match.candidates.length} candidates)`
                    : "no matching player";
                unmatched.push({ record, reason });
                continue;
            }

            const entry = planned.get(match.player.id) ?? { player: match.player };

            for (
                const [field, raw] of [
                    ["phone", record.phoneRaw],
                    ["guardianPhone", record.guardianPhoneRaw],
                ] as const
            ) {
                if (!raw) continue;
                // Priority: an earlier source already claimed this field.
                if (entry[field]) continue;

                const value = normalizeWhatsappPhone(raw);
                if (!value) {
                    rejected.push({ record, field, raw });
                    continue;
                }
                entry[field] = { value, source: record.source, raw };
            }

            planned.set(match.player.id, entry);
        }
    }

    // Only fill blanks unless told otherwise.
    const updates: { player: Player; phone: string | null; guardianPhone: string | null }[] = [];
    for (const entry of planned.values()) {
        const phone = entry.phone?.value ?? null;
        const guardianPhone = entry.guardianPhone?.value ?? null;

        const setPhone = phone && (overwrite || !entry.player.phone) ? phone : null;
        const setGuardian = guardianPhone && (overwrite || !entry.player.guardian_phone)
            ? guardianPhone
            : null;

        if (setPhone || setGuardian) {
            updates.push({ player: entry.player, phone: setPhone, guardianPhone: setGuardian });
        }
    }

    if (emitSql || emitSeed) {
        console.log("-- Generated by scripts/backfill-phones.ts");
        for (const u of updates) {
            const sets = [
                u.phone ? `phone = '${u.phone}'` : null,
                u.guardianPhone ? `guardian_phone = '${u.guardianPhone}'` : null,
            ].filter(Boolean).join(", ");

            // Seed rows get fresh UUIDs on every `supabase db reset`, so the seed
            // variant keys on the DNI instead of the id.
            const where = emitSeed && u.player.dni
                ? `dni = '${u.player.dni}'`
                : `id = '${u.player.id}'`;

            console.log(
                `UPDATE players SET ${sets} WHERE ${where}; -- ${u.player.name} ${u.player.last_name}`,
            );
        }
        return;
    }

    console.log(`\n${"=".repeat(70)}`);
    console.log(`PLANNED UPDATES (${updates.length})`);
    console.log("=".repeat(70));
    for (const u of updates) {
        const who = `${u.player.name} ${u.player.last_name}`.padEnd(32);
        console.log(`  ${who} phone=${u.phone ?? "-"}  guardian=${u.guardianPhone ?? "-"}`);
    }

    if (rejected.length) {
        console.log(`\n${"=".repeat(70)}`);
        console.log(`REJECTED VALUES (${rejected.length}) - fix by hand if they matter`);
        console.log("=".repeat(70));
        for (const r of rejected) {
            console.log(
                `  ${r.record.source.padEnd(28)} ${`${r.record.name} ${r.record.lastName}`.slice(0, 28).padEnd(30)} ${r.field}=${JSON.stringify(r.raw)}`,
            );
        }
    }

    if (unmatched.length) {
        console.log(`\n${"=".repeat(70)}`);
        console.log(`UNMATCHED ROWS (${unmatched.length}) - no player updated`);
        console.log("=".repeat(70));
        for (const u of unmatched) {
            const label = `${u.record.name} ${u.record.lastName}`.trim();
            console.log(
                `  ${u.record.source.padEnd(28)} ${label.slice(0, 28).padEnd(30)} ${u.reason}${nearMissHint(label, index)}`,
            );
        }
    }

    const withoutPhone = players.filter(
        (p) => !p.phone && !updates.some((u) => u.player.id === p.id && u.phone),
    );
    console.log(
        hasPhoneColumns
            ? `\nPlayers still without a phone after this run: ${withoutPhone.length}`
            : `\nPlayers no source covers: ${withoutPhone.length}`,
    );
    for (const p of withoutPhone) console.log(`  ${p.name} ${p.last_name}`);

    if (!apply) {
        console.log(
            hasPhoneColumns
                ? `\nDry run. Re-run with --apply to write ${updates.length} update(s).`
                : `\nDry run. Re-run with --sql to emit ${updates.length} UPDATE statement(s).`,
        );
        return;
    }

    console.log(`\nApplying ${updates.length} update(s)...`);
    let failures = 0;
    for (const u of updates) {
        const patch: Record<string, string> = {};
        if (u.phone) patch.phone = u.phone;
        if (u.guardianPhone) patch.guardian_phone = u.guardianPhone;

        const { error: updateError } = await supabase
            .from("players")
            .update(patch)
            .eq("id", u.player.id);

        if (updateError) {
            failures++;
            console.error(`  FAILED ${u.player.name} ${u.player.last_name}: ${updateError.message}`);
        }
    }
    console.log(failures ? `Done with ${failures} failure(s).` : "Done.");
}

if (import.meta.main) {
    await main();
}
