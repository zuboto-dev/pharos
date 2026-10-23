import { mkdirSync, mkdtempSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { DiskFolders } from './disk-folders.js';
import { openDatabase } from './store/database.js';
import { Store } from './store/store.js';

function home() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'pharos-home-')));
  mkdirSync(join(dir, 'code', 'shop', '.git'), { recursive: true });
  mkdirSync(join(dir, 'code', 'notes'), { recursive: true });
  mkdirSync(join(dir, '.secret'));
  return dir;
}

describe('picking a folder on this computer', () => {
  it('lists folders inside home, code repositories first, never hidden ones or outside home', () => {
    const h = home();
    const disk = new DiskFolders(h);
    expect(disk.list().folders.map((f) => f.name)).toEqual(['code']);
    const code = disk.list('~/code');
    expect(code.display).toBe('~/code');
    expect(code.parent).toBe(h);
    expect(code.folders.map((f) => [f.name, f.repo])).toEqual([
      ['shop', true],
      ['notes', false],
    ]);
    expect(() => disk.list('/etc')).toThrow(/inside your home folder/);
    expect(() => disk.list('~/code/../..')).toThrow(/inside your home folder/);
  });

  it('makes a new folder with a plain name, and refuses odd names and existing ones', () => {
    const disk = new DiskFolders(home());
    const made = disk.create('~/code', 'garden log');
    expect(made.display).toBe('~/code/garden log');
    expect(existsSync(made.path)).toBe(true);
    expect(() => disk.create('~/code', '../x')).toThrow(/letters/);
    expect(() => disk.create('~/code', 'garden log')).toThrow(/already exists/);
  });

  it('answers only the owner over REST', async () => {
    const app = createApp(new Store(openDatabase(':memory:')), undefined, undefined, {
      diskFolders: new DiskFolders(home()),
    });
    const as = (who?: string) => ({ headers: who ? { 'x-pharos-author': who } : {} });
    expect((await app.request('/api/disk/folders', as('agent:x'))).status).toBe(403);
    expect((await app.request('/api/disk/folders', as())).status).toBe(403);
    const ok = await app.request('/api/disk/folders?path=~/code', as('human:me'));
    expect(((await ok.json()) as { folders: unknown[] }).folders).toHaveLength(2);
    const made = await app.request('/api/disk/folders', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-pharos-author': 'human:me' },
      body: JSON.stringify({ parent: '~/code', name: 'new-app' }),
    });
    expect(((await made.json()) as { display: string }).display).toBe('~/code/new-app');
  });
});
