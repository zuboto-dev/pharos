// R4.2 contract: the picture blocks' schemas, claim fields and text helpers · Opus 5.5
import { describe, expect, it } from 'vitest';
import { ClaimData, WEAK_BECAUSE_LABELS, WeakBecause } from '../entities.js';
import { COMPONENT_INFO } from './catalog-info.js';
import { evidenceId, ViewNode } from './catalog.js';
import { changedLines, diffWords, stripWorkCode } from './text-tools.js';

const claim = {
  projectId: 'prj_1',
  statement: 'OpenUI uses fewer tokens.',
  certainty: 'verified',
  checkedOn: '2026-10-12',
  sourceIds: ['art_1'],
  tags: [],
  order: 0,
};
const ok = (node: unknown) => ViewNode.safeParse(node).success;

describe('claim fields for pictures', () => {
  it('takes an optional figure, locator and weakBecause, and old claims still parse', () => {
    expect(ClaimData.safeParse(claim).success).toBe(true);
    const full = {
      ...claim,
      figure: { value: 4800, unit: 'tokens', label: 'OpenUI' },
      locator: '§7 Completion',
      weakBecause: 'one-source',
    };
    expect(ClaimData.safeParse(full).success).toBe(true);
    expect(
      ClaimData.safeParse({ ...full, figure: { value: 1, label: 'x'.repeat(25) } }).success,
    ).toBe(false);
    expect(
      ClaimData.safeParse({ ...full, figure: { value: '4800', label: 'OpenUI' } }).success,
    ).toBe(false);
    expect(ClaimData.safeParse({ ...full, locator: 'x'.repeat(61) }).success).toBe(false);
    expect(ClaimData.safeParse({ ...full, weakBecause: 'vibes' }).success).toBe(false);
    expect(Object.keys(WEAK_BECAUSE_LABELS)).toEqual(WeakBecause.options);
  });
});

describe('picture blocks', () => {
  it('has a valid example for each new block', () => {
    for (const name of ['BeforeAfter', 'FindingChart'] as const)
      expect(ok(COMPONENT_INFO[name].example)).toBe(true);
  });

  it('accepts a Layers flow with label-only steps and per-step progress', () => {
    expect(
      ok({
        component: 'Layers',
        orientation: 'flow',
        layers: [
          { key: '1', title: 'Your question' },
          {
            key: '2',
            title: 'AI arranges blocks',
            items: { where: { tags: 'step-2' } },
            progress: { stageId: 'stg_1' },
          },
        ],
      }),
    ).toBe(true);
    expect(
      ok({ component: 'Layers', orientation: 'zigzag', layers: [{ key: '1', title: 'A' }] }),
    ).toBe(false);
  });

  it('needs before and after on a BeforeAfter and keeps labels short', () => {
    expect(ok({ component: 'BeforeAfter', before: 'clm_a' })).toBe(false);
    expect(
      ok({ component: 'BeforeAfter', before: 'clm_a', after: 'clm_b', afterLabel: 'x'.repeat(25) }),
    ).toBe(false);
  });

  it('takes a FindingChart from a count query', () => {
    expect(
      ok({
        component: 'FindingChart',
        claim: 'clm_1',
        count: { query: { type: 'task' }, by: 'status', sort: 'count' },
        highlight: 'done',
      }),
    ).toBe(true);
  });

  it('takes a Text bar, StartHere evidence labels, and hideCodes on tables', () => {
    expect(
      ok({
        component: 'Text',
        content: 'Done ${d}',
        values: { d: { bar: { query: { type: 'task' }, of: { type: 'task' } } } },
      }),
    ).toBe(true);
    const start = COMPONENT_INFO.StartHere.example;
    expect(ok(start)).toBe(true);
    expect(ok({ ...start, evidence: ['art_1', { id: 'art_2', label: 'G1 measures' }] })).toBe(true);
    expect(ok({ ...start, evidence: [{ id: 'art_2', label: 'x'.repeat(25) }] })).toBe(false);
    expect(evidenceId('art_1')).toBe('art_1');
    expect(evidenceId({ id: 'art_2', label: 'G1 measures' })).toBe('art_2');
    expect(ok({ component: 'TaskTable', hideCodes: true, terms: true })).toBe(true);
    expect(
      ok({ component: 'DataList', query: { type: 'task' }, hideCodes: true, terms: false }),
    ).toBe(true);
  });
});

describe('text helpers', () => {
  it('hides work codes at the start of a title only', () => {
    expect(stripWorkCode('W3.8 · Measure the baseline')).toBe('Measure the baseline');
    expect(stripWorkCode('R4.2: Contract')).toBe('Contract');
    expect(stripWorkCode('G1 – Agree the test')).toBe('Agree the test');
    expect(stripWorkCode('Measure W3.8 later')).toBe('Measure W3.8 later');
    expect(stripWorkCode('Plain title')).toBe('Plain title');
    expect(stripWorkCode('W3.8 · ')).toBe('W3.8 · ');
  });

  it('diffs two passages word by word', () => {
    const parts = diffWords('Run pnpm dev to start.', 'Run pnpm service install to start.');
    expect(parts).toEqual([
      { op: 'same', text: 'Run pnpm ' },
      { op: 'removed', text: 'dev ' },
      { op: 'added', text: 'service install ' },
      { op: 'same', text: 'to start.' },
    ]);
    const join = (ops: string[]) =>
      parts
        .filter((p) => ops.includes(p.op))
        .map((p) => p.text)
        .join('');
    expect(join(['same', 'removed'])).toBe('Run pnpm dev to start.');
    expect(join(['same', 'added'])).toBe('Run pnpm service install to start.');
    expect(diffWords('same', 'same')).toEqual([{ op: 'same', text: 'same' }]);
  });

  it('lists the lines each passage has that the other lacks', () => {
    expect(changedLines('a\nb\nc', 'a\nB\nc\nd')).toEqual({
      before: ['b'],
      after: ['B', 'd'],
      same: false,
    });
  });

  it('diffs lines in order, so a reordered passage is a change', () => {
    const swap = changedLines('A\nB', 'B\nA');
    expect(swap.same).toBe(false);
    expect(swap.before).toHaveLength(1);
    expect(swap.after).toEqual(swap.before);
    expect(changedLines('a\nb\nc', 'c\na\nb')).toEqual({
      before: ['c'],
      after: ['c'],
      same: false,
    });
    expect(changedLines('a\nb\na', 'a\nb')).toEqual({ before: ['a'], after: [], same: false });
  });

  it('calls passages the same only when every line matches in order', () => {
    expect(changedLines('a\n  b  \n\n', 'a\nb')).toEqual({ before: [], after: [], same: true });
    expect(changedLines('', '')).toEqual({ before: [], after: [], same: true });
    expect(changedLines('a', '').same).toBe(false);
  });
});
