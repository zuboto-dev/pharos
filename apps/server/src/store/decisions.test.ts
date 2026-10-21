// R10.19 decision block, R7.15 file follow-ups and R8 leftovers (v0.2 A2) · Opus 5.5
// Every project, file and folder here is made up; no file on disk is read.
import {
  Board,
  FOLDERS_SETTING,
  type Author,
  type Entity,
  type FileFolder,
  type Operation,
} from '@pharos/schema';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyPack } from '../packs/service.js';
import { previewBoard } from '../views/preview.js';
import { AgentFiles } from './agent-files.js';
import { openDatabase } from './database.js';
import { PharosError } from './errors.js';
import { projectSnapshot } from './snapshot.js';
import { Store } from './store.js';

const human: Author = { kind: 'human', name: 'me' };
const agent: Author = { kind: 'agent', name: 'Opus 5.5' };
const TODAY = '2026-10-13';

function refusal(fn: () => unknown): PharosError {
  try {
    fn();
  } catch (err) {
    if (err instanceof PharosError) return err;
    throw err;
  }
  throw new Error('expected a refusal');
}

const OPTIONS = [
  {
    id: 'a',
    label: 'Picture and one line',
    summary: 'A friendly empty page that says what to add first',
    pros: ['Warm', 'Explains the next step'],
    cons: ['Needs a picture per page'],
  },
  {
    id: 'b',
    label: 'Checklist',
    summary: 'Three steps to set the page up',
    pros: ['Clear progress'],
    cons: ['Busier', 'Longer to read'],
  },
];

let store: Store;
let projectId: string;

beforeEach(() => {
  store = new Store(openDatabase(':memory:'));
  projectId = store.apply(human, {
    message: 'Start',
    operations: [{ op: 'create', type: 'project', data: { name: 'Sample app' } }],
  }).created['0']!;
});

function propose(extra: Record<string, unknown> = {}, author: Author = agent) {
  const result = store.apply(author, {
    message: 'Ask the owner to choose an empty state',
    operations: [
      {
        op: 'create',
        type: 'decision',
        data: {
          projectId,
          title: 'Which empty state should pages use?',
          options: OPTIONS,
          recommendedOptionId: 'a',
          recommendationReason: 'Readers saw what to do first in the trial',
          ...extra,
        },
      },
    ],
  });
  return { id: result.created['0']!, result };
}

function decision(id: string): Entity<'decision'> {
  return store.getOfType('decision', id);
}

function choose(id: string, author: Author, data: Record<string, unknown>) {
  return store.apply(author, {
    message: 'Answer',
    operations: [{ op: 'update', type: 'decision', id, data }],
  });
}

