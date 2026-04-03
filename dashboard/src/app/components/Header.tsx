"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { usePageHeader } from "./PageTitleContext";

export default function Header() {
  const router = useRouter();
  const { title, onBack } = usePageHeader();
  const showBack = title.trim().length > 0;

  return (
    <header style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 16,
      paddingBottom: 8,
      borderBottom: "1px solid rgba(255,255,255,0.1)",
      minHeight: 45,
      gap: 8,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
        {showBack && (
          <span
            onClick={() => onBack ? onBack() : router.back()}
            style={{
              cursor: "pointer",
              fontSize: "1.8rem",
              lineHeight: 0,
              userSelect: "none",
              WebkitTapHighlightColor: "transparent",
              flexShrink: 0,
              padding: "8px 0",
              marginTop: -4,
              color: "var(--acemhh-orange)",
            }}
          >
            «
          </span>
        )}
        {showBack && title.trim() && (
          <div style={{ width: 1, height: 42, background: "linear-gradient(180deg, transparent, rgba(255,255,255,0.35), transparent)", flexShrink: 0, marginRight: 4 }} />
        )}
        {title.trim() && <h1 style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</h1>}
      </div>
      <div style={{ width: 45, height: 45, position: "relative", display: "flex", alignItems: "center", flexShrink: 0 }}>
        <Image
          src="/acemhh-logo.png"
          alt="ACEMHH Logo"
          fill
          style={{ objectFit: "contain", objectPosition: "center" }}
        />
      </div>
    </header>
  );
}
