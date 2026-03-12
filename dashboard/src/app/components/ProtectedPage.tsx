"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type ProtectedPageProps = {
  children: React.ReactNode;
  requiredPage: string;
};

export default function ProtectedPage({ children, requiredPage }: ProtectedPageProps) {
  const router = useRouter();
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  useEffect(() => {
    const getInitData = (): string | undefined => {
      const tg = (window as unknown as { Telegram?: { WebApp?: { initData?: string } } }).Telegram;
      return tg?.WebApp?.initData || undefined;
    };

    const tryWebAppAutoAuth = async (): Promise<boolean> => {
      let initData = getInitData();
      if (!initData) {
        await new Promise((r) => setTimeout(r, 200));
        initData = getInitData();
      }
      if (!initData) return false;

      const res = await fetch("/api/auth/telegram/webapp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ initData }),
      });
      return res.ok;
    };

    const checkPermission = async () => {
      try {
        const permUrl = `/api/check-permission?type=page&resource=${encodeURIComponent(requiredPage)}`;
        const res = await fetch(permUrl);
        
        if (res.status === 401) {
          // Try Telegram WebApp auto-auth before redirecting
          const authed = await tryWebAppAutoAuth();
          if (authed) {
            // Retry permission check after auto-auth
            const retry = await fetch(permUrl);
            if (retry.ok) {
              setAuthorized(true);
              return;
            }
            if (retry.status === 403) {
              setAuthorized(false);
              return;
            }
          }
          // No initData or auto-auth failed, redirect to login
          router.push(`/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`);
          return;
        }
        
        if (res.status === 403) {
          setAuthorized(false);
          return;
        }
        
        if (res.ok) {
          setAuthorized(true);
          return;
        }
        
        setAuthorized(false);
      } catch (e) {
        console.error("Permission check failed:", e);
        setAuthorized(false);
      }
    };

    checkPermission();
  }, [requiredPage, router]);

  if (authorized === null) {
    return (
      <div style={{ padding: "20px", textAlign: "center" }}>
        <p>Verificando permisos...</p>
      </div>
    );
  }

  if (authorized === false) {
    return (
      <div style={{ padding: "20px", textAlign: "center" }}>
        <h2 style={{ color: "var(--acemhh-orange)", marginBottom: 16 }}>Acceso Denegado</h2>
        <p>No tienes permisos para acceder a esta página.</p>
      </div>
    );
  }

  return <>{children}</>;
}
