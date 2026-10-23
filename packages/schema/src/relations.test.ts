import { describe, expect, it } from 'vitest';
import type { Entity } from './entities.js';
import { relationLine, relationNotes } from './relations.js';

let rev = 1;
function decision(
  id: string,
  title: string,
  data: Record<string, unknown> = {},
): Entity<'decision'> {
  const r = rev++;
  return {
    id,
    type: 'decision',
    data: {
      projectId: 'p',
      title,
      status: 'proposed',
      options: [
        { id: 'a', label: 'Yes' },
        { id: 'b', label: 'No' },
      ],
      ...data,
    },
    createdAt: '2026-10-23T00:00:00Z',
    updatedAt: '2026-10-23T00:00:00Z',
    createdRev: r,
    updatedRev: r,
  } as unknown as Entity<'decision'>;
}

describe('what relations say', () => {
  it('a skipped decision, one decided on top of it, then the skipped one answered', () => {
    const a = decision('dec_a', 'Which payment provider?');
    const b = decision('dec_b', 'What price for Plus?', {
      dependsOn: ['dec_a'],
      chosenOptionId: 'a',
    });
    const all = [a, b];
    const lookup = (id: string) => all.find((d) => d.id === id);
    // B was decided while A is still open.
    expect(relationNotes(b, lookup, all)).toEqual([
      { kind: 'waiting', id: 'dec_a', title: 'Which payment provider?' },
    ]);
    expect(relationLine(relationNotes(a, lookup, all)[0]!)).toBe(
      '“What price for Plus?” was decided assuming this one',
    );
    // A is answered afterwards: B may be outdated.
    const answered = { ...a, data: { ...a.data, chosenOptionId: 'b' }, updatedRev: rev++ };
    const now = [answered, b];
    const later = (id: string) => now.find((d) => d.id === id);
    expect(relationNotes(answered, later, now)).toEqual([]);
    expect(relationLine(relationNotes(b, later, now)[0]!)).toBe(
      'May be outdated: “Which payment provider?” changed after this was settled',
    );
  });

  it('a finding whose source changed after it was written', () => {
    const claim = {
      id: 'clm_1',
      type: 'claim',
      data: {
        projectId: 'p',
        statement: 'Stripe charges 2.9%',
        checkedOn: '2026-10-20',
        sourceIds: ['art_1'],
      },
      updatedRev: 5,
    } as unknown as Entity;
    const source = {
      id: 'art_1',
      type: 'artifact',
      data: { title: 'Stripe pricing' },
      updatedRev: 9,
    } as unknown as Entity;
    expect(relationNotes(claim, (id) => (id === 'art_1' ? source : undefined))).toEqual([
      { kind: 'changed', id: 'art_1', title: 'Stripe pricing' },
    ]);
  });
});
