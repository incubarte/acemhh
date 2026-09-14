// Cruza la lista de un torneo (equipos y jugadores) contra producción y, cuando
// todos resuelven, emite el SQL de la migración que carga los equipos.
//
//   deno run --allow-net --allow-env --allow-read scripts/tournament-roster.ts \
//     backfill/interclubes-clausura-2026.csv            # reporte
//   deno run --allow-net --allow-env --allow-read scripts/tournament-roster.ts \
//     backfill/interclubes-clausura-2026.csv --sql      # la migración, por stdout
//   deno run --allow-net --allow-env --allow-read scripts/tournament-roster.ts \
//     backfill/interclubes-clausura-2026.csv --verify   # después del db push
//
// Producción sólo se lee (credenciales de dashboard/.env.prod, como find-player).
//
// La lista viene con DNI, así que el DNI manda: es exacto y es lo que la
// migración usa para encontrar al jugador en cualquier base. El nombre entra
// para explicar lo que el DNI no resuelve — "no está" no es lo mismo que
// "está sin DNI cargado" — y para avisar cuando un DNI apunta a otra persona.
//
// Columnas del CSV: equipo,categoria,apellido,nombre,designacion,dni,player_id.
//
// - `designacion` (C = capitán, A = alterno, GK = arquero) es informativa: no
//   se guarda. Todos entran como titulares; el suplente se marca después a mano.
// - `player_id` es opcional y es la forma de confirmar a mano a quién se
//   refiere una fila cuando el nombre no coincide exacto ("Chevallier" vs
//   "Chevalier"). Con el id, la migración le carga el DNI de la lista si no
//   tenía, y de ahí en más lo encuentra por DNI como a todos.
//
// Quien está en producción con el mismo nombre exacto y sin DNI se acepta
// solo: la migración le carga el DNI. Las variantes de escritura no se
// puentean solas — se reportan, y se confirman con `player_id`.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { compareNames, DuplicateThreshold, nameTokens, normalizeName } from "../dashboard/src/lib/playerNames.ts";

function env(name: string): string {
    const fromEnv = Deno.env.get(name);
    if (fromEnv) return fromEnv;
    const path = new URL("../dashboard/.env.prod", import.meta.url).pathname;
    const text = Deno.readTextFileSync(path);
    const line = text.split("\n").find((l) => l.startsWith(`${name}=`));
    if (!line) throw new Error(`${name} missing from dashboard/.env.prod`);
    return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, "");
}

type Row = {
    team: string;
    category: string;
    last_name: string;
    name: string;
    designation: string;
    dni: string;
    player_id: string;
};

type Player = { id: string; name: string; last_name: string; dni: string | null };

/** Un DNI que no es un DNI: vacío o un relleno como "1". */
function placeholderDni(dni: string | null): boolean {
    return !dni || dni.trim().length < 6;
}

function parseCsv(text: string): Row[] {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const header = lines[0].split(",");
    const col = (name: string, required = true) => {
        const i = header.indexOf(name);
        if (i < 0 && required) throw new Error(`Falta la columna ${name}`);
        return i;
    };
    const c = {
        team: col("equipo"),
        category: col("categoria"),
        last_name: col("apellido"),
        name: col("nombre"),
        designation: col("designacion"),
        dni: col("dni"),
        player_id: col("player_id", false),
    };
    return lines.slice(1).map((l) => {
        const f = l.split(",").map((x) => x.trim());
        return {
            team: f[c.team],
            category: f[c.category],
            last_name: f[c.last_name],
            name: f[c.name],
            designation: f[c.designation],
            dni: f[c.dni],
            player_id: c.player_id >= 0 ? (f[c.player_id] ?? "") : "",
        };
    });
}

const args = Deno.args.filter((a) => !a.startsWith("--"));
const mode = Deno.args.includes("--sql") ? "sql" : Deno.args.includes("--verify") ? "verify" : "report";
const tournamentName = Deno.args.find((a) => a.startsWith("--tournament="))?.slice(13) ??
    "Interclubes Clausura 2026";
if (!args[0]) {
    console.error("uso: tournament-roster.ts <csv> [--sql | --verify] [--tournament=<nombre>]");
    Deno.exit(1);
}
const rows = parseCsv(Deno.readTextFileSync(args[0]));

