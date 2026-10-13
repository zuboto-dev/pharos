import { describe, expect, it } from 'vitest';
import { ENTITIES, ENTITY_TYPES } from '../entities.js';
import { CAR_PACK, MONEY_PACK, packDataset } from '../packs/index.js';
import { recordFieldIssues, recordTypeIssues } from '../records.js';
import { formatTotal, sumRows } from './blocks.js';
import { addMonths, relativeDate } from './dates.js';
import { computeDue } from './due.js';
import { entityFields, recordFields, resolvePath } from './fields.js';
import { fieldReader, runQuery } from './run-query.js';

const TODAY = '2026-10-13';
const car = packDataset(
  CAR_PACK,
  [
    { ref: 'car', recordType: 'vehicle', title: 'Hatch', fields: { odometer: 61850 } },
    {
      ref: 's1',
      recordType: 'service',
      title: 'Oil',
      fields: {
        vehicle: '$car',
        date: '2026-03-01',
        kind: 'oil',
        cost: { amount: 14900, currency: 'EUR' },
      },
    },
    {
      ref: 's2',
      recordType: 'service',
      title: 'Brakes',
      fields: {
        vehicle: '$car',
        date: '2026-09-20',
        kind: 'brakes',
        cost: { amount: 28500, currency: 'EUR' },
      },
    },
    {
      ref: 'r1',
      recordType: 'reminder',
      title: 'Oil change',
      fields: { vehicle: '$car', kind: 'oil' },
      interval: {
        every: { n: 12, unit: 'months' },
        meter: { n: 10000, from: 'fields.vehicle.fields.odometer' },
        lastDate: '2026-03-01',
        lastMeter: 52400,
      },
    },
  ],
  TODAY,
);

describe('dates', () => {
  it('reads relative dates, months and years included', () => {
    expect(relativeDate('$today', TODAY)).toBe('2026-10-13');
    expect(relativeDate('$today+7d', TODAY)).toBe('2026-10-20');
    expect(relativeDate('$today-2w', TODAY)).toBe('2026-09-29');
    expect(relativeDate('$monthStart', TODAY)).toBe('2026-10-01');
    expect(relativeDate('$monthStart+1m', TODAY)).toBe('2026-11-01');
    expect(relativeDate('$yearStart-1y', TODAY)).toBe('2025-01-01');
    expect(relativeDate('$today+7x', TODAY)).toBeUndefined();
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  });
});

describe('intervals', () => {
  it('give the next date and reading, whichever first deciding the band', () => {
    const interval = {
      every: { n: 12, unit: 'months' as const },
      meter: { n: 10000, from: 'x' },
      lastDate: '2026-03-01',
      lastMeter: 52400,
    };
    expect(computeDue(interval, TODAY, 61850)).toEqual({
      date: '2027-03-01',
      days: 139,
      meter: 62400,
      reading: 61850,
      left: 550,
      band: 'urgent',
    });
    expect(computeDue(interval, TODAY, 62500)!.band).toBe('past_due');
    expect(computeDue(interval, '2027-02-25', 50000)!.band).toBe('very_urgent');
    expect(computeDue({ every: { n: 1, unit: 'years' } }, TODAY, undefined)).toBeUndefined();
  });

  it('keep a fixed schedule from its start', () => {
    const fixed = {
      every: { n: 1, unit: 'years' as const },
      mode: 'fixed' as const,
      startDate: '2024-10-18',
      lastDate: '2025-10-25',
    };
    expect(computeDue(fixed, TODAY, undefined)!.date).toBe('2026-10-18');
    // Rolling counts from when it was done instead.
    expect(computeDue({ ...fixed, mode: 'rolling' }, TODAY, undefined)!.date).toBe('2026-10-25');
  });
});

