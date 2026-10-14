/** Calendar dates as YYYY-MM-DD, with no time zone surprises (all arithmetic in UTC). */

/**
 * Whether a string is a date that exists on the calendar, as YYYY-MM-DD: "2026-02-30" has the
 * right shape but never happened (v0.2 review, gap 9). Records, queries and action forms share it.
 */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Today (or the day of `at`) as YYYY-MM-DD in the local time zone. */
export function localToday(at: Date | string = new Date()): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parts(date: string): [number, number, number] {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return [y!, m!, d!];
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = parts(date);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Adds calendar months; the 31st becomes the last day of a shorter month. */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = parts(date);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}

export function addUnits(date: string, n: number, unit: 'days' | 'weeks' | 'months' | 'years') {
  switch (unit) {
    case 'days':
      return addDays(date, n);
    case 'weeks':
      return addDays(date, n * 7);
    case 'months':
      return addMonths(date, n);
    case 'years':
      return addMonths(date, n * 12);
  }
}

/** Whole days from `a` to `b` (negative when b is earlier). */
export function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = parts(a);
  const [y2, m2, d2] = parts(b);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

const RELATIVE = /^\$(today|monthStart|yearStart)(?:([+-])(\d+)([dwmy]))?$/;
const UNITS = { d: 'days', w: 'weeks', m: 'months', y: 'years' } as const;

/** Whether a "$…" value is a relative date token (well-formed or not). */
export function isDateToken(value: string): boolean {
  return /^\$(today|monthStart|yearStart|month|year|tomorrow|yesterday|week)/.test(value);
}

/**
 * "$today", "$today+7d", "$today-2w", "$monthStart", "$monthStart+1m", "$yearStart-1y" →
 * YYYY-MM-DD; undefined when the value isn't one of these.
 */
export function relativeDate(value: string, today: string): string | undefined {
  const match = RELATIVE.exec(value);
  if (!match) return undefined;
  const [, anchor, sign, n, unit] = match;
  const base =
    anchor === 'today'
      ? today
      : anchor === 'monthStart'
        ? `${today.slice(0, 7)}-01`
        : `${today.slice(0, 4)}-01-01`;
  if (!sign) return base;
  return addUnits(base, Number(n) * (sign === '-' ? -1 : 1), UNITS[unit as keyof typeof UNITS]);
}
