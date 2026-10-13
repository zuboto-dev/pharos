import {
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../store/database.js';
import { Store } from '../store/store.js';
import { approveRequest, requestFolder, savedRequests } from './requests.js';
import { PathRefused, identityOf, openInside, plainFileInsideSync } from './safety.js';

let base: string;
let home: string;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'pharos-v02-fixes-')));
  home = join(base, 'home');
  mkdirSync(join(home, 'Notes'), { recursive: true });
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe('hard links (v0.2 review, gap 1)', () => {
  it('refuses to add or open a file that has a second name', async () => {
    const root = join(home, 'Notes');
    writeFileSync(join(root, 'plain.md'), '# Made-up\n');
    writeFileSync(join(root, 'a.md'), 'made-up');
    linkSync(join(root, 'a.md'), join(root, 'b.md'));
    const folder = {
      id: 'root_abcdef',
      path: root,
      level: 'contents' as const,
      identity: identityOf(lstatSync(root, { bigint: true })),
    };
    expect(plainFileInsideSync(folder, 'plain.md')).toBe('ok');
    expect(plainFileInsideSync(folder, 'b.md')).toBe('refused');
    await expect(openInside(folder, 'a.md')).rejects.toBeInstanceOf(PathRefused);
    const opened = await openInside(folder, 'plain.md');
    await opened.handle.close();
  });
});

describe('folder request approval (v0.2 review, gap 2)', () => {
  it('refuses approval when another directory was moved into the requested path', () => {
    const store = new Store(openDatabase(':memory:'));
    const notes = join(home, 'Notes');
    const request = requestFolder(store, { path: notes, reason: 'Made-up notes' }, 'agent', home);
    expect(request.identity).toBeTruthy();
    renameSync(notes, join(home, 'Old'));
    mkdirSync(join(home, 'Other'));
    renameSync(join(home, 'Other'), notes);
    expect(() => approveRequest(store, request.id, { home })).toThrow(/changed since/);
    // The stale request is gone; asking again makes a fresh one that can be approved.
    expect(savedRequests(store)).toHaveLength(0);
    const fresh = requestFolder(store, { path: notes, reason: 'Made-up notes' }, 'agent', home);
    expect(approveRequest(store, fresh.id, { home }).request.status).toBe('approved');
  });
});
