// Which attendance screen the admin gets. Stored in localStorage, which
// survives logouts on the device — the persistence this needs.

export type Experience = "nueva" | "vieja";

export const ExperienceKey = "acemhh:training-experience";

/** What the old beta switch wrote. Dropped on sight: the new screen is the
 * default now, so an opt-in flag has nothing left to say. */
const LegacyBetaKey = "acemhh:training-beta";

/** The stored choice, defaulting to the new screen. Only "vieja" opts out.
 * Call from an effect, never during render: it touches localStorage, so the
 * server-rendered markup would not match. */
export function readExperience(): Experience {
  localStorage.removeItem(LegacyBetaKey);
  return localStorage.getItem(ExperienceKey) === "vieja" ? "vieja" : "nueva";
}

export function writeExperience(value: Experience) {
  localStorage.setItem(ExperienceKey, value);
}

/** The attendance route for a session under a given experience. */
export function attendancePath(experience: Experience, session: string) {
  return `/training-sessions${experience === "nueva" ? "-beta" : ""}/${session}`;
}