const prod = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
});
const { data, error } = await prod.from("players").select("id,name,last_name,dni");
if (error) throw new Error(error.message);
const players = (data ?? []) as Player[];
const byDni = new Map<string, Player>();
for (const p of players) if (p.dni) byDni.set(p.dni.trim(), p);
const byId = new Map(players.map((p) => [p.id, p]));

// ------------------------------------------------------------ resolución
type Resolution =
    /** Encontrado por DNI. */
    | { kind: "ok"; player: Player }
    /** Encontrado por id o por nombre exacto; hay que cargarle el DNI. */
    | { kind: "sin-dni"; player: Player; via: "id" | "nombre" }
    /** Confirmado por id, pero producción tiene OTRO DNI: alguien se equivocó. */
    | { kind: "dni-distinto"; player: Player }
    /** El DNI de la fila es de otra persona. */
    | { kind: "dni-de-otro"; player: Player; suggestions: Player[] }
    /** No hay ese DNI; hay gente con nombre parecido. */
    | { kind: "parecido"; suggestions: Player[] }
    | { kind: "no-esta" };

const squash = (s: string) => normalizeName(s).replace(/[\s-]/g, "");

/** El DNI es la clave fuerte; el nombre sólo tiene que no contradecirlo. Basta
 * con que coincida el apellido o el nombre (sin espacios ni guiones, así
 * "Di Gangi" y "Digangi" son lo mismo) o que se parezcan en general. */
function nameCompatible(row: Row, p: Player): boolean {
    return squash(row.last_name) === squash(p.last_name) ||
        squash(row.name) === squash(p.name) ||
        compareNames(row, p).score >= DuplicateThreshold;
}

/** Los mismos tokens, letra por letra: "Chevallier" y "Chevalier" NO son lo
 * mismo acá, aunque compareNames los puentee. Esas variantes se confirman a
 * mano con player_id. */
function exactSameName(row: Row, p: Player): boolean {
    const a = [...nameTokens(row.name, row.last_name)].sort().join(" ");
    const b = [...nameTokens(p.name, p.last_name)].sort().join(" ");
    return a.length > 0 && a === b;
}

function suggestionsFor(row: Row): Player[] {
    return players
        .map((p) => ({ p, c: compareNames(row, p) }))
        .filter((x) => x.c.score >= DuplicateThreshold)
        .sort((a, b) => b.c.score - a.c.score)
        .slice(0, 3)
        .map((x) => x.p);
}

function resolve(row: Row): Resolution {
    if (row.player_id) {
        const p = byId.get(row.player_id);
        if (!p) throw new Error(`${row.last_name}, ${row.name}: player_id ${row.player_id} no existe`);
        if (p.dni === row.dni) return { kind: "ok", player: p };
        if (placeholderDni(p.dni)) return { kind: "sin-dni", player: p, via: "id" };
        return { kind: "dni-distinto", player: p };
    }
    const hit = byDni.get(row.dni);
    if (hit) {
        if (nameCompatible(row, hit)) return { kind: "ok", player: hit };
        return { kind: "dni-de-otro", player: hit, suggestions: suggestionsFor(row) };
    }
    const suggestions = suggestionsFor(row);
    const exact = suggestions.filter((p) => exactSameName(row, p));
    if (exact.length === 1 && placeholderDni(exact[0].dni)) {
        return { kind: "sin-dni", player: exact[0], via: "nombre" };
    }
    return suggestions.length > 0 ? { kind: "parecido", suggestions } : { kind: "no-esta" };
}

const resolved = rows.map((row) => ({ row, res: resolve(row) }));
const clean = (r: Resolution) => r.kind === "ok" || r.kind === "sin-dni";

// Un mismo DNI en dos filas con nombres distintos es un error de la lista, no
// dos personas.
const dniOwners = new Map<string, Set<string>>();
for (const r of rows) {
    const who = `${r.last_name}, ${r.name}`;
    const set = dniOwners.get(r.dni) ?? new Set();
    set.add(who);
    dniOwners.set(r.dni, set);
}
const sharedDnis = [...dniOwners.entries()].filter(([, who]) => who.size > 1);

