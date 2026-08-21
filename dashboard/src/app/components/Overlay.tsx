"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Renders children on document.body, or inside `targetId` when given. The app
 * shell has backdrop-filter, which makes it the containing block for
 * position:fixed descendants — an overlay rendered inside it anchors to the
 * (scrolled, taller-than-viewport) shell instead of the screen. The portal
 * escapes it.
 */
export default function Overlay({
  children,
  targetId,
}: {
  children: React.ReactNode;
  targetId?: string;
}) {
  // A named target belongs to another component, so it only exists after
  // mount; body is available right away and keeps rendering synchronously.
  const [target, setTarget] = useState<Element | null>(null);
  useEffect(() => {
    if (targetId) setTarget(document.getElementById(targetId));
  }, [targetId]);

  if (typeof document === "undefined") return null;
  const node = targetId ? target : document.body;
  if (!node) return null;
  return createPortal(children, node);
}
