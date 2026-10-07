/** Days since the Unix epoch, in UTC. Dates are whole days, so UTC avoids timezone shifts. */
export function toDay(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!) / 86400000;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export type Tick = { day: number; label: string };

/**
 * Axis ticks for a day range: the smallest step (1, 2, 7, 14 days, then 1, 2, 3, 6 months)
 * giving at most `maxTicks` labels. Weekly ticks fall on Mondays, monthly ones on the 1st.
 */
export function timelineTicks(min: number, max: number, maxTicks = 8): Tick[] {
  const span = max - min;
  const dayLabel = (day: number) => {
    const d = new Date(day * 86400000);
    return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  };
  for (const step of [1, 2, 7, 14]) {
    if (span / step > maxTicks) continue;
    // Epoch day 0 was a Thursday, so Mondays are days ≡ 4 (mod 7).
    let first = Math.ceil(min / step) * step;
    if (step >= 7) first = min + ((4 - (min % 7) + 7) % 7);
    const ticks: Tick[] = [];
    for (let day = first; day <= max; day += step) ticks.push({ day, label: dayLabel(day) });
    return ticks;
  }
  for (const months of [1, 2, 3, 6, 12]) {
    const start = new Date(min * 86400000);
    let y = start.getUTCFullYear();
    let m = start.getUTCMonth() + 1; // first 1st-of-month after min
    const ticks: Tick[] = [];
    for (;;) {
      if (m > 11) {
        y += Math.floor(m / 12);
        m %= 12;
      }
      const day = Date.UTC(y, m, 1) / 86400000;
      if (day > max) break;
      if (m % months === 0 || months === 1) {
        ticks.push({ day, label: m === 0 ? `${MONTHS[m]} ${y}` : MONTHS[m]! });
      }
      m++;
    }
    if (ticks.length <= maxTicks) return ticks;
  }
  return [];
}
