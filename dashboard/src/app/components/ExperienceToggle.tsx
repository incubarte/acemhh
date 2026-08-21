"use client";

import { useRouter } from "next/navigation";
import Overlay from "./Overlay";
import { TopStackTopSlotId } from "./TopStack";
import { attendancePath, writeExperience, type Experience } from "@/lib/experience";

/**
 * Switches between the two attendance screens from inside either of them, so
 * comparing them costs nothing — no going back to the session list.
 *
 * It pins itself directly under the app header, above the wrong-session
 * warning, by portaling into the fixed top stack.
 */
export default function ExperienceToggle({
  session,
  current,
}: {
  /** YYYY-MM-DD-HH — the same session is kept across the switch. */
  session: string;
  current: Experience;
}) {
  const router = useRouter();
  const isNew = current === "nueva";

  // Each screen states which one it is: green for the new, amber for the old.
  const colors = isNew
    ? { background: "#14532d", border: "#166534" }
    : { background: "#78350f", border: "#92400e" };

  const flip = () => {
    const next: Experience = isNew ? "vieja" : "nueva";
    writeExperience(next);
    // Replace, not push: the back button should leave the screen, not bounce
    // between the two versions of it.
    router.replace(attendancePath(next, session));
  };

  const label = (text: string, active: boolean) => (
    <span style={{
      fontSize: "0.8rem",
      letterSpacing: "0.04em",
      opacity: active ? 1 : 0.55,
      fontWeight: active ? 600 : 400,
      whiteSpace: "nowrap",
    }}>
      {text}
    </span>
  );

  return (
    <Overlay targetId={TopStackTopSlotId}>
      <label
        data-testid="experience-toggle"
        data-experience={current}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          padding: "6px 14px",
          background: colors.background,
          borderBottom: `1px solid ${colors.border}`,
          color: "#fff",
          cursor: "pointer",
          userSelect: "none",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        {label("experiencia vieja", !isNew)}
        <input
          type="checkbox"
          checked={isNew}
          onChange={flip}
          style={{ position: "absolute", opacity: 0, width: 0, height: 0 }}
        />
        <span
          aria-hidden
          style={{
            width: 34,
            height: 20,
            borderRadius: 999,
            padding: 2,
            boxSizing: "border-box",
            background: isNew ? "#22c55e" : "rgba(255,255,255,0.25)",
            transition: "background 150ms ease",
            display: "inline-flex",
            flexShrink: 0,
          }}
        >
          <span style={{
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: "#fff",
            transform: isNew ? "translateX(14px)" : "none",
            transition: "transform 150ms ease",
          }} />
        </span>
        {label("experiencia nueva", isNew)}
      </label>
    </Overlay>
  );
}
