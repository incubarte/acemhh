"use client";

// Writes the UI lines of the activity log for the whole dashboard: where the
// user goes, what they tap, the values they enter, the alerts and questions
// they are shown, and every request that changes something, with the trace
// that ties it to the service's answer and to the rows it wrote.

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { isPublicRoute } from "@/lib/acl";
import {
  flush,
  flushOnClose,
  hasPending,
  heartbeat,
  HeartbeatEvery,
  newTrace,
  pageGone,
  rememberNativeFetch,
  track,
} from "@/lib/activity";

/** Logged-out pages are not logged: nobody to attribute them to, and their
 * lines would wait forever for a session. */
const logging = () => !isPublicRoute(location.pathname);

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function labelOf(el: Element): string {
  const explicit = el.getAttribute("data-activity") ?? el.getAttribute("aria-label") ?? el.getAttribute("title");
  if (explicit) return clip(explicit.trim(), 60);
  const text = (el as HTMLElement).innerText ?? el.textContent ?? "";
  return clip(text.replace(/\s+/g, " ").trim(), 60) || el.tagName.toLowerCase();
}

/** The player a row or a panel is about, for taps inside it. */
function playerOf(el: Element): Record<string, unknown> {
  const id = el.closest("[data-activity-player]")?.getAttribute("data-activity-player");
  return id ? { player_id: id } : {};
}

function fieldName(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): string {
  const label = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent : null;
  return clip(
    (el.getAttribute("data-activity") ?? el.getAttribute("aria-label") ?? label ?? el.name ??
      (el as HTMLInputElement).placeholder ?? "").trim() || el.tagName.toLowerCase(),
    60,
  );
}

let installed = false;

function install() {
  if (installed) return;
  installed = true;

  // ---- requests that change something: a submit line, and its trace on the request ----
  const native = window.fetch.bind(window);
  rememberNativeFetch(native);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    let path = "";
    let method = "GET";
    try {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, location.href);
      method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      path = url.origin === location.origin ? url.pathname : "";
    } catch { /* not ours to log */ }

    if (!logging() || method === "GET" || !path.startsWith("/api/") || path === "/api/activity" || path.startsWith("/api/auth")) {
      return native(input, init);
    }

    let body: unknown = null;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = clip(init.body, 300);
      }
    }
    const trace = newTrace();
    track("submit", { api: path, body }, { trace });

    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set("x-activity-trace", trace);
    try {
      return await native(input, { ...init, headers });
    } catch (e) {
      // It never got an answer: the service may or may not have it. Its API
      // line, or the lack of one, says which.
      track("sin respuesta", { api: path, error: clip(String(e), 200) }, { trace });
      throw e;
    }
  };

  // ---- what the user is told, and what they answer ----
  const nativeAlert = window.alert.bind(window);
  window.alert = (message?: unknown) => {
    if (logging()) track("alerta", { message: clip(String(message ?? ""), 300) });
    nativeAlert(message);
  };
  const nativeConfirm = window.confirm.bind(window);
  window.confirm = (message?: string) => {
    const answer = nativeConfirm(message);
    if (logging()) track("pregunta", { message: clip(String(message ?? ""), 300), answer: answer ? "sí" : "no" });
    return answer;
  };

  // ---- taps and entered values ----
  document.addEventListener("click", (ev) => {
    if (!logging()) return;
    const target = ev.target instanceof Element ? ev.target : null;
    const el = target?.closest("button, a, [role=button], [data-activity], input[type=checkbox], input[type=radio]");
    if (!el) return;
    track("tap", { label: labelOf(el), ...playerOf(el) });
  }, { capture: true });

  document.addEventListener("change", (ev) => {
    if (!logging()) return;
    const el = ev.target;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) return;
    if (el instanceof HTMLInputElement && ["password", "hidden", "checkbox", "radio"].includes(el.type)) return;
    track("input", { label: fieldName(el), value: clip(el.value, 120), ...playerOf(el) });
  }, { capture: true });

  // ---- sending ----
  heartbeat();
  setInterval(() => {
    heartbeat();
    if (hasPending()) void flush();
  }, HeartbeatEvery);
  window.addEventListener("online", () => void flush());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      heartbeat();
      void flush();
    } else {
      void flush();
    }
  });
  window.addEventListener("pagehide", () => {
    flushOnClose();
    pageGone();
  });
  window.addEventListener("pageshow", (ev) => {
    // Back from the browser's cache: alive again.
    if (ev.persisted) heartbeat();
  });
  // Lines left by earlier pages that closed before sending them.
  void flush();
}

export default function ActivityTracker() {
  const pathname = usePathname();

  useEffect(() => {
    install();
  }, []);

  useEffect(() => {
    if (pathname && !isPublicRoute(pathname)) track("nav", {}, { screen: pathname });
  }, [pathname]);

  return null;
}
