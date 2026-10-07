import { describe, expect, it } from 'vitest';
import { timelineTicks, toDay } from './timeline';

const labels = (from: string, to: string, max?: number) =>
  timelineTicks(toDay(from), toDay(to), max).map((t) => t.label);

describe('timelineTicks', () => {
  it('uses days for short ranges', () => {
    expect(labels('2026-10-01', '2026-10-06')).toEqual([
      'Oct 1',
      'Oct 2',
      'Oct 3',
      'Oct 4',
      'Oct 5',
      'Oct 6',
    ]);
    expect(labels('2026-10-01', '2026-10-12')).toEqual([
      'Oct 2',
      'Oct 4',
      'Oct 6',
      'Oct 8',
      'Oct 10',
      'Oct 12',
    ]);
  });

  it('uses Mondays for ranges of weeks', () => {
    // Oct 5 2026 is a Monday.
    expect(labels('2026-09-25', '2026-10-29')).toEqual([
      'Sep 28',
      'Oct 5',
      'Oct 12',
      'Oct 19',
      'Oct 26',
    ]);
  });

  it('uses the 1st of months for long ranges, with the year in January', () => {
    expect(labels('2026-09-10', '2027-03-20')).toEqual([
      'Oct',
      'Nov',
      'Dec',
      'Jan 2027',
      'Feb',
      'Mar',
    ]);
    expect(labels('2026-01-10', '2027-12-20').length).toBeLessThanOrEqual(8);
  });

  it('places ticks inside the range', () => {
    const [min, max] = [toDay('2026-09-25'), toDay('2026-10-29')];
    for (const t of timelineTicks(min, max)) expect(t.day >= min && t.day <= max).toBe(true);
  });
});