describe('record queries', () => {
  it('filter and sort by record fields, money amounts and due', () => {
    const services = runQuery(car, 'record', {
      where: { recordType: 'service', 'fields.cost.amount': { gt: 20000 } },
    });
    expect(services.map((r) => r.data.title)).toEqual(['Brakes']);
    const sorted = runQuery(car, 'record', {
      where: { recordType: 'service' },
      sort: [{ field: 'fields.cost', dir: 'desc' }],
    });
    expect(sorted.map((r) => r.data.title)).toEqual(['Brakes', 'Oil']);
    const thisMonth = runQuery(
      car,
      'record',
      { where: { recordType: 'service', 'fields.date': { gte: '$monthStart-1m' } } },
      { today: TODAY },
    );
    expect(thisMonth.map((r) => r.data.title)).toEqual(['Brakes']);
    expect(
      runQuery(car, 'record', { where: { 'due.band': ['urgent', 'past_due'] } }, { today: TODAY })
        .length,
    ).toBe(1);
    // Bands rank by urgency, not by name.
    expect(
      runQuery(car, 'record', { where: { 'due.band': { gte: 'urgent' } } }, { today: TODAY })
        .length,
    ).toBe(1);
    // Record option fields rank in their option order.
    expect(
      runQuery(car, 'record', {
        where: { recordType: 'service', 'fields.kind': { gt: 'oil' } },
      }).map((r) => r.data.title),
    ).toEqual(['Brakes']);
  });

  it('follow one reference to another record', () => {
    const read = fieldReader(car, { today: TODAY });
    const oil = car.records!.find((r) => r.data.title === 'Oil')!;
    expect(read(oil, 'fields.vehicle.title').value).toBe('Hatch');
    expect(read(oil, 'fields.vehicle.fields.odometer').value).toBe(61850);
    expect(read(oil, 'fields.cost.currency').value).toBe('EUR');
  });

  it('sum money per currency and numbers with their unit', () => {
    const rows = runQuery(car, 'record', { where: { recordType: 'service' } });
    expect(sumRows(car, rows, 'fields.cost')).toEqual({
      kind: 'money',
      amounts: [{ amount: 43400, currency: 'EUR' }],
    });
    const vehicles = runQuery(car, 'record', { where: { recordType: 'vehicle' } });
    expect(formatTotal(sumRows(car, vehicles, 'fields.odometer'))).toBe('61,850 km');
    expect(
      formatTotal({
        kind: 'money',
        amounts: [
          { amount: 120000, currency: 'EUR' },
          { amount: 30000, currency: 'USD' },
          { amount: 15000, currency: 'KRW' },
        ],
      }),
    ).toBe('€1,200.00 · $300.00 · ₩15,000');
  });
});

describe('field metadata', () => {
  it('covers every field of every entity type', () => {
    for (const type of ENTITY_TYPES) {
      const fields = entityFields(type);
      for (const field of Object.keys(ENTITIES[type].data.shape))
        expect(fields[field], `${type}.${field}`).toBeDefined();
    }
    expect(entityFields('task')).toMatchObject({
      status: { kind: 'option', optionKey: 'task.status' },
      dueDate: { kind: 'date' },
      dependsOn: { kind: 'reference', to: 'task', many: true },
      title: { kind: 'text', unique: true },
      estimate: { kind: 'text' },
    });
    expect(entityFields('file').size).toEqual({ kind: 'number' });
    expect(entityFields('view').archived).toEqual({ kind: 'boolean' });
  });

  it("lists a pack's record types with their kinds, options and references", () => {
    const service = CAR_PACK.recordTypes.find((t) => t.key === 'service')!;
    expect(recordFields(service)).toMatchObject({
      'fields.vehicle': { kind: 'reference', toRecord: 'vehicle' },
      'fields.odometer': { kind: 'meter', unit: 'km' },
      'fields.cost': { kind: 'money', currency: 'EUR' },
      'fields.kind': { kind: 'option', options: expect.arrayContaining(['oil', 'brakes']) },
      'fields.date': { kind: 'date' },
    });
    const bill = MONEY_PACK.recordTypes.find((t) => t.key === 'bill')!;
    expect(recordFields(bill)['due.band']).toMatchObject({ kind: 'option' });
    const project = car.project;
    expect(
      resolvePath(
        project,
        { type: 'record', recordType: service },
        'fields.vehicle.fields.odometer',
      ),
    ).toMatchObject({
      ok: true,
      info: { kind: 'meter' },
    });
    expect(resolvePath(project, { type: 'task' }, 'stage.status')).toMatchObject({
      ok: true,
      info: { kind: 'option', optionKey: 'stage.status' },
    });
  });
});

describe('record checks', () => {
  const service = CAR_PACK.recordTypes.find((t) => t.key === 'service')!;
  it('refuse fields that are unknown, of the wrong kind or missing', () => {
    expect(recordFieldIssues(service, { vehicle: 'rec_1', date: '2026-01-01' }, false)).toEqual([]);
    expect(
      recordFieldIssues(service, { date: 'soon', cost: 12, kind: 'wash', mileage: 1 }, true),
    ).toEqual([
      'fields.date: expected YYYY-MM-DD',
      'fields.cost: expected {amount (minor units), currency}',
      'fields.kind: "wash" isn\'t one of oil, tyres, brakes, inspection, repair, papers, other',
      "fields.mileage isn't a field of Service (fields: vehicle, date, odometer, kind, cost, shop)",
      'fields.vehicle is required for Service',
      "Service records don't repeat; set interval: true on the record type first",
    ]);
    expect(recordTypeIssues([...CAR_PACK.recordTypes, service])).toEqual([
      'record type "service" is defined twice',
    ]);
  });
});
