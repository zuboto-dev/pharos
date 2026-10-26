import { approvalBlock, hasWord, valueFor, type Author, type Entity } from '@pharos/schema';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { StandingApprovals } from './approvals.js';
import { RunLog, askOwner, deskOf } from './desk.js';
import { pulseOf } from './pulse.js';
import { openDatabase } from './store/database.js';
import { Store } from './store/store.js';

const me: Author = { kind: 'human', name: 'me' };
const agent: Author = { kind: 'agent', name: 'Night runner' };
const MERGE = [
  { id: 'yes', label: 'Looks good: merge it' },
  { id: 'no', label: 'Not yet' },
];

function setup(now = () => new Date()) {
  const store = new Store(openDatabase(':memory:'));
  const { created } = store.apply(me, {
    message: 'Set up',
    operations: [
      { op: 'create', type: 'project', ref: 'p', data: { name: 'Garden' } },
      { op: 'create', type: 'project', ref: 'q', data: { name: 'Bike' } },
      { op: 'create', type: 'assignee', ref: 'me', data: { name: 'Sam', kind: 'human' } },
    ],
  });
  const approvals = new StandingApprovals(store, now);
  store.onCommit(() => approvals.sweep());
  const ask = (title: string, extra: Record<string, unknown> = {}, projectId = created.p!) =>
    askOwner(store, agent, {
      projectId,
      title,
      options: MERGE,
      recommendedOptionId: 'yes',
      ...extra,
    } as Parameters<typeof askOwner>[2]);
  const decision = (id: string) => store.get(id) as Entity<'decision'>;
  return { store, approvals, p: created.p!, q: created.q!, ask, decision };
}

const rule = { name: 'Merge reviewed work', words: ['merge'], waitHours: 0, enabled: true };

