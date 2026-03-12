"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

type TelegramUserAuth = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
};

declare global {
  interface Window {
    onTelegramAuth?: (user: TelegramUserAuth) => void;
  }
}

function LoginPageContent() {
  const searchParams = useSearchParams();
  const returnTo = searchParams.get('returnTo') || '/';
  const [error, setError] = useState<string | null>(null);
  const botUsername = (process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "").trim().replace(/^@/, "") || null;
  const [autoAuthState, setAutoAuthState] = useState<
    { kind: "checking" }
    | { kind: "no_init_data" }
    | { kind: "failed"; message: string }
    | { kind: "authed" }
  >({ kind: "checking" });

  const widgetContainerRef = useRef<HTMLDivElement | null>(null);

  const scriptSrc = useMemo(() => "https://telegram.org/js/telegram-widget.js?22", []);

  useEffect(() => {
    let cancelled = false;
    const tryWebAppAutoAuth = async (): Promise<boolean> => {
      const getInitData = () => {
        const tg = (window as unknown as { Telegram?: { WebApp?: { initData?: string } } }).Telegram;
        return tg?.WebApp?.initData;
      };

      let initData = getInitData();
      if (!initData) {
        await new Promise((r) => setTimeout(r, 200));
        initData = getInitData();
      }
      if (!initData) {
        setAutoAuthState({ kind: "no_init_data" });
        return false;
      }

      const r = await fetch("/api/auth/telegram/webapp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ initData }),
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        setAutoAuthState({ kind: "failed", message: txt || "webapp auth failed" });
        return false;
      }
      return true;
    };

    const run = async () => {
      const me = await fetch("/api/me");
      if (me.ok) {
        setAutoAuthState({ kind: "authed" });
        window.location.href = returnTo;
        return;
      }
      if (me.status !== 401) {
        setAutoAuthState({ kind: "failed", message: "unexpected session check response" });
        return;
      }

      const ok = await tryWebAppAutoAuth();
      if (!ok) return;
      const me2 = await fetch("/api/me");
      if (!me2.ok) {
        setAutoAuthState({ kind: "failed", message: "session not established" });
        return;
      }
      if (cancelled) return;
      setAutoAuthState({ kind: "authed" });
      window.location.href = returnTo;
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [returnTo]);

  useEffect(() => {
    if (!botUsername) return;

    window.onTelegramAuth = async (user) => {
      setError(null);
      const res = await fetch("/api/auth/telegram", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(user),
      });
      if (!res.ok) {
        const txt = await res.text();
        setError(txt || "Auth failed");
        return;
      }
      window.location.href = returnTo;
    };

    return () => {
      delete window.onTelegramAuth;
    };
  }, [botUsername]);

  useEffect(() => {
    if (!botUsername) return;
    const el = widgetContainerRef.current;
    if (!el) return;
    el.innerHTML = "";

    const script = document.createElement("script");
    script.async = true;
    script.src = scriptSrc;
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-userpic", "true");
    script.setAttribute("data-request-access", "write");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    el.appendChild(script);
  }, [botUsername, scriptSrc]);

  if (!botUsername) {
    return (
      <div>
        <h1>Login</h1>
        <p>Missing NEXT_PUBLIC_TELEGRAM_BOT_USERNAME</p>
      </div>
    );
  }

  return (
    <div>
      <h1>Login</h1>
      <p>Sign in with Telegram to use the dashboard.</p>

      {autoAuthState.kind === "checking" ? <p>Checking session…</p> : null}

      {autoAuthState.kind === "failed" ? (
        <p style={{ color: "crimson" }}>{autoAuthState.message}</p>
      ) : autoAuthState.kind === "no_init_data" ? (
        <p>Not opened as a Telegram Mini App session.</p>
      ) : null}

      <div className="card" style={{ marginTop: 12 }}>
        <div ref={widgetContainerRef} />
      </div>

      {error ? (
        <p style={{ color: "crimson", marginTop: 12 }}>{error}</p>
      ) : null}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div style={{ padding: "20px", textAlign: "center" }}>Cargando...</div>}>
      <LoginPageContent />
    </Suspense>
  );
}
