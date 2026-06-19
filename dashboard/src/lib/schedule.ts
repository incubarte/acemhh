type ScheduleMap = Record<string, string[]>;

const OLD_SCHEDULE: ScheduleMap = {
  "jue 21hs": ["cat-a"],
  "jue 22hs": ["cat-b"],
  "jue 23hs": ["cat-c"],
};

const NEW_SCHEDULE: ScheduleMap = {
  "jue 21hs": ["youth"],
  "jue 22hs": ["cat-a", "cat-b"],
  "jue 23hs": ["cat-c"],
};

const NEW_SCHEDULE_FROM = "2026-05-01";

const THURSDAY_HOURS = [21, 22, 23] as const;

// Slots where every goalkeeper (regardless of category) shows up in the
// arqueros section and can register payments. In any other slot goalkeepers
// only appear as visiting arqueros: no payment info, no payment registration.
const GOALKEEPER_FRIENDLY_SLOTS = new Set<string>(["jue 21hs"]);

export function isGoalkeeperFriendlySlot(genericSlot: string): boolean {
  return GOALKEEPER_FRIENDLY_SLOTS.has(genericSlot);
}

export function isGoalkeeperFriendlyHour(hour: number): boolean {
  return GOALKEEPER_FRIENDLY_SLOTS.has(`jue ${hour}hs`);
}

function pickSchedule(isoDate: string): ScheduleMap {
  return isoDate >= NEW_SCHEDULE_FROM ? NEW_SCHEDULE : OLD_SCHEDULE;
}

export function categoriesForSlot(isoDate: string, genericSlot: string): string[] {
  return pickSchedule(isoDate)[genericSlot] ?? [];
}

export function categoriesForHour(isoDate: string, hour: number): string[] {
  return pickSchedule(isoDate)[`jue ${hour}hs`] ?? [];
}

export function slotsForDate(isoDate: string): { hour: number; categories: string[] }[] {
  return THURSDAY_HOURS.map((hour) => ({
    hour,
    categories: categoriesForHour(isoDate, hour),
  }));
}
