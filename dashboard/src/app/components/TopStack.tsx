"use client";

import { useEffect, useRef } from "react";
import Header from "./Header";

/** Portal target for bars that must sit under the header, above the page. */
export const TopStackSlotId = "top-stack-slot";

/**
 * The fixed bar at the top of every screen: the app header first, then
 * whatever a page pins below it (the wrong-session warning). It lives outside
 * the app shell — whose backdrop-filter would trap a fixed child, and whose
 * max-width would keep it from spanning the screen — and pushes the page down
 * by its own measured height, so nothing ever hides underneath.
 */
export default function TopStack() {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      document.body.style.paddingTop = `${el.getBoundingClientRect().height}px`;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
      document.body.style.paddingTop = "";
    };
  }, []);

  return (
    <div
      ref={ref}
      data-testid="top-stack"
      style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 70 }}
    >
      <Header />
      <div id={TopStackSlotId} />
    </div>
  );
}
