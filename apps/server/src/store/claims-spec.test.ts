// Claim store requirements from the slice spec · 2026-10-11 · GPT-6-Astra · 75c8964
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Author, Operation } from '@pharos/schema';
import { openDatabase } from './database.js';
import { PharosError } from './errors.js';
import { Store } from './store.js';

const agent: Author = { kind: 'agent', name: 'spec-test-agent' };
const owner: Author = { kind: 'human', name: 'owner' };
const saveDate = '2026-10-11';
const fixedTime = () => `${saveDate}T12:00:00.000Z`;

let store: Store;
let database: ReturnType<typeof openDatabase>;
beforeEach(() => {
  database = openDatabase(':memory:');
  store = new Store(database, fixedTime);
});
afterEach(() => database.close());

function save(author: Author, message: string, ...operations: Operation[]) {
  return store.apply(author, { message, operations });
}

function errorOf(action: () => unknown): PharosError {
  try {
    action();
  } catch (error) {
    if (error instanceof PharosError) return error;
    throw error;
  }
  throw new Error('Expected the store to reject this change');
}

function seedProject() {
  const { created } = save(agent, 'Create project', {
    op: 'create',
    type: 'project',
    ref: 'project',
    data: { name: 'Map' },
  });
  const projectId = created.project!;
  save(agent, 'Rename certainty choices', {
    op: 'update',
    type: 'project',
    id: projectId,
    data: {
      options: {
        'claim.certainty': [
          { value: 'owner_ok', label: 'Owner settled', meaning: 'confirmed' },
          { value: 'source_checked', label: 'Evidence checked', meaning: 'verified' },
          { value: 'analysis', label: 'Our analysis', meaning: 'reading' },
        ],
        'decision.status': [
          { value: 'pending', label: 'Pending', meaning: 'proposed' },
          { value: 'owner_approved', label: 'Accepted', meaning: 'accepted' },
          { value: 'declined', label: 'Rejected', meaning: 'rejected' },
          { value: 'replaced', label: 'Superseded', meaning: 'superseded' },
        ],
      },
    },
  });
  const { created: sources } = save(
    agent,
    'Add sources',
    {
      op: 'create',
      type: 'artifact',
      ref: 'http',
      data: { projectId, title: 'HTTP report', uri: 'http://example.test/report' },
    },
    {
      op: 'create',
      type: 'artifact',
      ref: 'https',
      data: { projectId, title: 'HTTPS report', uri: 'https://example.test/report' },
    },
    {
      op: 'create',
      type: 'artifact',
      ref: 'file',
      data: { projectId, title: 'Local notes', uri: 'file:///notes/report.md' },
    },
    {
      op: 'create',
      type: 'artifact',
      ref: 'ftp',
      data: { projectId, title: 'FTP notes', uri: 'ftp://example.test/report' },
    },
  );
  return {
    projectId,
    httpId: sources.http!,
    httpsId: sources.https!,
    fileId: sources.file!,
    ftpId: sources.ftp!,
  };
}

function claim(projectId: string, data: Record<string, unknown> = {}, ref = 'claim'): Operation {
  return {
    op: 'create',
    type: 'claim',
    ref,
    data: {
      projectId,
      statement: 'A finding tied to the map.',
      checkedOn: saveDate,
      ...data,
    },
  };
}

function decision(projectId: string, status = 'pending'): Operation {
  return {
    op: 'create',
    type: 'decision',
    ref: 'decision',
    data: { projectId, title: 'Keep the format', status },
  };
}

