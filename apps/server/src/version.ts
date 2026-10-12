import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const VERSION = '0.1.0';

/**
 * Identifies a build of the web app this server serves: a short hash of its index.html, which
 * names the hashed script and style files, so every rebuild with changed code gets a new id.
 * Open tabs compare it across reconnects to notice an update. Undefined when it can't be read.
 */
export function webBuildId(webDir: string): string | undefined {
  try {
    const html = readFileSync(join(webDir, 'index.html'));
    return createHash('sha256').update(html).digest('hex').slice(0, 12);
  } catch {
    return undefined;
  }
}
