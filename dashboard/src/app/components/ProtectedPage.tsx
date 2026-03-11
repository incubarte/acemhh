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
    const checkPermission = async () => {
      try {
        const res = await fetch(`/api/check-permission?type=page&resource=${encodeURIComponent(requiredPage)}`);
        
        if (res.status === 401) {
          router.push("/login");
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
