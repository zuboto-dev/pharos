const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const dateFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = (new Date(iso).getTime() - now) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

/**
 * Formats a YYYY-MM-DD date without timezone shifts. `short` leaves the year out, but only for
 * dates in the current year (v0.2 B10): "Oct 20", "Mar 1, 2024".
 */
export function formatDate(date: string, short = false, now = new Date()): string {
  const [y, m, d] = date.split('-').map(Number);
  const format = short && y === now.getFullYear() ? shortDate : dateFormat;
  return format.format(new Date(y!, m! - 1, d!));
}

const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

/**
 * A moment as a reader says it, in their time zone: "today 1:19 AM", "yesterday 9:02 PM",
 * "Oct 20, 1:19 AM" (the year only when it isn't this year).
 */
export function dateTime(iso: string, now = new Date()): string {
  const at = new Date(iso);
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(at)) / 86400000);
  const time = clock.format(at);
  if (days === 0) return `today ${time}`;
  if (days === 1) return `yesterday ${time}`;
  const date = (at.getFullYear() === now.getFullYear() ? shortDate : dateFormat).format(at);
  return `${date}, ${time}`;
}

export function humanize(value: string): string {
  const text = value.replaceAll('_', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Today's date in the viewer's time zone, as YYYY-MM-DD. */
export function localToday(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
