// Turns activity_log rows into the lines the Actividad page shows:
//   18:00:06 · Ale · UI · sesión 13/11 23hs · submit cobro · j:Jose Perez $25k session · en vivo

export type ActivityRow = {
  id: string;
  at: string;
  received_at: string;
  source: "UI" | "API" | "DB";
  actor_id: string | null;
  actor: string | null;
  screen: string | null;
  action: string;
  detail: Record<string, unknown>;
  trace: string | null;
  tab: string | null;
  seq: number | null;
  attempts: number | null;
  after_close: boolean | null;
  delay_ms: number | null;
  status: number | null;
};

export type Names = { users: Record<string, string>; players: Record<string, string> };

export type Line = {
  id: string;
  time: string;
  who: string;
  source: ActivityRow["source"];
  where: string;
  what: string;
  context: string;
  /** How the line reached the server: UI lines only. */
  delivery: string | null;
  /** Something worth a look: a refusal, a deletion, a late or lost line. */
  warn: boolean;
  trace: string | null;
  playerIds: string[];
  actorKey: string;
};

const BA = "America/Argentina/Buenos_Aires";

export function timeBA(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-AR", { timeZone: BA, hour12: false });
}

function first(name: string | undefined): string {
  return name?.split(" ")[0] ?? "";
}

export function money(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n);
  return v % 1000 === 0 ? `$${v / 1000}k` : `$${v.toLocaleString("es-AR")}`;
}

function sessionLabel(s: string): string {
  // 2026-11-13-23 or "2026-11-13 23hs"
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[- ](\d{1,2})/);
  return m ? `${m[3]}/${m[2]} ${m[4]}hs` : s;
}

export function screenLabel(path: string | null): string {
  if (!path) return "";
  const p = path.replace(/\/+$/, "") || "/";
  let m: RegExpMatchArray | null;
  if (p === "/") return "inicio";
  if ((m = p.match(/^\/training-sessions(-beta)?\/(.+)$/))) return `sesión ${sessionLabel(m[2])}${m[1] ? " (beta)" : ""}`;
  if (p === "/training-sessions") return "entrenamientos";
  if (p.startsWith("/torneos/equipos/")) return "torneos · equipo";
  if (p.startsWith("/torneos")) return "torneos";
  if (p === "/payments") return "cuota social";
  if (p.startsWith("/caja")) return p === "/caja" ? "caja" : `caja · ${p.slice(6)}`;
  if (p === "/players/new") return "nuevo jugador";
  if (p === "/analisis") return "análisis";
  if (p === "/actividad") return "actividad";
  return p;
}

/** What a request to the API was for. */
export function apiLabel(path: string): string {
  if (/\/training-sessions\/[^/]+\/payment$/.test(path)) return "cobro";
  if (/\/training-sessions\/[^/]+\/attendance$/.test(path)) return "asistencia";
  if (path === "/api/payments/dues") return "cuota social";
  if (/\/torneos\/equipos\/[^/]+\/pago$/.test(path)) return "pago torneo";
  if (path === "/api/incomes") return "ingreso";
  if (path === "/api/expenses") return "egreso";
  if (path === "/api/handoffs") return "entrega de caja";
  if (path === "/api/handoffs/accept") return "acepta entrega";
  if (path === "/api/players") return "jugador";
  return path;
}

function sessionOf(path: string): string | null {
  const m = path.match(/\/training-sessions(?:-beta)?\/(\d{4}-\d{2}-\d{2}-\d{1,2})/);
  return m ? sessionLabel(m[1]) : null;
}

const quote = (v: unknown) => `"${String(v)}"`;

/** The fields of a body or a row that say what it was, as short pieces. */
function describe(o: Record<string, unknown>, names: Names, ids: string[]): string[] {
  const out: string[] = [];
  const pid = o.player_id;
  if (typeof pid === "string") {
    ids.push(pid);
    out.push(`j:${quote(names.players[pid] ?? pid.slice(0, 8))}`);
  }
  if (o.session && typeof o.session === "string") out.push(`s:${sessionLabel(o.session)}`);
  if (o.amount !== undefined && o.amount !== null) out.push(money(o.amount));
  if (o.concept) out.push(String(o.concept));
  if (o.month && !o.session) out.push(`mes:${o.month}`);
  if (o.slot_weekday !== undefined && o.slot_hour !== undefined && o.slot_hour !== null) out.push(`slot:${o.slot_hour}hs`);
  if (o.attended !== undefined) out.push(o.attended ? "presente" : "ausente");
  if (o.transfer === true || o.is_cash === false) out.push("transferencia");
  if (o.notes) out.push(`nota:${quote(o.notes)}`);
  if (o.confirm_duplicate) out.push("(confirmó duplicado)");
  if (o.confirm_closed) out.push("(confirmó sesión cerrada)");
  if (o.to_user && typeof o.to_user === "string") out.push(`a:${first(names.users[o.to_user]) || o.to_user.slice(0, 8)}`);
  if (o.registered_by && typeof o.registered_by === "string") out.push(`por:${quote(String(o.registered_by).replace(/ \[id=.*\]$/, ""))}`);
  if (typeof o.name === "string" || typeof o.last_name === "string") {
    out.push(quote([o.name, o.last_name].filter(Boolean).join(" ")));
  }
  return out;
}

