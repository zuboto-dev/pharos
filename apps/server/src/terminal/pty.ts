import { accessSync, chmodSync, constants, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { PtySpawn } from './sessions.js';

/**
 * node-pty, loaded when first needed so a missing or broken native build only turns the agent
 * terminal off (the status says why) and never stops the server.
 *
 * node-pty 1.1.0's macOS prebuilds ship `spawn-helper` without its executable bit when the
 * package manager unpacks them, and every spawn then fails with "posix_spawnp failed": the bit
 * is restored here, on this one file inside node-pty's own folder.
 */
export async function loadPty(): Promise<{ spawn: PtySpawn } | { error: string }> {
  try {
    const require = createRequire(import.meta.url);
    const root = dirname(dirname(require.resolve('node-pty')));
    const helper = join(root, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper');
    try {
      if (statSync(helper).isFile()) {
        try {
          accessSync(helper, constants.X_OK);
        } catch {
          chmodSync(helper, 0o755);
        }
      }
    } catch {
      // No prebuilt helper here (built from source, or another platform): nothing to fix.
    }
    const pty = await import('node-pty');
    const spawn: PtySpawn = (file, args, options) =>
      pty.spawn(file, args, {
        name: 'xterm-256color',
        cwd: options.cwd,
        env: options.env,
        cols: options.cols,
        rows: options.rows,
      });
    return { spawn };
  } catch (error) {
    console.error('[pharos] The agent terminal is off: node-pty did not load:', error);
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