describe('certainty requirements from slice-1 §3', () => {
  it('uses the project meaning for renamed certainty values and allows a reading without a source', () => {
    const { projectId } = seedProject();
    const { created } = save(agent, 'Save a reading', claim(projectId));
    expect(store.getOfType('claim', created.claim!).data).toMatchObject({
      certainty: 'analysis',
      sourceIds: [],
      checkedOn: saveDate,
    });
  });

  it('requires an HTTP or HTTPS source for a renamed From-source meaning', () => {
    const { projectId, httpId, httpsId, fileId, ftpId } = seedProject();
    const missing = errorOf(() =>
      save(agent, 'No source', claim(projectId, { certainty: 'source_checked' })),
    );
    expect(missing.issues.join('\n')).toContain('"Evidence checked" needs sourceIds');

    for (const sourceId of [fileId, ftpId]) {
      const invalidUri = errorOf(() =>
        save(
          agent,
          'Non-web source',
          claim(projectId, { certainty: 'source_checked', sourceIds: [sourceId] }),
        ),
      );
      expect(invalidUri.issues.join('\n')).toContain('http:// or https://');
    }

    for (const sourceId of [httpId, httpsId]) {
      const { created } = save(
        agent,
        'Save sourced finding',
        claim(
          projectId,
          { certainty: 'source_checked', sourceIds: [sourceId] },
          `claim_${sourceId}`,
        ),
      );
      expect(store.getOfType('claim', created[`claim_${sourceId}`]!).data.certainty).toBe(
        'source_checked',
      );
    }
    const { created } = save(
      agent,
      'Save with one working link',
      claim(projectId, { certainty: 'source_checked', sourceIds: [fileId, httpId] }, 'mixed'),
    );
    expect(store.getOfType('claim', created.mixed!).data.sourceIds).toEqual([fileId, httpId]);
  });

  it('does not accept a checked date after the save date for From source', () => {
    const { projectId, httpsId } = seedProject();
    const future = errorOf(() =>
      save(
        agent,
        'Future check date',
        claim(projectId, {
          certainty: 'source_checked',
          sourceIds: [httpsId],
          checkedOn: '2026-10-12',
        }),
      ),
    );
    expect(future.issues.join('\n')).toContain('checkedOn no later than today (2026-10-11)');

    const { created } = save(
      agent,
      'Same-day source check',
      claim(projectId, { certainty: 'source_checked', sourceIds: [httpsId] }),
      claim(
        projectId,
        {
          certainty: 'source_checked',
          sourceIds: [httpsId],
          checkedOn: '2026-10-10',
        },
        'older',
      ),
    );
    expect(created.claim).toBeDefined();
    expect(created.older).toBeDefined();

    const reading = save(
      agent,
      'A reading may have a future check date',
      claim(projectId, { checkedOn: '2026-10-12' }),
    );
    expect(store.getOfType('claim', reading.created.claim!).data.checkedOn).toBe('2026-10-12');
  });

  it('rechecks a From-source claim when its last usable source is removed or changed', () => {
    const { projectId, httpsId } = seedProject();
    const { created } = save(
      agent,
      'Save sourced finding',
      claim(projectId, { certainty: 'source_checked', sourceIds: [httpsId] }),
    );
    const claimId = created.claim!;

    expect(
      errorOf(() =>
        save(agent, 'Remove source', { op: 'delete', type: 'artifact', id: httpsId }),
      ).issues.join('\n'),
    ).toContain(`claim ${claimId}`);
    expect(store.get(httpsId)).not.toBeNull();

    expect(
      errorOf(() =>
        save(agent, 'Replace link with a local path', {
          op: 'update',
          type: 'artifact',
          id: httpsId,
          data: { uri: '/reports/source.md' },
        }),
      ).issues.join('\n'),
    ).toContain(`claim ${claimId}`);
    expect(store.getOfType('artifact', httpsId).data.uri).toBe('https://example.test/report');

    save(
      agent,
      'Retire source and mark as reading',
      { op: 'delete', type: 'artifact', id: httpsId },
      { op: 'update', type: 'claim', id: claimId, data: { certainty: 'analysis' } },
    );
    expect(store.getOfType('claim', claimId).data).toMatchObject({
      certainty: 'analysis',
      sourceIds: [],
    });
  });

  it('refuses to remove a confirmed decision until the same call lowers the claim certainty', () => {
    const { projectId } = seedProject();
    const { created: newDecision } = save(agent, 'Create proposed decision', decision(projectId));
    const decisionId = newDecision.decision!;
    save(owner, 'Owner accepts', {
      op: 'update',
      type: 'decision',
      id: decisionId,
      data: { status: 'owner_approved' },
    });
    const { created: newClaim } = save(
      agent,
      'Save confirmed finding',
      claim(projectId, { certainty: 'owner_ok', confirmedById: decisionId }),
    );
    const claimId = newClaim.claim!;

    expect(
      errorOf(() =>
        save(agent, 'Remove relied-on decision', {
          op: 'delete',
          type: 'decision',
          id: decisionId,
        }),
      ).issues.join('\n'),
    ).toContain(`claim ${claimId}`);
    expect(store.get(decisionId)).not.toBeNull();

    save(
      agent,
      'Remove decision and lower certainty',
      { op: 'delete', type: 'decision', id: decisionId },
      { op: 'update', type: 'claim', id: claimId, data: { certainty: 'analysis' } },
    );
    expect(store.get(decisionId)).toBeNull();
    expect(store.getOfType('claim', claimId).data.certainty).toBe('analysis');
    expect(store.getOfType('claim', claimId).data.confirmedById).toBeUndefined();
  });

  it('requires a decision accepted by a person, based on the latest status change', () => {
    const { projectId } = seedProject();
    const created = save(agent, 'Create proposed decision', decision(projectId));
    const decisionId = created.created.decision!;
    save(owner, 'Owner accepts', {
      op: 'update',
      type: 'decision',
      id: decisionId,
      data: { status: 'owner_approved' },
    });
    // A later edit that does not change the status does not replace its human author.
    save(agent, 'Add decision context', {
      op: 'update',
      type: 'decision',
      id: decisionId,
      data: { body: 'Context for the decision.' },
    });
    const { created: confirmed } = save(
      agent,
      'Save confirmed finding',
      claim(projectId, { certainty: 'owner_ok', confirmedById: decisionId }),
    );
    const claimId = confirmed.claim!;
    expect(store.getOfType('claim', claimId).data.certainty).toBe('owner_ok');

    const reject = errorOf(() =>
      save(agent, 'Reject a relied-on decision', {
        op: 'update',
        type: 'decision',
        id: decisionId,
        data: { status: 'declined' },
      }),
    );
    expect(reject.issues.join('\n')).toContain(`claim ${claimId}`);
    expect(store.getOfType('decision', decisionId).data.status).toBe('owner_approved');
  });

  it('rejects an agent acceptance, including a decision created already accepted', () => {
    const { projectId } = seedProject();
    const { created } = save(agent, 'Create proposed decision', decision(projectId));
    const decisionId = created.decision!;
    save(agent, 'Agent accepts', {
      op: 'update',
      type: 'decision',
      id: decisionId,
      data: { status: 'owner_approved' },
    });
    expect(
      errorOf(() =>
        save(
          agent,
          'Use agent acceptance',
          claim(projectId, { certainty: 'owner_ok', confirmedById: decisionId }),
        ),
      ).issues.join('\n'),
    ).toContain('not set by a person');

    const direct = save(agent, 'Create accepted decision', decision(projectId, 'owner_approved'));
    expect(
      errorOf(() =>
        save(
          agent,
          'Use agent-created acceptance',
          claim(projectId, {
            certainty: 'owner_ok',
            confirmedById: direct.created.decision,
          }),
        ),
      ).issues.join('\n'),
    ).toContain('not set by a person');
  });

  it('uses the author of the latest status change, not a later unrelated person edit', () => {
    const { projectId } = seedProject();
    const { created } = save(agent, 'Create proposed decision', decision(projectId));
    const decisionId = created.decision!;
    save(owner, 'Owner accepts', {
      op: 'update',
      type: 'decision',
      id: decisionId,
      data: { status: 'owner_approved' },
    });
    save(owner, 'Owner reopens', {
      op: 'update',
      type: 'decision',
      id: decisionId,
      data: { status: 'pending' },
    });
    save(agent, 'Agent accepts again', {
      op: 'update',
      type: 'decision',
      id: decisionId,
      data: { status: 'owner_approved' },
    });
    save(owner, 'Owner adds context', {
      op: 'update',
      type: 'decision',
      id: decisionId,
      data: { body: 'The owner agrees with the current reasoning.' },
    });

    const refusal = errorOf(() =>
      save(
        agent,
        'Use latest agent acceptance',
        claim(projectId, { certainty: 'owner_ok', confirmedById: decisionId }),
      ),
    );
    expect(refusal.issues.join('\n')).toContain('not set by a person');
  });

  it('validates a revert against the author of the status change it restores', () => {
    const { projectId } = seedProject();
    const { created } = save(agent, 'Create proposed decision', decision(projectId));
    const decisionId = created.decision!;
    const accepted = save(owner, 'Owner accepts', {
      op: 'update',
      type: 'decision',
      id: decisionId,
      data: { status: 'owner_approved' },
    });
    const confirmed = save(
      agent,
      'Save confirmed finding',
      claim(projectId, { certainty: 'owner_ok', confirmedById: decisionId }),
    );

    const retire = save(
      owner,
      'Settle and explain the finding',
      { op: 'update', type: 'decision', id: decisionId, data: { status: 'declined' } },
      {
        op: 'update',
        type: 'claim',
        id: confirmed.created.claim!,
        data: { certainty: 'analysis' },
      },
    );
    const refusal = errorOf(() => store.revert(retire.revision!.id, agent));
    expect(refusal.issues.join('\n')).toContain(`claim ${confirmed.created.claim}`);
    expect(store.getOfType('decision', decisionId).data.status).toBe('declined');
    expect(store.getOfType('claim', confirmed.created.claim!).data.certainty).toBe('analysis');

    // A person can restore the same state because the restored acceptance is theirs.
    const restored = store.revert(retire.revision!.id, owner);
    expect(store.getOfType('decision', decisionId).data.status).toBe('owner_approved');
    expect(store.getOfType('claim', confirmed.created.claim!).data.certainty).toBe('owner_ok');
    expect(restored.revision).toMatchObject({ revertOf: retire.revision!.id, author: owner });
    expect(store.getOfType('decision', decisionId).updatedRev).toBe(restored.revision!.id);
    expect(
      store.history({ entityId: decisionId }).some(({ id }) => id === accepted.revision!.id),
    ).toBe(true);
  });
});

