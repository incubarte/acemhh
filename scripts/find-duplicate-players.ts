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
// Shared with the dashboard so the new-player guard and this report agree on what
// counts as the same person. Fixes to the nickname table land in both.
import { compareNames, nameTokens } from "../dashboard/src/lib/playerNames.ts";

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
    if (nameTokens(a.name, a.last_name).size === 0) return null;
    if (nameTokens(b.name, b.last_name).size === 0) return null;

    const { score: nameScore, reasons } = compareNames(a, b);
    let score = nameScore;

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

export { compare };
export type { Player };
