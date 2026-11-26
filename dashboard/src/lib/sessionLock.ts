// Whether a training session still takes attendance and payments, and who may
// write to it anyway. A session closes after the current week and the previous
// one; past that only ROOT may change it, and only having confirmed it.
//
// The roster sends both answers with the session, so the screen asks before
// writing instead of learning it from a refusal; the write routes enforce the
// same rule, so a stale tab or a direct call hits the same wall.

import { withinWriteWindow } from "@shared/tokens";
import { todayBA } from "@/lib/trainingDay";

export type SessionLock = {
  /** The session no longer takes changes from the screen. */
  closed: boolean;
  /** The viewer may change it although it is closed, once they confirm. */
  can_write_closed: boolean;
};

export function sessionLock(isoDate: string, groups: string[]): SessionLock {
  return {
    closed: !withinWriteWindow(isoDate, todayBA()),
    can_write_closed: groups.includes("ROOT"),
  };
}
