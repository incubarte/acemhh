// The phone's side of the activity log: every action is written to this
// browser's storage first and sent right away. A line the server confirms is
// dropped from storage; one that could not be sent stays and is retried —
// from this page, from another tab, or the next time the dashboard opens —
// carrying how many sends it took and whether the page that took the action
// had closed by then.

const Prefix = "activity:";
const Endpoint = "/api/activity";
const MaxBatch = 100;
const RetryDelays = [5_000, 15_000, 30_000, 60_000];

export type ActivityEntry = {
  id: string;
  client_at: number;
  screen: string;
  action: string;
  detail: Record<string, unknown>;
  trace?: string;
  tab: string;
  seq: number;
  /** The page load that took the action. */
  page: string;
  attempts: number;
};

// ---- storage, which can be missing or full: memory stands in ----

const memory = new Map<string, string>();

function storeSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    memory.set(key, value);
  }
}

function storeRemove(key: string) {
  memory.delete(key);
  try {
    localStorage.removeItem(key);
  } catch { /* nothing to remove */ }
}

function pending(): ActivityEntry[] {
  const out: ActivityEntry[] = [];
  const read = (raw: string | null) => {
    if (!raw) return;
    try {
      out.push(JSON.parse(raw) as ActivityEntry);
    } catch { /* a corrupt line is no line */ }
  };
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(Prefix)) read(localStorage.getItem(k));
    }
  } catch { /* no storage */ }
  for (const v of memory.values()) read(v);
  const seen = new Set<string>();
  return out
    .filter((e) => !seen.has(e.id) && seen.add(e.id))
    .sort((a, b) => a.client_at - b.client_at);
}

// ---- identity of this tab and this page load ----

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // Older browsers, or a page that is not a secure context.
    return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
      (Number(c) ^ (Math.random() * 16 >> (Number(c) / 4))).toString(16));
  }
}

const pageId = typeof window === "undefined" ? "" : newId().slice(0, 8);

function session(key: string, make: () => string): string {
  try {
    const v = sessionStorage.getItem(key);
    if (v) return v;
    const fresh = make();
    sessionStorage.setItem(key, fresh);
    return fresh;
  } catch {
    return make();
  }
}

let memoryTab: string | null = null;
function tabId(): string {
  memoryTab ??= session("activity-tab", () => newId().slice(0, 6));
  return memoryTab;
}

let memorySeq = 0;
/** Counts per tab, across reloads: a gap in it is a line that never arrived. */
function nextSeq(): number {
  try {
    const n = Number(sessionStorage.getItem("activity-seq") ?? "0") + 1;
    sessionStorage.setItem("activity-seq", String(n));
    return n;
  } catch {
    return ++memorySeq;
  }
}

// ---- sending ----

let nativeFetch: typeof fetch | null = null;
/** fetch from before the interceptor in ActivityTracker wrapped it. */
export function rememberNativeFetch(f: typeof fetch) {
  nativeFetch ??= f;
}

/** `closing`: sent as the page goes away, so it lands after it closed. */
function payload(entries: ActivityEntry[], closing = false) {
  const sentAt = Date.now();
  return JSON.stringify({
    entries: entries.map((e) => ({
      id: e.id,
      client_at: e.client_at,
      sent_at: sentAt,
      screen: e.screen,
      action: e.action,
      detail: e.detail,
      trace: e.trace,
      tab: e.tab,
      seq: e.seq,
      attempts: e.attempts,
      after_close: closing || e.page !== pageId,
    })),
  });
}

/** Counts this send against each entry before it goes out. */
function claim(entries: ActivityEntry[]): ActivityEntry[] {
  return entries.map((e) => {
    const next = { ...e, attempts: e.attempts + 1 };
    storeSet(Prefix + e.id, JSON.stringify(next));
    return next;
  });
}

// ---- which page sends what ----
//
// Each page sends its own lines. A line of another page is taken over only
// once that page has stopped saying it is alive: it was closed, or the phone
// killed it, before its line went out. That is what "after_close" reports.

