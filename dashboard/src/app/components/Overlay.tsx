"use client";

import { createPortal } from "react-dom";

/**
 * Renders children on document.body. The app shell has backdrop-filter, which
 * makes it the containing block for position:fixed descendants — an overlay
 * rendered inside it anchors to the (scrolled, taller-than-viewport) shell
 * instead of the screen. The portal escapes it.
 */
export default function Overlay({ children }: { children: React.ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}
