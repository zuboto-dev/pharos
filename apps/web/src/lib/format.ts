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

/** Formats a YYYY-MM-DD date without timezone shifts. */
export function formatDate(date: string, short = false): string {
  const [y, m, d] = date.split('-').map(Number);
  return (short ? shortDate : dateFormat).format(new Date(y!, m! - 1, d!));
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