const AlivePrefix = "activity-alive:";
const AliveEvery = 10_000;
/** Background tabs get their timers slowed to about once a minute. */
const DeadAfter = 150_000;

function readAlive(): Map<string, number> {
  const m = new Map<string, number>();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(AlivePrefix)) m.set(k.slice(AlivePrefix.length), Number(localStorage.getItem(k)));
    }
  } catch { /* no storage: only this page's lines exist */ }
  return m;
}

export function heartbeat() {
  const now = Date.now();
  storeSet(AlivePrefix + pageId, String(now));
  for (const [page, at] of readAlive()) {
    if (page !== pageId && now - at > 24 * 3600 * 1000) storeRemove(AlivePrefix + page);
  }
}
export const HeartbeatEvery = AliveEvery;

export function pageGone() {
  storeRemove(AlivePrefix + pageId);
}

/** This page's lines, and those of pages that are gone. */
function sendable(): ActivityEntry[] {
  const alive = readAlive();
  const now = Date.now();
  return pending().filter((e) => {
    if (e.page === pageId) return true;
    const at = alive.get(e.page);
    return at === undefined || now - at > DeadAfter;
  });
}

let flushing = false;
let again = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let failures = 0;

async function sendBatch(): Promise<"done" | "more" | "failed"> {
  const batch = sendable().slice(0, MaxBatch);
  if (batch.length === 0) return "done";
  const claimed = claim(batch);
  try {
    const res = await (nativeFetch ?? fetch)(Endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload(claimed),
      keepalive: true,
      credentials: "same-origin",
    });
    if (!res.ok) return "failed";
    for (const e of claimed) storeRemove(Prefix + e.id);
    return claimed.length === MaxBatch ? "more" : "done";
  } catch {
    return "failed";
  }
}

function scheduleRetry() {
  if (retryTimer) return;
  const delay = RetryDelays[Math.min(failures, RetryDelays.length - 1)];
  failures++;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void flush();
  }, delay);
}

/** Sends what this page has to send. */
export async function flush(): Promise<void> {
  if (typeof window === "undefined") return;
  if (flushing) {
    again = true;
    return;
  }
  flushing = true;
  try {
    let outcome: "done" | "more" | "failed";
    do {
      outcome = await sendBatch();
    } while (outcome === "more");
    if (outcome === "failed") scheduleRetry();
    else failures = 0;
  } finally {
    flushing = false;
    if (again) {
      again = false;
      void flush();
    }
  }
}

/** Whether anything is still waiting to be sent from this page. */
export function hasPending(): boolean {
  return sendable().length > 0;
}

/** The last chance, as the page goes away: the browser finishes it. What
 * stays in storage is sent again later, and the server keeps it once. */
export function flushOnClose() {
  const batch = sendable().slice(0, MaxBatch);
  if (batch.length === 0 || !navigator.sendBeacon) return;
  const claimed = claim(batch);
  try {
    navigator.sendBeacon(Endpoint, new Blob([payload(claimed, true)], { type: "application/json" }));
  } catch { /* the next load sends it */ }
}

/** A focus the page sets while a player's panel is open, so taps inside it
 * say which player they were for. */
let focus: Record<string, unknown> = {};
export function setActivityFocus(f: Record<string, unknown> | null) {
  focus = f ?? {};
}

/**
 * Records an action. Returns its id, which a submit passes on as the trace
 * of the request it sends.
 */
export function track(
  action: string,
  detail: Record<string, unknown> = {},
  opts: { trace?: string; screen?: string } = {},
): string {
  if (typeof window === "undefined") return "";
  const entry: ActivityEntry = {
    id: newId(),
    client_at: Date.now(),
    screen: opts.screen ?? location.pathname,
    action,
    detail: { ...focus, ...detail },
    trace: opts.trace,
    tab: tabId(),
    seq: nextSeq(),
    page: pageId,
    attempts: 0,
  };
  storeSet(Prefix + entry.id, JSON.stringify(entry));
  void flush();
  return entry.id;
}

export function newTrace(): string {
  return newId().slice(0, 13);
}