describe('decision with options (R10.19)', () => {
  it('waits for the owner: proposed by default, with no warnings when complete', () => {
    const { id, result } = propose();
    expect(decision(id).data.status).toBe('proposed');
    expect(result.warnings).toEqual([]);
  });

  it('warns about fewer than 2 options and a recommendation without a reason', () => {
    const { result } = propose({ options: [OPTIONS[0]], recommendationReason: undefined });
    expect(result.warnings).toEqual([
      expect.stringContaining('has 1 option; give 2–5'),
      expect.stringContaining('has no recommendationReason'),
    ]);
    const none = propose({ recommendedOptionId: undefined, recommendationReason: undefined });
    expect(none.result.warnings).toEqual([expect.stringContaining('has no recommendedOptionId')]);
  });

  it('lets the owner choose an option, write another answer, or defer', () => {
    const { id } = propose();
    choose(id, human, { deferredUntil: '2026-10-20' });
    expect(decision(id).data).toMatchObject({ status: 'proposed', deferredUntil: '2026-10-20' });
    const me = store.apply(human, {
      message: 'Choose',
      operations: [
        { op: 'create', type: 'assignee', ref: 'me', data: { name: 'me', kind: 'human' } },
        {
          op: 'update',
          type: 'decision',
          id,
          data: {
            chosenOptionId: 'a',
            status: 'accepted',
            decidedById: '$me',
            decisionDate: TODAY,
            deferredUntil: null,
          },
        },
      ],
    });
    expect(decision(id).data).toMatchObject({
      status: 'accepted',
      chosenOptionId: 'a',
      decidedById: me.created.me,
      decisionDate: TODAY,
    });
    expect(decision(id).data.deferredUntil).toBeUndefined();
    // Another answer instead of an option.
    choose(id, human, { chosenOptionId: null, answer: 'Neither: a plain line of text' });
    expect(decision(id).data.answer).toBe('Neither: a plain line of text');
  });

  it('refuses inconsistent choices', () => {
    expect(refusal(() => propose({ recommendedOptionId: 'z' }, human)).issues).toEqual([
      expect.stringContaining('recommendedOptionId: "z" isn\'t one of the options (a, b)'),
    ]);
    expect(
      refusal(() => propose({ options: [OPTIONS[0], { ...OPTIONS[1], id: 'a' }] }, human)).issues,
    ).toEqual([expect.stringContaining('options: id "a" is used twice')]);
    const { id } = propose();
    expect(
      refusal(() => choose(id, human, { chosenOptionId: 'a', answer: 'Both' })).issues,
    ).toEqual([expect.stringContaining('choose an option or write an answer, not both')]);
    expect(
      refusal(() => propose({ options: [{ ...OPTIONS[0], claimIds: ['clm_000000000000'] }] }))
        .issues,
    ).toEqual([expect.stringContaining('claimIds → claim clm_000000000000 not found')]);
  });

  it('only the owner chooses, answers or defers; agents read the answer', () => {
    const { id } = propose();
    for (const data of [
      { chosenOptionId: 'a' },
      { note: 'Looks fine' },
      { answer: 'Neither' },
      { deferredUntil: '2026-11-01' },
      { status: 'accepted' },
    ]) {
      const err = refusal(() => choose(id, agent, data));
      expect(err.message).toMatch(/owner/);
    }
    expect(refusal(() => propose({ status: 'accepted' })).message).toMatch(
      /accepted when the owner chooses/,
    );
    // An agent may still improve the proposal before the owner answers.
    choose(id, agent, { recommendationReason: 'Fewer words on an empty page' });
    const chosen = choose(id, human, { chosenOptionId: 'b', status: 'accepted' });
    // ... but not change what the owner chose from, or undo the choice.
    expect(refusal(() => choose(id, agent, { options: [OPTIONS[0]] })).message).toMatch(
      /already chose/,
    );
    expect(refusal(() => store.revert(chosen.revision!.id, agent)).message).toMatch(/owner/);
    // Agents see the answer.
    const snap = projectSnapshot(store, projectId);
    expect(snap.decisions[0]).toMatchObject({
      options: ['a: Picture and one line', 'b: Checklist'],
      ownerAnswer: 'chose "Checklist"',
    });
    // ... and the owner's note with it.
    choose(id, human, { note: 'Only on the projects list' });
    expect(refusal(() => choose(id, agent, { note: 'Changed' })).message).toMatch(/owner/);
    expect(projectSnapshot(store, projectId).decisions[0]).toMatchObject({
      ownerAnswer: 'chose "Checklist", with the note: Only on the projects list',
    });
    choose(id, human, { note: null });
    // The owner can undo their own choice.
    store.revert(chosen.revision!.id, human);
    expect(decision(id).data.chosenOptionId).toBeUndefined();
  });

  it('takes option sources created in the same apply ("$ref")', () => {
    const made = store.apply(agent, {
      message: 'A finding and the decision it backs',
      operations: [
        {
          op: 'create',
          type: 'claim',
          ref: 'c',
          data: { projectId, statement: 'Readers acted sooner on one step', checkedOn: TODAY },
        },
        {
          op: 'create',
          type: 'decision',
          ref: 'd',
          data: {
            projectId,
            title: 'Which one?',
            options: [{ ...OPTIONS[0], claimIds: ['$c'] }, OPTIONS[1]],
          },
        },
      ],
    });
    expect(decision(made.created.d!).data.options![0]!.claimIds).toEqual([made.created.c]);
    expect(
      refusal(() =>
        choose(made.created.d!, agent, { options: [{ ...OPTIONS[0], claimIds: ['$x'] }] }),
      ).message,
    ).toMatch(/unknown ref "\$x"/);
  });

  it('cites claims as sources and drops one that is deleted', () => {
    const claim = store.apply(human, {
      message: 'A finding',
      operations: [
        {
          op: 'create',
          type: 'claim',
          data: { projectId, statement: 'Readers found the next step faster', checkedOn: TODAY },
        },
      ],
    }).created['0']!;
    const { id } = propose({ options: [{ ...OPTIONS[0], claimIds: [claim] }, OPTIONS[1]] });
    expect(decision(id).data.options![0]!.claimIds).toEqual([claim]);
    store.apply(human, {
      message: 'Remove the finding',
      operations: [{ op: 'delete', type: 'claim', id: claim }],
    });
    expect(decision(id).data.options![0]!.claimIds).toBeUndefined();
    expect(decision(id).data.options![0]!.label).toBe('Picture and one line');
  });

  it('previews a DecisionBlock: its options, warnings, the answer, and StartHere pointing at it', () => {
    const { id } = propose({ recommendationReason: undefined });
    const board = (yourPartTarget: string) =>
      Board.parse({
        component: 'Board',
        widgets: [
          {
            id: 'start',
            node: {
              component: 'StartHere',
              purpose: 'needs-you',
              why: 'Every empty page should say what to do next',
              headline: 'Pick the empty state every page will use.',
              yourPart: 'Choose one of two empty states by Friday.',
              yourPartTarget,
              evidence: [id],
              date: TODAY,
              due: '2026-10-16',
              path: [
                { label: 'The choice', target: 'choice' },
                { label: 'Decided before', target: 'log' },
              ],
            },
          },
          { id: 'choice', node: { component: 'DecisionBlock', decision: id } },
          { id: 'log', node: { component: 'DecisionLog' } },
        ],
      });
    const preview = previewBoard(store, projectId, board('choice'), TODAY);
    const block = preview.widgets.find((w) => w.id === 'choice')!;
    expect(block.shows).toBe(
      '“Which empty state should pages use?”: 2 options to choose from (Picture and one line (recommended) / Checklist)',
    );
    expect(block.warnings).toEqual([expect.stringContaining('has no recommendationReason')]);
    expect(preview.widgets[0]!.warnings.join(' ')).not.toMatch(/yourPartTarget/);
    expect(
      previewBoard(store, projectId, board('nowhere'), TODAY).widgets[0]!.warnings,
    ).toContainEqual(expect.stringContaining('yourPartTarget points at widget "nowhere"'));
    choose(id, human, { chosenOptionId: 'a', status: 'accepted' });
    const after = previewBoard(store, projectId, board('choice'), TODAY).widgets[1]!;
    expect(after.shows).toBe(
      '“Which empty state should pages use?”: the owner chose “Picture and one line”',
    );
    expect(after.warnings).toEqual([]);
  });
});