const label = (p: Player) => `${p.last_name}, ${p.name} (dni ${p.dni ?? "—"})`;

// ------------------------------------------------------------ reporte
if (mode === "report") {
    let team = "";
    let problems = 0;
    for (const { row, res } of resolved) {
        if (row.team !== team) {
            team = row.team;
            console.log(`\n## ${team} · ${row.category}`);
        }
        const who = `${row.last_name}, ${row.name}`.padEnd(28);
        const tag = row.designation ? ` [${row.designation}]` : "";
        const head = `${who} ${row.dni}${tag}`;
        switch (res.kind) {
            case "ok":
                console.log(`  ✓ ${head}`);
                break;
            case "sin-dni":
                console.log(`  ✓ ${head} — está sin DNI (${res.via === "id" ? "confirmado por id" : "mismo nombre"}); la migración se lo carga`);
                break;
            case "dni-distinto":
                console.log(`  ✗ ${head} — confirmado por id, pero producción dice dni ${res.player.dni}: corregir uno de los dos`);
                problems++;
                break;
            case "dni-de-otro":
                console.log(`  ✗ ${head} — ese DNI es de ${label(res.player)}` +
                    (res.suggestions.length ? `; ¿será ${res.suggestions.map(label).join(" / ")}?` : ""));
                problems++;
                break;
            case "parecido":
                console.log(`  ? ${head} — no hay ese DNI; parecido: ${res.suggestions.map((p) => `${label(p)} id=${p.id}`).join(" / ")}`);
                problems++;
                break;
            case "no-esta":
                console.log(`  ✗ ${head} — no está en producción`);
                problems++;
                break;
        }
    }
    if (sharedDnis.length) {
        console.log("\n## DNI repetido en la lista con nombres distintos");
        for (const [dni, who] of sharedDnis) console.log(`  ${dni}: ${[...who].join(" · ")}`);
    }
    const ok = resolved.filter((r) => clean(r.res)).length;
    console.log(`\n${ok} de ${rows.length} filas resueltas, ${problems} con problemas.`);
    Deno.exit(problems || sharedDnis.length ? 2 : 0);
}

// ------------------------------------------------------------ verify
if (mode === "verify") {
    const { data: t } = await prod.from("tournaments").select("id").eq("name", tournamentName).maybeSingle();
    if (!t) {
        console.error(`No hay torneo ${tournamentName} en producción`);
        Deno.exit(2);
    }
    const { data: teams } = await prod.from("teams").select("id,name").eq("tournament_id", t.id);
    const teamIds = (teams ?? []).map((x) => x.id);
    const { data: members } = teamIds.length
        ? await prod.from("team_players").select("team_id,player_id").in("team_id", teamIds)
        : { data: [] };
    const teamName = new Map((teams ?? []).map((x) => [x.id, x.name]));
    const have = new Set((members ?? []).map((m) => `${teamName.get(m.team_id)}|${byId.get(m.player_id)?.dni}`));
    const want = rows.map((r) => `${r.team}|${r.dni}`);
    const missing = want.filter((k) => !have.has(k));
    const extra = [...have].filter((k) => !want.includes(k));
    for (const k of missing) console.log(`  falta: ${k}`);
    for (const k of extra) console.log(`  sobra: ${k}`);
    console.log(`${want.length - missing.length} de ${want.length} en producción, ${extra.length} de más.`);
    Deno.exit(missing.length || extra.length ? 2 : 0);
}

// ------------------------------------------------------------ SQL
if (resolved.some((r) => !clean(r.res)) || sharedDnis.length) {
    console.error("La lista no está limpia; correr sin --sql para ver qué falta.");
    Deno.exit(2);
}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const teams = [...new Map(rows.map((r) => [r.team, r.category])).entries()]
    // Ids fijos: así producción y la base local comparten los mismos equipos
    // y el import de producción puede copiar team_players tal cual.
    .map(([team, category]) => ({ team, category, id: crypto.randomUUID() }));
const dnis = [...new Set(rows.map((r) => r.dni))];
const fills = resolved.filter((r) => r.res.kind === "sin-dni") as
    { row: Row; res: { kind: "sin-dni"; player: Player; via: string } }[];

