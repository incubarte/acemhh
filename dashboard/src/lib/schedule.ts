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
