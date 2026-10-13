import { DUE_BANDS, DUE_SOON, type DueBand, type Interval } from '../records.js';
import { addUnits, daysBetween } from './dates.js';

/** When a repeating record is due next, and how urgent that is. */
export type Due = {
  /** Next due date (YYYY-MM-DD), when it repeats by time. */
  date?: string;
  /** Days from today to `date` (negative: late). */
  days?: number;
  /** Next due reading, when it repeats by meter. */
  meter?: number;
  /** The current reading the meter is compared with. */
  reading?: number;
  /** Units left until `meter` (negative: past it). */
  left?: number;
  band: DueBand;
};

/** About how many days one unit is, for estimating how many steps have passed. */
const UNIT_DAYS = { days: 1, weeks: 7, months: 30.436875, years: 365.2425 } as const;

function nextDate(interval: Interval): string | undefined {
  const { every, lastDate, startDate, mode } = interval;
  if (!every) return undefined;
  if (mode === 'fixed' && startDate) {
    // The schedule's first date after it was last done (or its start, if never).
    if (!lastDate || lastDate < startDate) return startDate;
    // The first occurrence k (counted from the start, so month ends stay anchored) after
    // lastDate: estimated from the elapsed days, then corrected by a step or two (v0.2 review,
    // gap 11: a capped loop stopped advancing on long daily schedules).
    const at = (k: number) => addUnits(startDate, every.n * k, every.unit);
    const step = every.n * UNIT_DAYS[every.unit];
    let k = Math.max(1, Math.floor(daysBetween(startDate, lastDate) / step));
    while (k > 1 && at(k - 1) > lastDate) k--;
    while (at(k) <= lastDate) k++;
    return at(k);
  }
  return lastDate ? addUnits(lastDate, every.n, every.unit) : startDate;
}

function nextMeter(interval: Interval): number | undefined {
  const { meter, lastMeter, startMeter, mode } = interval;
  if (!meter) return undefined;
  if (mode === 'fixed' && startMeter !== undefined) {
    if (lastMeter === undefined || lastMeter < startMeter) return startMeter;
    return startMeter + (Math.floor((lastMeter - startMeter) / meter.n) + 1) * meter.n;
  }
  return lastMeter !== undefined ? lastMeter + meter.n : startMeter;
}

function band(left: number, veryUrgent: number, urgent: number): DueBand {
  if (left < 0) return 'past_due';
  if (left <= veryUrgent) return 'very_urgent';
  if (left <= urgent) return 'urgent';
  return 'not_urgent';
}

/**
 * The next due date and/or reading, whichever comes first deciding the band (four bands, as
 * LubeLogger: not urgent, urgent, very urgent, past due). `reading` is the meter's current value.
 */
export function computeDue(
  interval: Interval,
  today: string,
  reading: number | undefined,
): Due | undefined {
  const soon = { ...DUE_SOON, ...interval.soon };
  const date = nextDate(interval);
  const meter = nextMeter(interval);
  if (date === undefined && meter === undefined) return undefined;
  const due: Due = { band: 'not_urgent' };
  const bands: DueBand[] = [];
  if (date !== undefined) {
    due.date = date;
    due.days = daysBetween(today, date);
    bands.push(band(due.days, soon.veryUrgentDays, soon.urgentDays));
  }
  if (meter !== undefined) {
    due.meter = meter;
    if (reading !== undefined) {
      due.reading = reading;
      due.left = meter - reading;
      bands.push(band(due.left, soon.veryUrgentMeter, soon.urgentMeter));
    }
  }
  due.band = bands.reduce<DueBand>(
    (worst, b) => (DUE_BANDS.indexOf(b) > DUE_BANDS.indexOf(worst) ? b : worst),
    'not_urgent',
  );
  return due;
}

/**
 * When a file's expiry counts as urgent (R7.15): within 60 days, very urgent within 14, past due
 * once expired. Renewing a document takes longer than a service, so the bands start earlier.
 */
export const FILE_EXPIRY_SOON = { urgentDays: 60, veryUrgentDays: 14 } as const;

/** A file's expiry as a due date in the same four bands as repeating records. */
export function fileDue(expiryDate: string | undefined, today: string): Due | undefined {
  if (!expiryDate) return undefined;
  const days = daysBetween(today, expiryDate);
  return {
    date: expiryDate,
    days,
    band: band(days, FILE_EXPIRY_SOON.veryUrgentDays, FILE_EXPIRY_SOON.urgentDays),
  };
}

/**
 * A one-off date as a due date (R9), e.g. an exam: the same four bands as a repeating record
 * (urgent within 30 days, very urgent within 7), past due once the day has gone.
 */
export function dateDue(date: string, today: string): Due | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const days = daysBetween(today, date);
  return { date, days, band: band(days, DUE_SOON.veryUrgentDays, DUE_SOON.urgentDays) };
}
