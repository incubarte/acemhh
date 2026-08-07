#!/usr/bin/env -S deno run --allow-read --allow-env --allow-net
//
// Reports players that look like the same person entered twice. Read-only: it never
// writes anything, because deciding what to merge needs a human who knows the club.
//
//   deno run --allow-read --allow-env --allow-net scripts/find-duplicate-players.ts
//
// Flags:
//   --threshold=N  minimum similarity to report, 0-1 (default 0.62)
//   --all          also show pairs ruled out by having two different DNIs

import { load } from "jsr:@std/dotenv";
import { createClient } from "jsr:@supabase/supabase-js@2";

try {
    await load({
        envPath: new URL("../supabase/functions/.env", import.meta.url).pathname,
        export: true,
    });
} catch {
    // Fine as long as the variables are exported in the shell.
}

type Player = {
    id: string;
    name: string;
    last_name: string;
    dni: string | null;
    fecha_nac: string | null;
    category: string | null;
    invitee: boolean | null;
};

// ////////////////////////////////////
// TEXT
// ////////////////////////////////////

function normalize(value: string): string {
    return (value ?? "")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Every token from both name fields, in one set.
 *
 * Deliberately order-blind and field-blind: admins have entered surnames in the name
 * column and vice versa, so "Nahuel"/"Zorrilla" and "Zorrilla"/"Nahuel" have to come
 * out identical. Comparing the fields separately would miss exactly the case we care
 * about most.
 */
function tokensOf(player: Player): Set<string> {
    return new Set(
        normalize(`${player.name} ${player.last_name}`).split(" ").filter(Boolean),
    );
}

// ////////////////////////////////////
// NICKNAMES
// ////////////////////////////////////

/**
 * Diminutives to the full names they can stand for.
 *
 * Deliberately one-to-many rather than a single canonical form, because most
 * diminutives are ambiguous: "Ale" is Alejandro or Alejandra, "Fran" is Francisco or
 * Franco. Two tokens count as the same name when their possible expansions overlap,
 * so "Ale"/"Alejandro" match while "Alejandro"/"Alejandra" - different people - do not.
 *
 * Add entries freely; a wrong one costs you a pair shown for review, not a merge.
 */
const Nicknames: Record<string, string[]> = {
    adri: ["adrian"],
    agus: ["agustin", "agustina"],
    ale: ["alejandro", "alejandra"],
    anto: ["antonella", "antonio"],
    bauti: ["bautista"],
    benja: ["benjamin"],
    benny: ["benicio"],
    beto: ["alberto", "roberto"],
    cami: ["camila", "camilo"],
    caro: ["carolina"],
    charly: ["carlos"],
    cris: ["cristian", "cristina"],
    dani: ["daniel", "daniela"],
    edu: ["eduardo"],
    emi: ["emiliano", "emilia", "emilio"],
    facu: ["facundo"],
    fede: ["federico"],
    flor: ["florencia"],
    fran: ["francisco", "franco", "francisca"],
    gabi: ["gabriel", "gabriela"],
    guille: ["guillermo"],
    isa: ["isabella", "isabel"],
    joaco: ["joaquin"],
    juli: ["julian", "julieta", "julio"],
    leo: ["leonardo", "leonel"],
    lu: ["lucia", "luciana"],
    lucho: ["luciano", "luis"],
    lupe: ["guadalupe"],
    luli: ["lucia", "luciana"],
    manu: ["manuel", "manuela"],
    marti: ["martin", "martina"],
    mati: ["matias"],
    max: ["maximiliano"],
    maxi: ["maximiliano"],
    meli: ["melina", "melisa"],
    mica: ["micaela"],
    mili: ["milagros"],
    nacho: ["ignacio"],
    naza: ["nazareno"],
    nico: ["nicolas"],
    pancho: ["francisco"],
    pato: ["patricio", "patricia"],
    pepe: ["jose"],
    quique: ["enrique"],
    rami: ["ramiro"],
    roco: ["rocio"],
    rodri: ["rodrigo"],
    santi: ["santiago"],
    seba: ["sebastian"],
    sofi: ["sofia"],
    tincho: ["martin"],
    tomi: ["tomas"],
    vale: ["valeria", "valentina"],
    valen: ["valentin", "valentina"],
    vicky: ["victoria"],
};

/** The full names a token could stand for. A full name stands for itself. */
function expansions(token: string): string[] {
    return Nicknames[token] ?? [token];
}

function shareAnExpansion(a: string, b: string): boolean {
    const formsB = expansions(b);
    return expansions(a).some((form) => formsB.includes(form));
}

function levenshtein(a: string, b: string): number {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;

    let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const current = [i];
        for (let j = 1; j <= b.length; j++) {
            current[j] = Math.min(
                previous[j] + 1,
                current[j - 1] + 1,
                previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
            );
        }
        previous = current;
    }
    return previous[b.length];
}

