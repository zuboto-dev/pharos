import type { Entity } from '@pharos/schema';
import clsx from 'clsx';
import { ExpiryBadge } from '../catalog/components/file-list';
import { formatDate, localToday } from '../lib/format';
import { expiryOf } from './files';

// A file at a glance (v0.2 B2). The owner: "File/source location is not needed in the view until
// the user wants to see the details by clicking it." Blocks show a file's type icon, its name
// and the one date that matters; where it is on disk (folder, path) and the actions live in its
// details (the drawer, or the FileView's icon row).

type FileData = Entity<'file'>['data'];

/** The one date worth showing for a file: its expiry, else when it was issued, else changed. */
export type GlanceDateInfo = {
  kind: 'expiry' | 'issued' | 'modified';
  /** YYYY-MM-DD */
  date: string;
  /** How it reads, e.g. "Issued Mar 1, 2024". Expiry reads like its badge. */
  text: string;
};

export function glanceDateOf(
  file: Pick<FileData, 'expiryDate' | 'issuedDate' | 'modifiedAt'>,
  today = localToday(),
): GlanceDateInfo | undefined {
  if (file.expiryDate) {
    const past = expiryOf(file.expiryDate, today) === 'expired';
    const text = `${past ? 'Expired' : 'Expires'} ${formatDate(file.expiryDate)}`;
    return { kind: 'expiry', date: file.expiryDate, text };
  }
  if (file.issuedDate)
    return { kind: 'issued', date: file.issuedDate, text: `Issued ${formatDate(file.issuedDate)}` };
  const changed = file.modifiedAt?.slice(0, 10);
  return changed
    ? { kind: 'modified', date: changed, text: `Changed ${formatDate(changed)}` }
    : undefined;
}

/** The glance date: an expiry badge (coloured when it's soon or past), or a quiet date. */
export function GlanceDate({
  file,
  today = localToday(),
  className,
}: {
  file: Pick<FileData, 'expiryDate' | 'issuedDate' | 'modifiedAt'>;
  today?: string;
  className?: string;
}) {
  const glance = glanceDateOf(file, today);
  if (!glance) return null;
  if (glance.kind === 'expiry') return <ExpiryBadge date={glance.date} today={today} />;
  return (
    <span className={clsx('text-xs whitespace-nowrap text-muted tabular-nums', className)}>
      {glance.text}
    </span>
  );
}
