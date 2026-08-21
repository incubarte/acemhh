"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePageHeader } from "./PageTitleContext";

/** Scroll past this and the header shrinks to give the page room. */
const CompactAfter = 40;

export default function Header() {
  const router = useRouter();
  const { title, onBack } = usePageHeader();
  const showBack = title.trim().length > 0;

  // The header is pinned, so it costs vertical space on every screen: past a
  // little scrolling it shrinks. The back arrow keeps its size and hit area —
  // it is the one control that must stay reachable.
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const onScroll = () => setCompact(window.scrollY > CompactAfter);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const logoSize = compact ? 30 : 45;

  return (
    <header
      data-testid="app-header"
      data-compact={compact ? "true" : "false"}
      style={{
        background: "rgba(0, 0, 0, 0.92)",
        backdropFilter: "blur(12px)",
        borderBottom: "1px solid rgba(255,255,255,0.12)",
        transition: "padding 150ms ease",
      }}
    >
      <div style={{
        maxWidth: 760,
        margin: "0 auto",
        // Lines up with the app shell's content: container padding + shell padding.
        padding: compact ? "4px 28px" : "12px 28px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        transition: "padding 150ms ease",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
          {showBack && (
            <span
              onClick={() => onBack ? onBack() : router.back()}
              role="button"
              aria-label="Volver"
              style={{
                cursor: "pointer",
                fontSize: "1.8rem",
                lineHeight: 1,
                userSelect: "none",
                WebkitTapHighlightColor: "transparent",
                flexShrink: 0,
                // A full thumb-sized target: the arrow's own glyph box is
                // barely 16px tall, which is not something you can hit.
                width: 44,
                height: 44,
                marginLeft: -12,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--acemhh-orange)",
              }}
            >
              «
            </span>
          )}
          {showBack && title.trim() && (
            <div style={{
              width: 1,
              height: compact ? 24 : 42,
              background: "linear-gradient(180deg, transparent, rgba(255,255,255,0.35), transparent)",
              flexShrink: 0,
              marginRight: 4,
              transition: "height 150ms ease",
            }} />
          )}
          {title.trim() && (
            <h1 style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: compact ? "1.15rem" : "1.6rem",
              transition: "font-size 150ms ease",
            }}>
              {title}
            </h1>
          )}
        </div>
        {/* The logo is the way home from anywhere — and it keeps a thumb-sized
            target even once the header has shrunk it. */}
        <Link
          href="/"
          data-testid="header-home"
          aria-label="Ir al inicio"
          style={{
            width: Math.max(44, logoSize),
            height: Math.max(44, logoSize),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            WebkitTapHighlightColor: "transparent",
          }}
        >
          <span style={{
            width: logoSize,
            height: logoSize,
            position: "relative",
            display: "block",
            transition: "width 150ms ease, height 150ms ease",
          }}>
            <Image
              src="/acemhh-logo.png"
              alt="ACEMHH Logo"
              fill
              style={{ objectFit: "contain", objectPosition: "center" }}
            />
          </span>
        </Link>
      </div>
    </header>
  );
}
