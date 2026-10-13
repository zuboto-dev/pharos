import { describe, expect, it } from 'vitest';
import {
  ActionDef,
  ActionSubmission,
  actionForm,
  fieldError,
  submissionErrors,
  submissionFingerprint,
} from './actions.js';
import { PACKS, PACK_GUIDE, CAR_PACK, MONEY_PACK } from './packs/index.js';
import { COMPONENT_INFO } from './views/catalog-info.js';
import { CATALOG } from './views/catalog.js';

const carProject = { data: { recordTypes: CAR_PACK.recordTypes } };
const moneyProject = { data: { recordTypes: MONEY_PACK.recordTypes } };

describe('action examples validate (R10.14)', () => {
  it('every pack action makes a form from its own record types', () => {
    const found: string[] = [];
    for (const pack of PACKS)
      for (const view of pack.views)
        for (const w of view.widgets) {
          if (w.node.component !== 'Action') continue;
          found.push(`${pack.key}/${w.id}`);
          const { form, problems } = actionForm(w.node, {
            data: { recordTypes: pack.recordTypes },
          });
          expect(problems, `${pack.key}/${w.id}`).toEqual([]);
          expect(form!.fields.length).toBeGreaterThan(1);
          // A DueTracker's action names a done Action on the same page.
          for (const other of view.widgets)
            if (other.node.component === 'DueTracker' && other.node.action === w.id)
              expect(w.node.does).toBe('done');
        }
    expect(found).toEqual([
      'car/log-service',
      'money/mark-paid',
      'music/log-mix',
      'music/log-session',
      'study/log-session',
      'company/mark-renewed',
    ]);
  });

  it('the catalog example works on a Car project, and the pack guide shows each action', () => {
    const example = COMPONENT_INFO.Action.example;
    expect(CATALOG.Action.safeParse(example).success).toBe(true);
    expect(actionForm(example as ActionDef, carProject).problems).toEqual([]);
    expect(PACK_GUIDE).toMatch(/Action on "What's due": \{"id":"log-service"/);
    expect(PACK_GUIDE).toMatch(/Action on "This month": \{"id":"mark-paid"/);
  });
});

describe('the form (R10.12)', () => {
  it('Log a service asks for a title and the chosen fields, in order, with kinds and options', () => {
    const def = CAR_PACK.views[0]!.widgets.find((w) => w.id === 'log-service')!.node as ActionDef;
    const { form } = actionForm(def, carProject);
    expect(form!.fields.map((f) => `${f.key}:${f.kind}${f.required ? '*' : ''}`)).toEqual([
      'title:text',
      'vehicle:reference*',
      'date:date*',
      'kind:option',
      'odometer:meter',
      'cost:money',
      'shop:text',
    ]);
    expect(form!.fields.find((f) => f.key === 'odometer')!.unit).toBe('km');
    expect(form!.fields.find((f) => f.key === 'cost')!.currency).toBe('EUR');
  });

  it('Mark paid picks the bill, the date and the amount (filled from the bill)', () => {
    const def = MONEY_PACK.views[0]!.widgets.find((w) => w.id === 'mark-paid')!.node as ActionDef;
    const { form } = actionForm(def, moneyProject);
    expect(form!.kind).toBe('done');
    expect(form!.fields.map((f) => `${f.key}:${f.kind}${f.required ? '*' : ''}`)).toEqual([
      'recordId:record*',
      'date:date*',
      'amount:money',
    ]);
  });

  it('says plainly what is wrong with an action the project cannot use', () => {
    const problems = (def: Record<string, unknown>) =>
      actionForm(ActionDef.parse({ label: 'Do it', ...def }), carProject).problems;
    expect(problems({ recordType: 'trip' })[0]).toMatch(
      /"trip" isn't a record type here \(vehicle/,
    );
    expect(problems({ recordType: 'service', fields: ['date', 'mileage'] })).toEqual([
      expect.stringMatching(/"mileage" isn't a field of Service/),
      expect.stringMatching(/leaves out "vehicle", which Service requires/),
    ]);
    expect(problems({ recordType: 'service', does: 'done' })[0]).toMatch(/don't repeat/);
    expect(
      problems({ recordType: 'service', roll: { recordType: 'vehicle', match: ['vehicle'] } }),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/"vehicle" doesn't repeat/)]));
    expect(
      problems({
        recordType: 'reminder',
        does: 'done',
        log: { recordType: 'fuel', fields: { date: 'today' } },
      }),
    ).toEqual([
      expect.stringMatching(/use "\$date", "\$title" or "fields\.<key>"/),
      expect.stringMatching(/leaves out "vehicle", which Fuel requires/),
    ]);
  });
});

describe('field checks (R10.4)', () => {
  const field = (kind: string, more = {}) =>
    ({ key: 'x', label: 'X', kind, required: false, ...more }) as Parameters<typeof fieldError>[0];

  it('each kind accepts what fits it and names what does not', () => {
    expect(fieldError(field('money'), { amount: 1250, currency: 'EUR' })).toBeUndefined();
    expect(fieldError(field('money'), { amount: 12.5, currency: 'EUR' })).toMatch(/amount/);
    expect(fieldError(field('money'), { amount: -1, currency: 'EUR' })).toMatch(/negative/);
    expect(fieldError(field('date'), '2026-02-29')).toMatch(/date/);
    expect(fieldError(field('date'), '2028-02-29')).toBeUndefined();
    expect(fieldError(field('meter'), -3)).toMatch(/negative/);
    expect(fieldError(field('number'), '3')).toMatch(/number/);
    expect(
      fieldError(field('option', { options: [{ value: 'oil', label: 'Oil' }] }), 'gas'),
    ).toMatch(/pick one of Oil/);
    expect(fieldError(field('text', { required: true }), '')).toBe('X is required');
    expect(fieldError(field('text'), undefined)).toBeUndefined();
  });

  it('references must be records of the right type in the same project', () => {
    const def = CAR_PACK.views[0]!.widgets.find((w) => w.id === 'log-service')!.node as ActionDef;
    const { form } = actionForm(def, carProject);
    const entities: Record<string, unknown> = {
      rec_car: { id: 'rec_car', type: 'record', data: { projectId: 'p1', recordType: 'vehicle' } },
      rec_svc: { id: 'rec_svc', type: 'record', data: { projectId: 'p1', recordType: 'service' } },
      rec_far: { id: 'rec_far', type: 'record', data: { projectId: 'p2', recordType: 'vehicle' } },
    };
    const lookup = (id: string) => entities[id] as never;
    const errors = (vehicle: string) =>
      submissionErrors(form!, { projectId: 'p1', values: { vehicle, date: '2026-10-13' } }, lookup);
    expect(errors('rec_car')).toEqual({});
    expect(errors('rec_svc').vehicle).toMatch(/pick a vehicle record/);
    expect(errors('rec_far').vehicle).toMatch(/isn't in this project/);
    expect(errors('rec_none').vehicle).toMatch(/isn't in this project/);
  });
});

describe('the submission (R10.3)', () => {
  const submission = {
    v: 1,
    projectId: 'p1',
    viewId: 'view_1',
    widgetId: 'mark-paid',
    recordId: 'rec_rent',
    values: { date: '2026-10-13' },
    idempotencyKey: 'form-1234',
    expectedRevision: 7,
  };

  it('is versioned and strict', () => {
    expect(ActionSubmission.safeParse(submission).success).toBe(true);
    expect(ActionSubmission.safeParse({ ...submission, v: 2 }).success).toBe(false);
    expect(ActionSubmission.safeParse({ ...submission, author: 'human:me' }).success).toBe(false);
    expect(ActionSubmission.safeParse({ ...submission, idempotencyKey: 'x' }).success).toBe(false);
  });

  it('fingerprints ignore the key and key order, so a retry matches and a change does not', () => {
    const a = ActionSubmission.parse(submission);
    const b = ActionSubmission.parse({
      ...submission,
      idempotencyKey: 'other-key',
      values: { date: '2026-10-13' },
    });
    expect(submissionFingerprint(a)).toBe(submissionFingerprint(b));
    const c = ActionSubmission.parse({ ...submission, values: { date: '2026-10-14' } });
    expect(submissionFingerprint(c)).not.toBe(submissionFingerprint(a));
  });
});