/** 1 = identical, 0 = nothing in common. */
function ratio(a: string, b: string): number {
    const longest = Math.max(a.length, b.length);
    return longest === 0 ? 1 : 1 - levenshtein(a, b) / longest;
}

/**
 * Spanish gendered name pairs differ only in the final vowel: Daniel/Daniela,
 * Alejandro/Alejandra, Luciano/Luciana. Edit distance reads those as a typo, which
 * would pair up fathers and daughters who share a surname. Treat the ending as
 * meaningful instead — missing a genuine "Mariano" typed "Mariana" is the cheaper
 * mistake.
 */
function differsOnlyByGenderedEnding(a: string, b: string): boolean {
    const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];

    // Daniel / Daniela, Gabriel / Gabriela, Juan / Juana.
    if (longer === `${shorter}a`) return true;

    // Alejandro / Alejandra, Luciano / Luciana, Mariano / Mariana.
    if (a.length === b.length && a.length >= 2 && a.slice(0, -1) === b.slice(0, -1)) {
        const endings = [a[a.length - 1], b[b.length - 1]];
        return endings.includes("o") && endings.includes("a");
    }

    return false;
}

// Short tokens need to match almost exactly — "ana" and "ema" are one edit apart but
// are not the same name.
function tokensMatch(a: string, b: string): boolean {
    if (a === b) return true;
    if (shareAnExpansion(a, b)) return true;
    if (differsOnlyByGenderedEnding(a, b)) return false;
    const shortest = Math.min(a.length, b.length);
    if (shortest < 4) return false;
    return ratio(a, b) >= 0.8;
}

function isSubset(subset: Set<string>, superset: Set<string>): boolean {
    for (const t of subset) if (!superset.has(t)) return false;
    return true;
}

// ////////////////////////////////////
// SCORING
// ////////////////////////////////////

type Candidate = {
    a: Player;
    b: Player;
    score: number;
    reasons: string[];
    /** Two different DNIs is strong evidence of two different people. */
    ruledOut: boolean;
};

function compare(a: Player, b: Player): Candidate | null {
    const tokensA = tokensOf(a);
    const tokensB = tokensOf(b);
    if (tokensA.size === 0 || tokensB.size === 0) return null;

    const reasons: string[] = [];
    let score: number;

    if (tokensA.size === tokensB.size && isSubset(tokensA, tokensB)) {
        score = 1;
        reasons.push("mismos tokens");
    } else if (isSubset(tokensA, tokensB) || isSubset(tokensB, tokensA)) {
        score = 0.9;
        reasons.push("uno tiene nombres de más");
    } else {
        // Dice coefficient over fuzzily matched tokens, which is what catches
        // "Laborato"/"Laboratto" and "Gesso"/"Guesso".
        const used = new Set<string>();
        let matched = 0;
        for (const ta of tokensA) {
            for (const tb of tokensB) {
                if (used.has(tb)) continue;
                if (tokensMatch(ta, tb)) {
                    used.add(tb);
                    matched++;
                    break;
                }
            }
        }
        score = (2 * matched) / (tokensA.size + tokensB.size);
        if (matched > 0) reasons.push(`${matched} token(s) parecidos`);
    }

    // Called out explicitly because it is the failure mode the admins actually hit.
    const swapped = normalize(a.name) === normalize(b.last_name) &&
        normalize(a.last_name) === normalize(b.name) &&
        normalize(a.name) !== normalize(a.last_name);
    if (swapped) reasons.push("nombre y apellido invertidos");

    if (a.invitee !== b.invitee) reasons.push("uno es invitado y el otro socio");

    const bothHaveDni = a.dni && b.dni;
    if (bothHaveDni && a.dni === b.dni) {
        score = 1;
        reasons.push("mismo DNI");
    } else if (!a.dni !== !b.dni) {
        reasons.push("uno sin DNI");
    }

    const ruledOut = Boolean(bothHaveDni && a.dni !== b.dni);
    if (ruledOut) reasons.push("DNIs distintos");

    return { a, b, score, reasons, ruledOut };
}

