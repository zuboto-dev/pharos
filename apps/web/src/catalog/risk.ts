import type { PermissionRisk } from '@pharos/schema';

/** How a permission rule's risk is labelled and coloured (Settings and a task's Allow button). */
export const RISK: Record<PermissionRisk, { label: string; className: string }> = {
  low: {
    label: 'Low risk',
    className: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200',
  },
  medium: {
    label: 'Medium risk',
    className: 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100',
  },
  high: {
    label: 'High risk',
    className: 'bg-rose-50 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200',
  },
};
