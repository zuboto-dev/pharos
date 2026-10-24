import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Author, Entity, RoutineDef, RoutinesConfig } from '@pharos/schema';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { deskAnswer } from './desk.js';
import {
  PROPOSALS_SETTING,
  pendingProposals,
  proposalSettler,
  proposeRoutine,
  routineFor,
} from './routine-proposals.js';
import { createRoutinesClient } from './routines.js';
import { openDatabase } from './store/database.js';
import { Store } from './store/store.js';

// A fake Routines server in this process (never the owner's real one).

const me: Author = { kind: 'human', name: 'me' };
const agent: Author = { kind: 'agent', name: 'claude-code' };

const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
});

async function fakeRoutines() {
  let config: RoutinesConfig = {
    schedule: { timezone: 'UTC' },
    master: { model: 'opus', effort: 'high' },
    dispatch: {},
    projects: [{ name: 'tutti', path: '/tmp/tutti', enrolled: true, budget_usd: 8, hours: 4 }],
    routines: [
      {
        id: 'wrapup',
        name: 'Evening wrap-up',
        time: '00:00',
        enabled: true,
        skill: 'wrapup',
        instructions: 'Close the day.',
        projects: 'enrolled',
      },
    ],
  };
  const posts: RoutinesConfig[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.method === 'POST' && req.url === '/api/state') {
        const patch = JSON.parse(body) as RoutinesConfig;
        posts.push(patch);
        config = { ...config, ...patch };
        return res.end(JSON.stringify({ ok: true }));
      }
      res.end(JSON.stringify({ config, status: [], now: '2026-10-23T14:00' }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    posts,
    config: () => config,
  };
}

function setup() {
  const store = new Store(openDatabase(':memory:'));
  const { created } = store.apply(me, {
    message: 'Set up',
    operations: [
      { op: 'create', type: 'repository', ref: 'r', data: { name: 'Tutti', path: '/tmp/tutti' } },
      { op: 'create', type: 'project', ref: 't', data: { name: 'Tutti', repositoryId: '$r' } },
    ],
  });
  return { store, tutti: created.t! };
}

const WEEKLY = {
  name: 'Weekly review',
  time: '17:00',
  days: ['fri'],
  instructions: 'Read the week: what slipped, and what to drop.',
  projects: ['tutti'],
  reason: 'You asked for a Friday look back.',
};

const decisionOf = (store: Store, id: string) => store.get(id) as Entity<'decision'>;

describe('routine_propose', () => {
  it('puts one decision on the owner’s desk, the proposal kept beside it', () => {
    const { store, tutti } = setup();
    const out = proposeRoutine(store, agent, WEEKLY);
    expect(out.title).toBe('Add the routine “Weekly review”, Fridays 17:00, for tutti?');
    const d = decisionOf(store, out.decisionId);
    expect(d.data.projectId).toBe(tutti);
    expect(d.data.options?.map((o) => [o.id, o.label])).toEqual([
      ['add', 'Add it'],
      ['not-now', 'Not now'],
    ]);
    expect(d.data.recommendedOptionId).toBe('add');
    expect(d.data.body).toContain('Read the week: what slipped, and what to drop.');
    expect(pendingProposals(store).map((p) => [p.proposedBy, p.proposal.name])).toEqual([
      ['Claude Code', 'Weekly review'],
    ]);
    expect(store.setting<Record<string, unknown>>(PROPOSALS_SETTING)).toHaveProperty(
      out.decisionId,
    );
  });

  it('refuses a proposal it can’t add, saying what to fix', () => {
    const { store } = setup();
    expect(() => proposeRoutine(store, agent, { ...WEEKLY, time: '25:00' })).toThrow(/time/);
    expect(() => proposeRoutine(store, agent, { ...WEEKLY, instructions: '  ' })).toThrow(
      /instructions/,
    );
    expect(() => proposeRoutine(store, agent, { ...WEEKLY, days: ['fri', 'fri'] })).toThrow(
      /each day once/,
    );
    expect(() => proposeRoutine(store, agent, { ...WEEKLY, days: ['friday'] })).toThrow(/days/);
    expect(() => proposeRoutine(store, agent, { ...WEEKLY, projects: ['nowhere'] })).toThrow(
      /projectId/,
    );
    expect(store.list('decision')).toEqual([]);
  });

  it('makes a routine with a free id, days only when not every day', () => {
    const r = routineFor(
      { ...WEEKLY, days: ['fri'], projects: ['tutti'] } as Parameters<typeof routineFor>[0],
      ['weekly-review'],
    );
    expect(r).toEqual({
      id: 'weekly-review-2',
      name: 'Weekly review',
      time: '17:00',
      enabled: true,
      instructions: 'Read the week: what slipped, and what to drop.',
      projects: ['tutti'],
      days: ['fri'],
    } satisfies RoutineDef);
  });
});

describe('the owner’s answer', () => {
  it('Add it adds the routine through Routines and notes it on the decision', async () => {
    const fake = await fakeRoutines();
    const { store } = setup();
    const settler = proposalSettler(store, createRoutinesClient({ url: fake.url }));
    const { decisionId } = proposeRoutine(store, agent, WEEKLY);
    await settler.settle();
    expect(fake.posts).toEqual([]);
    deskAnswer(store, me, { id: decisionId, chosenOptionId: 'add' });
    await settler.settle();
    expect(fake.config().routines!.map((r) => r.id)).toEqual(['wrapup', 'weekly-review']);
    expect(fake.config().routines![1]).toMatchObject({ days: ['fri'], projects: ['tutti'] });
    expect(decisionOf(store, decisionId).data.body).toMatch(/Added to Routines \(weekly-review\)/);
    expect(pendingProposals(store)).toEqual([]);
    // Settling again adds nothing twice.
    await settler.settle(true);
    expect(fake.posts.length).toBe(1);
  });

  it('Not now changes nothing', async () => {
    const fake = await fakeRoutines();
    const { store } = setup();
    const settler = proposalSettler(store, createRoutinesClient({ url: fake.url }));
    const { decisionId } = proposeRoutine(store, agent, WEEKLY);
    deskAnswer(store, me, { id: decisionId, chosenOptionId: 'not-now' });
    await settler.settle(true);
    expect(fake.posts).toEqual([]);
    expect(pendingProposals(store)).toEqual([]);
  });

  it('when Routines is down, the decision goes back on the desk and is added later', async () => {
    const fake = await fakeRoutines();
    const { store } = setup();
    const down = proposalSettler(
      store,
      createRoutinesClient({ url: 'http://127.0.0.1:9', timeoutMs: 300 }),
    );
    const { decisionId } = proposeRoutine(store, agent, WEEKLY);
    deskAnswer(store, me, { id: decisionId, chosenOptionId: 'add' });
    await down.settle();
    const reopened = decisionOf(store, decisionId);
    expect(reopened.data.chosenOptionId).toBeUndefined();
    expect(reopened.data.body).toMatch(/Routines didn't answer/);
    expect(pendingProposals(store)[0]!.waiting).toMatch(/didn't answer/);

    // Back up: a page load (retry) adds it, and the owner's yes is on the decision again.
    const up = proposalSettler(store, createRoutinesClient({ url: fake.url }));
    await up.settle(); // a revision alone doesn't retry
    expect(fake.posts).toEqual([]);
    await up.settle(true);
    expect(fake.config().routines!.map((r) => r.id)).toContain('weekly-review');
    expect(decisionOf(store, decisionId).data.chosenOptionId).toBe('add');
  });

  it('an answer anywhere (here, the desk route) adds it, and the page lists only pending ones', async () => {
    const fake = await fakeRoutines();
    const { store } = setup();
    const app = createApp(store, undefined, undefined, { routines: { url: fake.url } });
    const { decisionId } = proposeRoutine(store, agent, WEEKLY);
    const state = (await (await app.request('/api/routines/state')).json()) as {
      proposals: { decisionId: string }[];
    };
    expect(state.proposals.map((p) => p.decisionId)).toEqual([decisionId]);
    const res = await app.request('/api/desk/answer', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-pharos-author': 'human:me' },
      body: JSON.stringify({ id: decisionId, chosenOptionId: 'add' }),
    });
    expect(res.status).toBe(200);
    for (let i = 0; i < 40 && !fake.posts.length; i++) await new Promise((r) => setTimeout(r, 25));
    expect(fake.config().routines!.map((r) => r.id)).toContain('weekly-review');
    const after = (await (await app.request('/api/routines/state')).json()) as {
      proposals: unknown[];
    };
    expect(after.proposals).toEqual([]);
  });
});