describe('claim history and revert', () => {
  it('records claim edits in history and restores them through a revert revision', () => {
    const { projectId, httpsId } = seedProject();
    const created = save(
      agent,
      'Add sourced finding',
      claim(projectId, { certainty: 'source_checked', sourceIds: [httpsId] }),
    );
    const claimId = created.created.claim!;
    const edit = save(agent, 'Clarify finding', {
      op: 'update',
      type: 'claim',
      id: claimId,
      data: { statement: 'A clearer finding tied to the map.' },
    });

    expect(store.history({ entityId: claimId }).map(({ message }) => message)).toEqual([
      'Clarify finding',
      'Add sourced finding',
    ]);
    expect(store.history({ entityId: claimId })[0]!.changes[0]).toMatchObject({
      type: 'claim',
      label: 'A clearer finding tied to the map.',
    });

    const reverted = store.revert(edit.revision!.id, owner);
    expect(store.getOfType('claim', claimId).data.statement).toBe('A finding tied to the map.');
    expect(reverted.revision).toMatchObject({ revertOf: edit.revision!.id, author: owner });
    expect(store.revision(edit.revision!.id)!.revertedBy).toBe(reverted.revision!.id);

    store.revert(created.revision!.id, owner);
    expect(store.get(claimId)).toBeNull();
  });

  it('revalidates a restored From-source claim if its source became a non-web URI', () => {
    const { projectId, httpsId } = seedProject();
    const { created } = save(
      agent,
      'Add sourced finding',
      claim(projectId, { certainty: 'source_checked', sourceIds: [httpsId] }),
    );
    const claimId = created.claim!;
    const lowered = save(agent, 'Lower certainty', {
      op: 'update',
      type: 'claim',
      id: claimId,
      data: { certainty: 'analysis' },
    });
    save(agent, 'Change source to a local path', {
      op: 'update',
      type: 'artifact',
      id: httpsId,
      data: { uri: '/reports/source.md' },
    });

    const refusal = errorOf(() => store.revert(lowered.revision!.id, owner));
    expect(refusal.issues.join('\n')).toContain(`claim ${claimId}`);
    expect(store.getOfType('claim', claimId).data.certainty).toBe('analysis');

    save(agent, 'Restore source link', {
      op: 'update',
      type: 'artifact',
      id: httpsId,
      data: { uri: 'https://example.test/report' },
    });
    store.revert(lowered.revision!.id, owner);
    expect(store.getOfType('claim', claimId).data.certainty).toBe('source_checked');
  });
});

describe('term names in a project', () => {
  it('keeps words and alternate forms unique without blocking another project', () => {
    const { projectId } = seedProject();
    const term = (word: string, alsoCalled: string[] = [], project = projectId): Operation => ({
      op: 'create',
      type: 'term',
      data: { projectId: project, word, explanation: 'A short explanation.', alsoCalled },
    });
    save(agent, 'Add term', term('recipe', ['recipes']));

    expect(
      errorOf(() => save(agent, 'Duplicate word', term('Recipe'))).issues.join('\n'),
    ).toContain('"recipe" is already used');
    expect(
      errorOf(() =>
        save(agent, 'Duplicate alternate form', term('format', ['RECIPES'])),
      ).issues.join('\n'),
    ).toContain('"recipes" is already used');

    const { created } = save(agent, 'Create another project', {
      op: 'create',
      type: 'project',
      ref: 'other',
      data: { name: 'Another map' },
    });
    expect(
      save(agent, 'Reuse word elsewhere', term('recipe', [], created.other!)).revision,
    ).not.toBeNull();
  });
});
