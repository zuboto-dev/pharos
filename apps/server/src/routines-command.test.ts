import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRoutinesClient, routinesRoutes } from './routines.js';

// A Routines folder whose bin/api.py answers like the real one (one request, an envelope), and
// records what it was asked.
const FAKE_API = String.raw`import json, os, sys
here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
method, path = sys.argv[1], sys.argv[2]
body = sys.stdin.read()
with open(os.path.join(here, 'calls.log'), 'a') as f:
    f.write(json.dumps([method, path, body]) + '\n')
if path == '/api/state' and method == 'GET':
    out = {'status': 200, 'type': 'application/json', 'body': {
        'config': {'projects': [{'name': 'garden', 'path': '/tmp/garden'}], 'schedule': {'wrapup': '22:30', 'nightshift': '00:30', 'daybreak': '07:30'}},
        'problems': [], 'current': None, 'status': [{'name': 'garden', 'exists': False}],
        'report': {'text': '', 'date': None, 'when': None}, 'now': '2026-10-26T16:00'}}
elif path.startswith('/api/file'):
    out = {'status': 200, 'type': 'text/plain', 'body': '# NEXT'}
elif path == '/api/run':
    out = {'status': 409, 'type': 'application/json', 'body': {'error': 'wrapup is already running for garden'}}
else:
    out = {'status': 404, 'type': 'application/json', 'body': {'error': 'not found'}}
json.dump(out, sys.stdout)
`;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'routines-cmd-'));
  mkdirSync(join(dir, 'bin'));
  writeFileSync(join(dir, 'bin', 'api.py'), FAKE_API);
  chmodSync(join(dir, 'bin', 'api.py'), 0o755);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const owner = { 'x-pharos-author': 'human:me', 'content-type': 'application/json' };

describe('Routines answered by bin/api.py (no server)', () => {
  it('reads the state, a file and a refusal through the command', async () => {
    const app = routinesRoutes(createRoutinesClient({ dir }));
    const state = (await (await app.request('/state')).json()) as Record<string, unknown>;
    expect(state).toMatchObject({ available: true, url: `bin/api.py in ${dir}` });
    expect((state.config as { projects: unknown[] }).projects).toHaveLength(1);
    const file = await app.request('/file?project=garden&name=NEXT.md');
    expect(await file.json()).toMatchObject({ text: '# NEXT' });
    const run = await app.request('/run', {
      method: 'POST',
      headers: owner,
      body: JSON.stringify({ routine: 'wrapup', project: 'garden' }),
    });
    expect(run.status).toBe(409);
  });

  it('says what to check when the command is missing', async () => {
    rmSync(join(dir, 'bin', 'api.py'));
    const app = routinesRoutes(createRoutinesClient({ dir }));
    const state = (await (await app.request('/state')).json()) as Record<string, unknown>;
    expect(state.available).toBe(false);
    expect(String(state.reason)).toMatch(/PHAROS_ROUTINES_DIR/);
  });
});

describe('reads shared between tabs', () => {
  it('runs the command once for reads close together, and again after a write', async () => {
    const app = routinesRoutes(createRoutinesClient({ dir, cacheMs: 60_000 }));
    await Promise.all([app.request('/state'), app.request('/state'), app.request('/state')]);
    await app.request('/state');
    const calls = () => readFileSync(join(dir, 'calls.log'), 'utf8').trim().split('\n');
    expect(calls().filter((l) => l.includes('"GET", "/api/state"'))).toHaveLength(1);
    await app.request('/run', {
      method: 'POST',
      headers: owner,
      body: JSON.stringify({ routine: 'wrapup', project: 'garden' }),
    });
    await app.request('/state');
    expect(calls().filter((l) => l.includes('"GET", "/api/state"')).length).toBeGreaterThan(1);
  });
});
