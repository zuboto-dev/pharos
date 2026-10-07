export type ErrorCode = 'invalid' | 'not_found' | 'conflict';

export class PharosError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly issues: string[] = [],
  ) {
    super(issues.length ? `${message}\n${issues.map((i) => `- ${i}`).join('\n')}` : message);
    this.name = 'PharosError';
  }
}

export function formatPath(path: readonly PropertyKey[]): string {
  return path
    .map((p, i) => (typeof p === 'number' ? `[${p}]` : i === 0 ? String(p) : `.${String(p)}`))
    .join('');
}
