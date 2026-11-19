// What the save overlay shows while a movement is being registered, and how
// it ended. lib/postMoney.ts drives it; components/SaveFeedback.tsx draws it,
// mounted once in the root layout so it survives the navigation that usually
// follows a save.

export type SavePhase =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "ok" }
  | { kind: "fail"; message: string | null };

/** How long the result stays up before it goes away on its own. */
export const OkVisibleMs = 2000;
export const FailVisibleMs = 4000;

let phase: SavePhase = { kind: "idle" };
let dismissTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function set(next: SavePhase) {
  if (dismissTimer) clearTimeout(dismissTimer);
  dismissTimer = null;
  phase = next;
  if (next.kind === "ok" || next.kind === "fail") {
    dismissTimer = setTimeout(() => set({ kind: "idle" }), next.kind === "ok" ? OkVisibleMs : FailVisibleMs);
  }
  listeners.forEach((l) => l());
}

export const saveFeedback = {
  saving: () => set({ kind: "saving" }),
  ok: () => set({ kind: "ok" }),
  fail: (message: string | null) => set({ kind: "fail", message }),
  /** Nothing to report: the admin chose not to send it after all. */
  clear: () => set({ kind: "idle" }),
  get: (): SavePhase => phase,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

/** The server state: nothing is ever being saved during a render there. */
export const idlePhase: SavePhase = { kind: "idle" };
