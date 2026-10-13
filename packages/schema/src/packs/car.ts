import { defaultOptions } from '../options.js';
import type { Pack } from './pack.js';

const SERVICE_KINDS = [
  { value: 'oil', label: 'Oil', color: 'amber' },
  { value: 'tyres', label: 'Tyres', color: 'blue' },
  { value: 'brakes', label: 'Brakes', color: 'red' },
  { value: 'inspection', label: 'Inspection', color: 'violet' },
  { value: 'repair', label: 'Repair', color: 'neutral' },
  { value: 'papers', label: 'Papers', color: 'green' },
  { value: 'other', label: 'Other', color: 'muted' },
] as const;

const KM = { kind: 'meter', unit: 'km' } as const;
const EUR = { kind: 'money', currency: 'EUR' } as const;
const VEHICLE = { key: 'vehicle', label: 'Vehicle', kind: 'reference', to: 'vehicle' } as const;
const COSTS = { recordType: ['service', 'fuel'] };

/** The Car pack: services, fuel and what's due, by date or by kilometres, whichever first. */
export const CAR_PACK: Pack = {
  key: 'car',
  name: 'Car',
  description:
    "Services, fuel and what's due next, by date or by kilometres, whichever comes first.",
  summary: "Services, fuel and what's due for the car",
  guide:
    'Record types: vehicle (odometer in km: update it when you read the dashboard), service (a job done: date, odometer, kind, cost), fuel (a fill-up) and reminder (something that repeats: every N months and/or every N km, whichever first). When a service is done, add a service record and set the matching reminder\'s interval.lastDate and interval.lastMeter to that date and reading, and the vehicle\'s odometer if it is higher. Registration and insurance papers are files of kind "registration" or "insurance". Money is {amount in cents, currency}.',
  recordTypes: [
    {
      key: 'vehicle',
      name: 'Vehicle',
      fields: [
        { key: 'make', label: 'Make', kind: 'text' },
        { key: 'model', label: 'Model', kind: 'text' },
        { key: 'year', label: 'Year', kind: 'number' },
        { key: 'plate', label: 'Plate', kind: 'text' },
        { key: 'odometer', label: 'Odometer', ...KM },
      ],
    },
    {
      key: 'service',
      name: 'Service',
      plural: 'Services',
      fields: [
        { ...VEHICLE, required: true },
        { key: 'date', label: 'Date', kind: 'date', required: true },
        { key: 'odometer', label: 'Odometer', ...KM },
        {
          key: 'kind',
          label: 'Kind',
          kind: 'option',
          options: SERVICE_KINDS.map((o) => ({ ...o })),
        },
        { key: 'cost', label: 'Cost', ...EUR },
        { key: 'shop', label: 'Shop', kind: 'text' },
      ],
    },
    {
      key: 'fuel',
      name: 'Fuel',
      plural: 'Fuel',
      fields: [
        { ...VEHICLE, required: true },
        { key: 'date', label: 'Date', kind: 'date', required: true },
        { key: 'odometer', label: 'Odometer', ...KM },
        { key: 'litres', label: 'Litres', kind: 'number', unit: 'L' },
        { key: 'cost', label: 'Cost', ...EUR },
      ],
    },
    {
      key: 'reminder',
      name: 'Reminder',
      plural: 'Reminders',
      interval: true,
      fields: [
        { ...VEHICLE },
        {
          key: 'kind',
          label: 'Kind',
          kind: 'option',
          options: SERVICE_KINDS.map((o) => ({ ...o })),
        },
        { key: 'estimate', label: 'Estimate', ...EUR },
      ],
    },
  ],
  options: {
    'file.kind': [
      { value: 'registration', label: 'Registration', meaning: 'certificate', color: 'violet' },
      { value: 'insurance', label: 'Insurance', meaning: 'contract', color: 'blue' },
      ...defaultOptions('file.kind'),
    ],
  },
  views: [
    {
      name: "What's due",
      description: 'What the car needs next, what it cost, and its papers',
      widgets: [
        {
          id: 'headline',
          w: 8,
          node: {
            component: 'Text',
            content:
              '**${late}** past due and **${soon}** due soon. Running costs this year: **${cost}**.',
            values: {
              late: {
                count: {
                  type: 'record',
                  where: { recordType: 'reminder', 'due.band': 'past_due' },
                },
              },
              soon: {
                count: {
                  type: 'record',
                  where: { recordType: 'reminder', 'due.band': ['very_urgent', 'urgent'] },
                },
              },
              cost: {
                sum: {
                  query: {
                    type: 'record',
                    where: { ...COSTS, 'fields.date': { gte: '$yearStart' } },
                  },
                  field: 'fields.cost',
                },
              },
            },
          },
        },
        {
          id: 'log-service',
          w: 4,
          node: {
            component: 'Action',
            label: 'Log a service',
            description: 'Marks the matching reminder done and updates the odometer',
            recordType: 'service',
            fields: ['vehicle', 'date', 'kind', 'odometer', 'cost', 'shop'],
            roll: { recordType: 'reminder', match: ['vehicle', 'kind'], meter: 'odometer' },
            raise: { via: 'vehicle', field: 'odometer', from: 'odometer' },
          },
        },
        {
          id: 'due',
          w: 7,
          node: {
            component: 'DueTracker',
            title: "What's due",
            query: { type: 'record', where: { recordType: 'reminder' } },
            show: ['fields.estimate'],
          },
        },
        {
          id: 'per-year',
          w: 5,
          node: {
            component: 'CountChart',
            title: 'Cost per year',
            query: { type: 'record', where: { ...COSTS } },
            by: 'fields.date',
            bucket: 'year',
            sum: 'fields.cost',
          },
        },
        {
          id: 'log',
          node: {
            component: 'DataTable',
            title: 'Service log',
            query: {
              type: 'record',
              where: { recordType: 'service' },
              sort: [{ field: 'fields.date', dir: 'desc' }],
            },
            columns: [
              { field: 'title', label: 'Service' },
              { field: 'fields.date', label: 'Date' },
              { field: 'fields.kind', label: 'Kind' },
              { field: 'fields.odometer', label: 'Odometer' },
              { field: 'fields.shop', label: 'Shop' },
              { field: 'fields.cost', label: 'Cost' },
            ],
            total: true,
          },
        },
        {
          id: 'fuel',
          w: 7,
          node: {
            component: 'DataTable',
            title: 'Fuel',
            query: {
              type: 'record',
              where: { recordType: 'fuel' },
              sort: [{ field: 'fields.date', dir: 'desc' }],
              limit: 8,
            },
            columns: [
              { field: 'fields.date', label: 'Date' },
              { field: 'fields.odometer', label: 'Odometer' },
              { field: 'fields.litres', label: 'Litres' },
              { field: 'fields.cost', label: 'Cost' },
            ],
            total: true,
          },
        },
        {
          id: 'papers',
          w: 5,
          node: {
            component: 'FileList',
            title: 'Registration and insurance',
            filter: { where: { kind: ['registration', 'insurance'] } },
            groupBy: 'none',
            controls: [],
            details: ['issuer', 'expiryDate'],
          },
        },
      ],
    },
  ],
  examples: [
    {
      ref: 'car',
      recordType: 'vehicle',
      title: 'Blue hatchback',
      fields: {
        make: 'Example Motors',
        model: 'Hatch 1.2',
        year: 2019,
        plate: 'XX-000-XX',
        odometer: 61850,
      },
    },
    {
      ref: 's_inspection',
      recordType: 'service',
      title: 'Annual inspection',
      fields: {
        vehicle: '$car',
        date: '$today-400d',
        odometer: 48900,
        kind: 'inspection',
        cost: { amount: 9500, currency: 'EUR' },
        shop: 'Test Centre North',
      },
    },
    {
      ref: 's_oil',
      recordType: 'service',
      title: 'Oil and filter',
      fields: {
        vehicle: '$car',
        date: '$today-300d',
        odometer: 52400,
        kind: 'oil',
        cost: { amount: 14900, currency: 'EUR' },
        shop: 'Corner Garage',
      },
    },
    {
      ref: 's_brakes',
      recordType: 'service',
      title: 'Front brake pads',
      fields: {
        vehicle: '$car',
        date: '$today-200d',
        odometer: 55100,
        kind: 'brakes',
        cost: { amount: 28500, currency: 'EUR' },
        shop: 'Corner Garage',
      },
    },
    {
      ref: 's_tyres',
      recordType: 'service',
      title: 'Winter tyres fitted',
      fields: {
        vehicle: '$car',
        date: '$today-120d',
        odometer: 58300,
        kind: 'tyres',
        cost: { amount: 6000, currency: 'EUR' },
        shop: 'Tyre Hut',
      },
    },
    {
      ref: 'f1',
      recordType: 'fuel',
      title: 'Fill-up',
      fields: {
        vehicle: '$car',
        date: '$today-40d',
        odometer: 60200,
        litres: 42.5,
        cost: { amount: 7225, currency: 'EUR' },
      },
    },
    {
      ref: 'f2',
      recordType: 'fuel',
      title: 'Fill-up',
      fields: {
        vehicle: '$car',
        date: '$today-12d',
        odometer: 61400,
        litres: 40.1,
        cost: { amount: 6900, currency: 'EUR' },
      },
    },
    {
      ref: 'r_oil',
      recordType: 'reminder',
      title: 'Oil change',
      fields: { vehicle: '$car', kind: 'oil', estimate: { amount: 15000, currency: 'EUR' } },
      interval: {
        every: { n: 12, unit: 'months' },
        meter: { n: 10000, from: 'fields.vehicle.fields.odometer' },
        lastDate: '$today-300d',
        lastMeter: 52400,
      },
    },
    {
      ref: 'r_inspection',
      recordType: 'reminder',
      title: 'Annual inspection',
      fields: { vehicle: '$car', kind: 'inspection', estimate: { amount: 9500, currency: 'EUR' } },
      interval: { every: { n: 12, unit: 'months' }, lastDate: '$today-400d' },
    },
    {
      ref: 'r_brakes',
      recordType: 'reminder',
      title: 'Brake check',
      fields: { vehicle: '$car', kind: 'brakes' },
      interval: {
        meter: { n: 20000, from: 'fields.vehicle.fields.odometer' },
        lastMeter: 55100,
      },
    },
    {
      ref: 'r_insurance',
      recordType: 'reminder',
      title: 'Insurance renewal',
      fields: { vehicle: '$car', kind: 'papers', estimate: { amount: 42000, currency: 'EUR' } },
      interval: { every: { n: 1, unit: 'years' }, lastDate: '$today-360d' },
    },
    {
      ref: 'r_tyres',
      recordType: 'reminder',
      title: 'Summer tyres',
      fields: { vehicle: '$car', kind: 'tyres', estimate: { amount: 6000, currency: 'EUR' } },
      interval: { every: { n: 6, unit: 'months' }, lastDate: '$today-120d' },
    },
  ],
};