describe('files (R7.15) and records (R8 leftovers)', () => {
  const folders: FileFolder[] = [
    {
      id: 'root_shared01',
      path: '/made-up/Shared',
      label: 'Shared',
      level: 'details',
      addedAt: '2026-10-12T10:00:00.000Z',
    },
    {
      id: 'root_vault001',
      path: '/made-up/Vault',
      label: 'Vault',
      level: 'hidden',
      addedAt: '2026-10-12T10:00:00.000Z',
    },
  ];
  const file = (ref: string, rootId: string, path: string, extra: object = {}): Operation => ({
    op: 'create',
    type: 'file',
    ref,
    data: {
      projectId,
      title: path,
      rootId,
      path,
      size: 10,
      modifiedAt: '2026-09-01T10:00:00.000Z',
      ...extra,
    },
  });

  it('clears an artifact picture when its file is deleted, and undo brings both back', () => {
    store.setSetting(FOLDERS_SETTING, folders);
    const pic = store.apply(human, {
      message: 'A picture',
      operations: [file('pic', 'root_shared01', 'empty-state-a.png')],
    }).created.pic!;
    const art = store.apply(human, {
      message: 'Show it',
      operations: [
        {
          op: 'create',
          type: 'artifact',
          data: { projectId, title: 'Empty state A', image: pic, alt: 'An empty page' },
        },
      ],
    }).created['0']!;
    expect(store.getOfType('artifact', art).data.image).toBe(pic);
    const removed = store.apply(human, {
      message: 'Remove the file',
      operations: [{ op: 'delete', type: 'file', id: pic }],
    });
    expect(store.getOfType('artifact', art).data.image).toBeUndefined();
    expect(store.getOfType('artifact', art).data.alt).toBe('An empty page');
    store.revert(removed.revision!.id, human);
    expect(store.getOfType('artifact', art).data.image).toBe(pic);
  });

  it("history diffs of a record don't name a file in a hidden folder", () => {
    store.setSetting(FOLDERS_SETTING, folders);
    store.apply(human, {
      message: 'Record types',
      operations: [
        {
          op: 'update',
          type: 'project',
          id: projectId,
          data: {
            recordTypes: [
              {
                key: 'paper',
                name: 'Paper',
                fields: [
                  { key: 'scan', label: 'Scan', kind: 'file' },
                  { key: 'note', label: 'Note', kind: 'text' },
                ],
              },
            ],
          },
        },
      ],
    });
    const made = store.apply(human, {
      message: 'A paper with a hidden scan',
      operations: [
        file('secret', 'root_vault001', 'Private/passport-scan.pdf'),
        file('open', 'root_shared01', 'insurance.pdf'),
        {
          op: 'create',
          type: 'record',
          ref: 'rec',
          data: {
            projectId,
            recordType: 'paper',
            title: 'Passport',
            fields: { scan: '$secret', note: 'Renew soon' },
          },
        },
      ],
    });
    const { secret, open, rec } = made.created as Record<string, string>;
    store.apply(human, {
      message: 'Swap the scan',
      operations: [
        { op: 'update', type: 'record', id: rec!, data: { fields: { scan: open, note: 'Done' } } },
      ],
    });
    const files = new AgentFiles(store);
    const history = files.revisions(store.history({ projectId }));
    const text = JSON.stringify(history);
    expect(text).not.toContain(secret);
    expect(text).toContain(open);
    expect(JSON.stringify(files.diffs(store.diff({ from: 0, projectId })))).not.toContain(secret);
    // A change only to a hidden value disappears; the rest stays.
    const swap = history.find((r) => r.message === 'Swap the scan')!;
    expect(swap.changes[0]!.fields.fields).toEqual({
      before: { note: 'Renew soon' },
      after: { scan: open, note: 'Done' },
    });
  });

  it("agents don't see an option's source taken only from a hidden file", () => {
    store.setSetting(FOLDERS_SETTING, folders);
    const secret = store.apply(human, {
      message: 'A private paper',
      operations: [file('secret', 'root_vault001', 'Private/survey.pdf')],
    }).created.secret!;
    const made = store.apply(human, {
      message: 'Sources',
      operations: [
        {
          op: 'create',
          type: 'artifact',
          ref: 'src',
          data: { projectId, title: 'Private survey', fileId: secret },
        },
        {
          op: 'create',
          type: 'claim',
          ref: 'hidden',
          data: { projectId, statement: 'Hidden finding', checkedOn: TODAY, sourceIds: ['$src'] },
        },
        {
          op: 'create',
          type: 'claim',
          ref: 'open',
          data: { projectId, statement: 'Open finding', checkedOn: TODAY },
        },
      ],
    });
    const { hidden, open } = made.created as Record<string, string>;
    const { id } = propose(
      { options: [{ ...OPTIONS[0], claimIds: [hidden!, open!] }, OPTIONS[1]] },
      human,
    );
    const files = new AgentFiles(store);
    const seen = files.entity(decision(id))!;
    expect(seen.data.options![0]!.claimIds).toEqual([open]);
    expect(JSON.stringify(files.revisions(store.history({ projectId })))).not.toContain(hidden);
  });

  it('DueTracker shows files by expiry and the preview names the unit', () => {
    store.apply(human, {
      message: 'Papers',
      operations: [
        file('soon', 'root_shared01', 'licence.pdf', { expiryDate: '2026-11-20' }),
        file('late', 'root_shared01', 'permit.pdf', { expiryDate: '2026-10-01' }),
        file('far', 'root_shared01', 'deed.pdf', { expiryDate: '2028-01-01' }),
        file('none', 'root_shared01', 'notes.pdf'),
      ],
    });
    store.setSetting(FOLDERS_SETTING, folders);
    const board = Board.parse({
      component: 'Board',
      widgets: [
        {
          id: 'due',
          node: {
            component: 'DueTracker',
            query: { type: 'file', where: { expiryDate: { exists: true } } },
          },
        },
      ],
    });
    expect(previewBoard(store, projectId, board, TODAY).widgets[0]!.shows).toBe(
      'Past due: “permit.pdf” (expires 2026-10-01) · Urgent: “licence.pdf” (expires 2026-11-20) · Not urgent: “deed.pdf” (expires 2028-01-01)',
    );

    const car = applyPack(store, agent, { pack: 'car', name: 'Car', examples: true }, TODAY);
    const view = store.list('view', { projectId: car.projectId })[0]!;
    const due = previewBoard(store, car.projectId, view.data.spec as Board, TODAY).widgets.find(
      (w) => w.component === 'DueTracker',
    )!;
    expect(due.shows).toMatch(/\d km (left|over)/);
  });
});
