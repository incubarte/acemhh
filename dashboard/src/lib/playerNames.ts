// Deciding whether two rows are the same person.
//
// Single source of truth: scripts/find-duplicate-players.ts imports this file
// directly rather than keeping its own copy, so a fix to the nickname table or the
// matching rules applies to both the report and the new-player guard.
//
// Pure string logic with no runtime-specific imports, which is what lets Deno and
// Next both load it.

/** Phrase an admin must type to save a player that looks like an existing one. */
export const DuplicateConfirmationPhrase = "no es un duplicado";

/** Similarity at or above which two names are treated as the same person. */
export const DuplicateThreshold = 0.62;

export function normalizeName(value: string): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when the admin typed the confirmation phrase, ignoring case and accents. */
export function matchesConfirmationPhrase(input: string | null | undefined): boolean {
  return normalizeName(input ?? "") === normalizeName(DuplicateConfirmationPhrase);
}

/**
 * Every token from both name fields, in one set.
 *
 * Deliberately order-blind and field-blind: admins have entered surnames in the name
 * column and vice versa, so "Nahuel"/"Zorrilla" and "Zorrilla"/"Nahuel" have to come
 * out identical. Comparing the fields separately would miss that entirely.
 */
export function nameTokens(name: string, lastName: string): Set<string> {
  return new Set(normalizeName(`${name} ${lastName}`).split(" ").filter(Boolean));
}

/**
 * Diminutives to the full names they can stand for.
 *
 * Deliberately one-to-many rather than a single canonical form, because most
 * diminutives are ambiguous: "Ale" is Alejandro or Alejandra, "Fran" is Francisco,
 * Franco or Francisca. Two tokens count as the same name when their possible
 * expansions overlap, so "Ale"/"Alejandro" match while "Alejandro"/"Alejandra" —
 * different people — do not.
 *
 * Add entries freely; a wrong one costs a pair shown for review, not a bad merge.
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
  luli: ["lucia", "luciana"],
  lupe: ["guadalupe"],
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

// Short tokens must match almost exactly — "ana" and "ema" are one edit apart but are
// not the same name.
export function tokensMatch(a: string, b: string): boolean {
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

export type NamedPerson = { name: string; last_name: string };

export type NameComparison = {
  score: number;
  reasons: string[];
};

/** How much two people's names look like the same person. 1 = certain. */
export function compareNames(a: NamedPerson, b: NamedPerson): NameComparison {
  const tokensA = nameTokens(a.name, a.last_name);
  const tokensB = nameTokens(b.name, b.last_name);
  if (tokensA.size === 0 || tokensB.size === 0) return { score: 0, reasons: [] };

  const reasons: string[] = [];
  let score: number;

  if (tokensA.size === tokensB.size && isSubset(tokensA, tokensB)) {
    score = 1;
    reasons.push("mismos tokens");
  } else if (isSubset(tokensA, tokensB) || isSubset(tokensB, tokensA)) {
    score = 0.9;
    reasons.push("uno tiene nombres de más");
  } else {
    // Dice coefficient over fuzzily matched tokens, which catches "Laborato"/
    // "Laboratto" and "Gesso"/"Guesso".
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
  const swapped = normalizeName(a.name) === normalizeName(b.last_name) &&
    normalizeName(a.last_name) === normalizeName(b.name) &&
    normalizeName(a.name) !== normalizeName(a.last_name);
  if (swapped) reasons.push("nombre y apellido invertidos");

  return { score, reasons };
}

export function looksLikeSamePerson(a: NamedPerson, b: NamedPerson): boolean {
  return compareNames(a, b).score >= DuplicateThreshold;
}