describe('standing approvals', () => {
  it('matches whole words only, ignoring case', () => {
    expect(hasWord('Merge the fix?', 'merge')).toBe(true);
    expect(hasWord('Tasks …: merge it?', 'merge')).toBe(true);
    expect(hasWord('Emerge from review', 'merge')).toBe(false);
    expect(hasWord('Fast-forward main', 'fast-forward')).toBe(true);
  });

  it('answers a matching decision as soon as it is asked, with the recommendation, as the owner', () => {
    const { store, approvals, ask, decision, p } = setup();
    approvals.saveRule(rule);
    const asked = approvals.withAnswer(ask('Agents page: merge it?'));
    expect(asked).toMatchObject({ answered: { option: 'Looks good: merge it', rule: rule.name } });
    const d = decision(asked.id);
    expect(d.data.chosenOptionId).toBe('yes');
    expect(d.data.status).toBe(
      valueFor(store.get(p) as Entity<'project'>, 'decision.status', 'accepted'),
    );
    const [revision] = store.history({ entityId: d.id, limit: 1 });
    expect(revision!.author).toEqual({ kind: 'human', name: 'rule: Merge reviewed work' });
    expect(revision!.message).toMatch(/^Standing approval “Merge reviewed work”: Choose/);
    expect(approvals.state().answers).toHaveLength(1);
    expect(deskOf(store, new RunLog(store)).items.some((i) => i.id === d.id)).toBe(false);
  });

  it('leaves gates, item picks, notes, non-yes picks and never-words to the owner', () => {
    const { approvals, ask, decision } = setup();
    approvals.saveRule({ ...rule, words: ['merge', 'delete'] });
    const ids = [
      ask('Merge to main?', { gate: true }).id,
      ask('Merge these?', {
        items: { list: [{ id: 'x', label: 'x' }], appliesTo: 'yes' },
      }).id,
      ask('Merge now?', {
        options: [
          { id: 'yes', label: 'Merge', asks: 'What did you check?' },
          { id: 'no', label: 'No' },
        ],
      }).id,
      ask('Merge or wait?', { recommendedOptionId: 'no' }).id,
      ask('Merge and delete the old branches?').id,
      ask('Rename the page?').id,
    ];
    for (const id of ids) expect(decision(id).data.chosenOptionId).toBeUndefined();
    expect(approvalBlock({ ...decision(ids[4]!).data, id: ids[4]!, createdAt: '' })).toBe(
      'mentions “delete”',
    );
  });

  it('keeps to its projects, and waits its hours first', () => {
    let now = new Date();
    const { approvals, ask, decision, p, q } = setup(() => now);
    approvals.saveRule({ ...rule, projectIds: [p], waitHours: 12 });
    const here = ask('Merge it?').id;
    const there = ask('Merge it?', {}, q).id;
    expect(decision(here).data.chosenOptionId).toBeUndefined();
    // decisions are created on the real clock; move the rule's clock well past their wait
    now = new Date(Date.now() + 13 * 3600_000);
    approvals.sweep();
    expect(decision(here).data.chosenOptionId).toBe('yes');
    expect(decision(there).data.chosenOptionId).toBeUndefined();
  });

  it('undo reopens the decision, and the rule never answers it again', () => {
    const { store, approvals, ask, decision } = setup();
    approvals.saveRule(rule);
    const id = ask('Merge it?').id;
    expect(decision(id).data.chosenOptionId).toBe('yes');
    approvals.undo(id, me);
    expect(decision(id).data.chosenOptionId).toBeUndefined();
    approvals.sweep();
    expect(decision(id).data.chosenOptionId).toBeUndefined();
    expect(deskOf(store, new RunLog(store)).items.some((i) => i.id === id)).toBe(true);
    expect(approvals.state().week.byRules).toBe(0);
  });

  it('a disabled rule answers nothing; state lists what a rule would answer now', () => {
    const { approvals, ask, decision } = setup();
    const saved = approvals.saveRule({ ...rule, enabled: false });
    const id = ask('Merge it?').id;
    expect(decision(id).data.chosenOptionId).toBeUndefined();
    expect(approvals.state().matches[saved.id]!.map((m) => m.id)).toEqual([id]);
    approvals.saveRule({ ...rule, id: saved.id, enabled: true });
    expect(decision(id).data.chosenOptionId).toBe('yes');
  });

  it('suggests a rule for a word the owner nearly always answered with the recommendation', () => {
    const { store, approvals, ask } = setup(() => new Date());
    const app = createApp(store, undefined, undefined, { approvals });
    for (const n of [1, 2, 3]) {
      const id = ask(`Feature ${n}: merge it?`).id;
      store.apply(me, {
        message: 'answer',
        operations: [
          {
            op: 'update',
            type: 'decision',
            id,
            data: { chosenOptionId: 'yes', decisionDate: new Date().toISOString().slice(0, 10) },
          },
        ],
      });
    }
    expect(approvals.state().suggestions).toEqual([
      { word: 'merge', followed: 3, answered: 3, waitHours: 0 },
    ]);
    expect(approvals.state().week).toMatchObject({ answered: 3, followed: 3 });
    expect(app).toBeTruthy();
  });

  it('rechecks inside the write: a decision made a gate since the sweep read it stays open', () => {
    const { store, approvals, ask, decision } = setup();
    const id = ask('Merge it?').id;
    const saved = approvals.saveRule({ ...rule, enabled: false });
    const stale = { ...decision(id).data, id, createdAt: decision(id).createdAt };
    store.apply(agent, {
      message: 'now a gate',
      operations: [{ op: 'update', type: 'decision', id, data: { gate: true } }],
    });
    store.setSetting('approvals.rules', [{ ...saved, enabled: true }]);
    const answer = (
      approvals as unknown as {
        answer: (r: typeof saved, d: typeof stale, now: Date) => unknown;
      }
    ).answer({ ...saved, enabled: true }, stale, new Date());
    expect(answer).toBeUndefined();
    expect(decision(id).data.chosenOptionId).toBeUndefined();
  });

  it('an answer a rule gives while an undo runs is kept in the list', () => {
    const { store, approvals, ask, decision } = setup();
    const merge = approvals.saveRule(rule);
    const link = approvals.saveRule({ ...rule, name: 'Links', words: ['link'], enabled: false });
    const first = ask('Merge it?').id;
    const second = ask('Link the project?').id;
    expect(decision(second).data.chosenOptionId).toBeUndefined();
    // Turned on without a sweep: the undo's commit is what answers the second one.
    store.setSetting('approvals.rules', [merge, { ...link, enabled: true }]);
    approvals.undo(first, me);
    expect(decision(second).data.chosenOptionId).toBe('yes');
    const answers = approvals.answers();
    expect(answers.find((a) => a.decisionId === second)).toMatchObject({ rule: 'Links' });
    expect(answers.find((a) => a.decisionId === first)?.undoneAt).toBeTruthy();
    expect(store.setting('approvals.log')).toBeUndefined();
  });

  it('only the owner changes rules or undoes an answer over REST', async () => {
    const { store, approvals } = setup();
    const app = createApp(store, undefined, undefined, { approvals });
    const post = (path: string, body: unknown, who?: string) =>
      app.request(`/api${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(who ? { 'x-pharos-author': who } : {}) },
        body: JSON.stringify(body),
      });
    expect((await post('/approvals/rules', rule, 'agent:bot')).status).toBe(403);
    expect((await post('/approvals/undo', { decisionId: 'x' }, 'agent:bot')).status).toBe(403);
    const res = await post('/approvals/rules', rule, 'human:me');
    expect(res.status).toBe(200);
    expect(approvals.rules()).toHaveLength(1);
  });
});

describe('pulse', () => {
  it('counts tasks, the stage date and what waits on the owner, per project', () => {
    const { store, approvals, p, ask } = setup(() => new Date());
    const today = new Date().toISOString().slice(0, 10);
    const { created } = store.apply(agent, {
      message: 'plan',
      operations: [
        {
          op: 'create',
          type: 'stage',
          ref: 's',
          data: { projectId: p, name: 'Beta', status: 'active', targetDate: today, order: 1 },
        },
        {
          op: 'create',
          type: 'task',
          ref: 'a',
          data: { projectId: p, title: 'Dig', status: 'todo' },
        },
        {
          op: 'create',
          type: 'task',
          ref: 'b',
          data: { projectId: p, title: 'Sow', status: 'blocked' },
        },
      ],
    });
    store.apply(agent, {
      message: 'progress',
      operations: [
        { op: 'update', type: 'project', id: p, data: { currentStageId: created.s! } },
        { op: 'update', type: 'task', id: created.a!, data: { status: 'done' } },
      ],
    });
    ask('Which seeds?', { recommendedOptionId: 'yes' });
    const pulse = pulseOf(store, new RunLog(store), approvals).projects.find(
      (x) => x.projectId === p,
    )!;
    expect(pulse.stage).toMatchObject({ name: 'Beta', daysLeft: 0, index: 1, of: 1 });
    expect(pulse.tasks).toMatchObject({ blocked: 1, doneWeek: 1, addedWeek: 2, open: 0 });
    expect(pulse.doneByDay.at(-1)).toBe(1);
    expect(pulse.waiting.count).toBe(1);
    expect(pulse.last?.message).toBe('Ask the owner: Which seeds?');
  });
});
