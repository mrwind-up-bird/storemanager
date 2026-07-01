/** Analytics reporting periods (also re-exported by `@/lib/analytics`, defined here to avoid a cycle). */
export type AnalyticsPeriod = 'week' | 'month' | 'quarter';

export interface PeriodRange {
  start: Date;
  end: Date;
  prevStart: Date;
  prevEnd: Date;
  rangeLabel: string;
}

const GERMAN_MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

/** Europe/Berlin UTC offset (minutes east of UTC) in effect at `instant` — +60 (CET) or +120 (CEST), computed via Intl, never hardcoded. */
function berlinOffsetMinutes(instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  const hour = Number(get('hour')) % 24; // Intl reports midnight as "24" with hour12: false
  const asUTC = Date.UTC(
    Number(get('year')), Number(get('month')) - 1, Number(get('day')),
    hour, Number(get('minute')), Number(get('second')),
  );
  return Math.round((asUTC - instant.getTime()) / 60_000);
}

/** UTC instant of Europe/Berlin local midnight for the given calendar date. Month/day may overflow/underflow (e.g. day 0, month 13) — normalised the same way `Date.UTC` normalises them. */
function berlinMidnightUTC(year: number, month: number, day: number): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  return new Date(guess.getTime() - berlinOffsetMinutes(guess) * 60_000);
}

/** Berlin-local calendar date (Y/M/D) of `date`. */
function berlinLocalYMD(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

/** ISO weekday (1=Mon..7=Sun) of a plain calendar date. Pure calendar math — no timezone involved. */
function isoWeekday(year: number, month: number, day: number): number {
  const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0=Sun..6=Sat
  return jsDay === 0 ? 7 : jsDay;
}

function germanMonthDay(y: { year: number; month: number; day: number }): string {
  return `${y.day}. ${GERMAN_MONTHS[y.month - 1]} ${y.year}`;
}

/** Compute week/month/quarter start/end/prev boundaries and a German display label, all in Europe/Berlin local time. Pure — `now` is always a parameter, never `Date.now()`. */
export function periodRange(period: AnalyticsPeriod, now: Date): PeriodRange {
  const { year, month, day } = berlinLocalYMD(now);

  if (period === 'week') {
    const mondayDay = day - (isoWeekday(year, month, day) - 1);
    const start = berlinMidnightUTC(year, month, mondayDay);
    const end = berlinMidnightUTC(year, month, mondayDay + 7);
    const prevStart = berlinMidnightUTC(year, month, mondayDay - 7);
    const monday = berlinLocalYMD(start);
    const sunday = berlinLocalYMD(berlinMidnightUTC(year, month, mondayDay + 6));
    const rangeLabel = monday.month === sunday.month && monday.year === sunday.year
      ? `${monday.day}.–${sunday.day}. ${GERMAN_MONTHS[monday.month - 1]} ${monday.year}`
      : `${germanMonthDay(monday)} – ${germanMonthDay(sunday)}`;
    return { start, end, prevStart, prevEnd: start, rangeLabel };
  }

  if (period === 'month') {
    const start = berlinMidnightUTC(year, month, 1);
    return {
      start,
      end: berlinMidnightUTC(year, month + 1, 1),
      prevStart: berlinMidnightUTC(year, month - 1, 1),
      prevEnd: start,
      rangeLabel: `${GERMAN_MONTHS[month - 1]} ${year}`,
    };
  }

  // quarter
  const quarterIndex = Math.floor((month - 1) / 3); // 0..3
  const quarterStartMonth = quarterIndex * 3 + 1;
  const start = berlinMidnightUTC(year, quarterStartMonth, 1);
  return {
    start,
    end: berlinMidnightUTC(year, quarterStartMonth + 3, 1),
    prevStart: berlinMidnightUTC(year, quarterStartMonth - 3, 1),
    prevEnd: start,
    rangeLabel: `Q${quarterIndex + 1} ${year}`,
  };
}