// ////////////////////////////////////
// MAIN
// ////////////////////////////////////

function describe(p: Player): string {
    const bits = [
        p.dni ? `dni=${p.dni}` : "sin dni",
        p.category ?? "sin categoria",
        p.invitee ? "invitado" : "socio",
        p.fecha_nac ?? "sin fecha nac",
    ];
    return `${`${p.name} | ${p.last_name}`.padEnd(38)} ${bits.join("  ")}`;
}

async function main() {
    const args = Deno.args;
    const showRuledOut = args.includes("--all");
    const thresholdArg = args.find((a) => a.startsWith("--threshold="));
    const threshold = thresholdArg ? Number(thresholdArg.split("=")[1]) : 0.62;

    if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
        console.error("--threshold must be between 0 and 1");
        Deno.exit(1);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
        console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
        Deno.exit(1);
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data, error } = await supabase
        .from("players")
        .select("id,name,last_name,dni,fecha_nac,category,invitee");

    if (error) {
        console.error("Failed to load players:", error.message);
        Deno.exit(1);
    }

    const players = data as Player[];
    console.log(`Comparing ${players.length} players (${players.length * (players.length - 1) / 2} pairs)\n`);

    const candidates: Candidate[] = [];
    for (let i = 0; i < players.length; i++) {
        for (let j = i + 1; j < players.length; j++) {
            const candidate = compare(players[i], players[j]);
            if (candidate && candidate.score >= threshold) candidates.push(candidate);
        }
    }

    candidates.sort((x, y) => y.score - x.score);
    const likely = candidates.filter((c) => !c.ruledOut);
    const ruledOut = candidates.filter((c) => c.ruledOut);

    console.log("=".repeat(78));
    console.log(`DUPLICATE CANDIDATES (${likely.length})`);
    console.log("=".repeat(78));
    for (const c of likely) {
        console.log(`\n  score ${c.score.toFixed(2)}  ${c.reasons.join(", ")}`);
        console.log(`    A  ${describe(c.a)}`);
        console.log(`    B  ${describe(c.b)}`);
        console.log(`       ${c.a.id}  /  ${c.b.id}`);
    }
    if (!likely.length) console.log("\n  none");

    // Whitespace-only names survive the trim migration and are worth knowing about.
    const blank = players.filter((p) => !p.name.trim() || !p.last_name.trim());
    if (blank.length) {
        console.log(`\n${"=".repeat(78)}`);
        console.log(`BLANK NAME FIELDS (${blank.length})`);
        console.log("=".repeat(78));
        for (const p of blank) console.log(`  ${describe(p)}  ${p.id}`);
    }

    if (ruledOut.length) {
        console.log(`\n${"=".repeat(78)}`);
        console.log(
            showRuledOut
                ? `RULED OUT BY DIFFERENT DNIs (${ruledOut.length})`
                : `Also ${ruledOut.length} name match(es) ruled out by having different DNIs. --all to see them.`,
        );
        console.log("=".repeat(78));
        if (showRuledOut) {
            for (const c of ruledOut) {
                console.log(`\n  score ${c.score.toFixed(2)}  ${c.reasons.join(", ")}`);
                console.log(`    A  ${describe(c.a)}`);
                console.log(`    B  ${describe(c.b)}`);
            }
        }
    }

    console.log("\nNothing was modified. Merge decisions are yours to make.");
}

if (import.meta.main) {
    await main();
}

export { compare, normalize, tokensOf };
export type { Player };