function changes(oldRow: Record<string, unknown>, newRow: Record<string, unknown>): string[] {
  return Object.keys(newRow).map((k) => {
    const fmt = (v: unknown) => k === "amount" ? money(v) : v === null ? "∅" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return `${k}:${fmt(oldRow[k])}→${fmt(newRow[k])}`;
  });
}

export function deliveryOf(r: ActivityRow): string | null {
  if (r.source !== "UI") return null;
  const attempts = r.attempts ?? 1;
  if (attempts <= 1 && !r.after_close) return "en vivo";
  const parts = [`reintento ×${Math.max(1, attempts - 1)}`, `+${duration(r.delay_ms ?? 0)}`];
  if (r.after_close) parts.push("después de cerrar");
  return parts.join(", ");
}

export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${s % 60 ? `${s % 60}s` : ""}`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60 ? `${m % 60}m` : ""}`;
}

export function formatLine(r: ActivityRow, names: Names): Line {
  const d = r.detail ?? {};
  const ids: string[] = [];
  const who = r.actor_id ? (first(names.users[r.actor_id]) || r.actor_id.slice(0, 8)) : (r.actor ?? "?");
  let where = r.source === "UI" ? screenLabel(r.screen) : "";
  let what = r.action;
  let context: string[] = [];
  let warn = false;

  if (r.source === "UI") {
    switch (r.action) {
      case "nav":
        what = "nav";
        break;
      case "tap":
        what = `tap ${quote(d.label ?? "")}`;
        break;
      case "input":
        what = `input ${quote(d.label ?? "")} = ${quote(d.value ?? "")}`;
        break;
      case "submit": {
        const api = String(d.api ?? "");
        what = `submit ${apiLabel(api)}`;
        const s = sessionOf(api);
        if (s && !where.includes(s)) context.push(`s:${s}`);
        break;
      }
      case "sin respuesta":
        what = `sin respuesta de ${apiLabel(String(d.api ?? ""))}`;
        warn = true;
        break;
      case "alerta":
        what = `alerta ${quote(d.message ?? "")}`;
        warn = true;
        break;
      case "pregunta":
        what = `pregunta ${quote(d.message ?? "")} → ${d.answer}`;
        break;
    }
    const body = (d.body && typeof d.body === "object") ? d.body as Record<string, unknown> : {};
    context = [...context, ...describe({ ...body, ...(d.player_id ? { player_id: d.player_id } : {}) }, names, ids)];
  } else if (r.source === "API") {
    const [, path = ""] = r.action.split(" ");
    const s = sessionOf(path);
    where = s ? `sesión ${s}` : "";
    what = `recibió ${apiLabel(path)} → ${r.status}`;
    const body = (d.body && typeof d.body === "object") ? d.body as Record<string, unknown> : {};
    context = describe(body, names, ids);
    if (d.reason && (r.status ?? 0) >= 300) context.push(quote(d.reason));
    warn = (r.status ?? 0) >= 400;
  } else {
    const [op, table] = r.action.split(" ");
    what = `${op} ${table}`;
    if (op === "update") {
      const pid = d.player_id;
      context = describe(typeof pid === "string" ? { player_id: pid } : {}, names, ids);
      context.push(...changes((d.old ?? {}) as Record<string, unknown>, (d.new ?? {}) as Record<string, unknown>));
    } else {
      context = describe((d.row ?? {}) as Record<string, unknown>, names, ids);
    }
    warn = op === "delete" || r.actor === "manual";
  }

  const delivery = deliveryOf(r);
  if (delivery && delivery !== "en vivo") warn = true;

  return {
    id: r.id,
    time: timeBA(r.at),
    who,
    source: r.source,
    where,
    what,
    context: context.join(" "),
    delivery,
    warn,
    trace: r.trace,
    playerIds: ids,
    actorKey: r.actor_id ?? r.actor ?? "?",
  };
}

/** Lines a tab sent with a jump in its count: the missing ones never came. */
export function gapsOf(rows: ActivityRow[]): Map<string, number> {
  const byTab = new Map<string, ActivityRow[]>();
  for (const r of rows) {
    if (r.source !== "UI" || !r.tab || r.seq === null) continue;
    const list = byTab.get(r.tab) ?? [];
    list.push(r);
    byTab.set(r.tab, list);
  }
  const gaps = new Map<string, number>();
  for (const list of byTab.values()) {
    list.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    for (let i = 1; i < list.length; i++) {
      const missing = (list[i].seq ?? 0) - (list[i - 1].seq ?? 0) - 1;
      if (missing > 0) gaps.set(list[i].id, missing);
    }
  }
  return gaps;
}