const out: string[] = [];
out.push(`-- Equipos y jugadores del ${tournamentName}.`);
out.push(`--`);
out.push(`-- Generado por scripts/tournament-roster.ts a partir de`);
out.push(`-- ${args[0]}. Los jugadores se referencian por DNI: es lo que`);
out.push(`-- identifica a la misma persona en cualquier base.`);
out.push(`--`);
out.push(`-- En la base local, antes de importar producción, sólo están los jugadores`);
out.push(`-- del seed: la migración carga a los que encuentra y no falla por los`);
out.push(`-- demás. Que en producción hayan entrado todos lo confirma`);
out.push(`--   scripts/tournament-roster.ts <csv> --verify`);
out.push(`-- después del db push.`);
out.push(`--`);
out.push(`-- Todos entran como titulares; los suplentes se marcan después a mano.`);
out.push(``);
if (fills.length) {
    out.push(`-- Jugadores que estaban cargados sin DNI. Se los identifica por id (el de`);
    out.push(`-- producción; en local la fila no existe hasta el import y el UPDATE no`);
    out.push(`-- toca nada) y sólo se escribe donde no había un DNI real.`);
    for (const { row, res } of fills) {
        out.push(`UPDATE players SET dni = ${q(row.dni)}`);
        out.push(`  WHERE id = ${q(res.player.id)} AND (dni IS NULL OR length(dni) < 6)`);
        out.push(`  AND NOT EXISTS (SELECT 1 FROM players WHERE dni = ${q(row.dni)}); -- ${row.last_name}, ${row.name}`);
    }
    out.push(``);
}
out.push(`WITH t AS (`);
out.push(`  SELECT id FROM tournaments WHERE name = ${q(tournamentName)}`);
out.push(`), new_teams AS (`);
out.push(`  INSERT INTO teams (id, tournament_id, category_id, name)`);
out.push(`  SELECT v.id::uuid, t.id, c.id, v.team`);
out.push(`  FROM t`);
out.push(`  CROSS JOIN (VALUES`);
out.push(teams.map((x) => `    (${q(x.id)}, ${q(x.team)}, ${q(x.category)})`).join(",\n"));
out.push(`  ) AS v(id, team, category)`);
out.push(`  JOIN tournament_categories c ON c.tournament_id = t.id AND c.name = v.category`);
out.push(`  RETURNING id, name`);
out.push(`)`);
out.push(`INSERT INTO team_players (team_id, player_id, role)`);
out.push(`SELECT nt.id, p.id, 'starter'`);
out.push(`FROM (VALUES`);
// La coma va antes del comentario: después de él ya es comentario también.
out.push(rows.map((r, i) =>
    `  (${q(r.team)}, ${q(r.dni)})${i < rows.length - 1 ? "," : ""}  -- ${r.last_name}, ${r.name}${r.designation ? ` [${r.designation}]` : ""}`
).join("\n"));
out.push(`) AS m(team, dni)`);
out.push(`JOIN new_teams nt ON nt.name = m.team`);
out.push(`JOIN players p ON p.dni = m.dni;`);
out.push(``);
out.push(`-- Los ${teams.length} equipos tienen que existir aunque falten jugadores.`);
out.push(`DO $$`);
out.push(`DECLARE n INT;`);
out.push(`BEGIN`);
out.push(`  SELECT count(*) INTO n FROM teams tm`);
out.push(`  JOIN tournaments t ON t.id = tm.tournament_id AND t.name = ${q(tournamentName)};`);
out.push(`  IF n <> ${teams.length} THEN`);
out.push(`    RAISE EXCEPTION 'Se esperaban ${teams.length} equipos y hay %', n;`);
out.push(`  END IF;`);
out.push(`  SELECT count(*) INTO n FROM team_players tp`);
out.push(`  JOIN teams tm ON tm.id = tp.team_id`);
out.push(`  JOIN tournaments t ON t.id = tm.tournament_id AND t.name = ${q(tournamentName)};`);
out.push(`  RAISE NOTICE '${tournamentName}: % de ${rows.length} jugadores cargados en sus equipos', n;`);
out.push(`END $$;`);
console.log(out.join("\n"));
