// The made-up project the report-document eval asks an agent to write about: one season of a
// community garden (harvests by plot and crop, money spent, the season's tasks and stages). Every
// name and number is fictional. One /api/apply body; refs: "project".

export const PROJECT_NAME = 'Willow Lane community garden (made-up)';

const HARVEST = {
  key: 'harvest',
  name: 'Harvest',
  plural: 'Harvests',
  fields: [
    { key: 'date', label: 'Date', kind: 'date', required: true },
    { key: 'crop', label: 'Crop', kind: 'text', required: true },
    { key: 'plot', label: 'Plot', kind: 'text' },
    { key: 'kg', label: 'Weight (kg)', kind: 'number', required: true },
  ],
};

const EXPENSE = {
  key: 'expense',
  name: 'Expense',
  plural: 'Expenses',
  fields: [
    { key: 'date', label: 'Date', kind: 'date', required: true },
    { key: 'amount', label: 'Amount', kind: 'money', currency: 'EUR', required: true },
    { key: 'category', label: 'Category', kind: 'text' },
    { key: 'paid_to', label: 'Paid to', kind: 'text' },
  ],
};

// [date, crop, plot, kg]
const HARVESTS = [
  ['2026-06-14', 'Lettuce', 'North beds', 4.2],
  ['2026-06-21', 'Radish', 'North beds', 2.1],
  ['2026-06-28', 'Lettuce', 'North beds', 5.0],
  ['2026-07-05', 'Courgette', 'South beds', 6.4],
  ['2026-07-12', 'Beans', 'East row', 3.8],
  ['2026-07-19', 'Courgette', 'South beds', 9.1],
  ['2026-07-26', 'Tomato', 'Greenhouse', 7.5],
  ['2026-08-02', 'Tomato', 'Greenhouse', 12.3],
  ['2026-08-09', 'Beans', 'East row', 5.6],
  ['2026-08-16', 'Tomato', 'Greenhouse', 14.8],
  ['2026-08-23', 'Courgette', 'South beds', 8.2],
  ['2026-08-30', 'Potato', 'South beds', 18.5],
  ['2026-09-06', 'Tomato', 'Greenhouse', 10.4],
  ['2026-09-13', 'Potato', 'South beds', 21.0],
  ['2026-09-20', 'Squash', 'East row', 15.7],
  ['2026-09-27', 'Apple', 'Orchard', 22.4],
  ['2026-10-04', 'Squash', 'East row', 11.9],
  ['2026-10-11', 'Apple', 'Orchard', 17.6],
];

// [date, category, cents, paid_to]
const EXPENSES = [
  ['2026-03-10', 'Seeds', 8450, 'Green Thumb Seeds'],
  ['2026-03-24', 'Tools', 12900, 'Hardware Corner'],
  ['2026-04-07', 'Compost', 6000, 'Town compost depot'],
  ['2026-04-28', 'Water', 3100, 'Town water board'],
  ['2026-05-19', 'Repairs', 21500, 'Greenhouse Glass Co'],
  ['2026-06-23', 'Water', 4700, 'Town water board'],
  ['2026-07-21', 'Water', 5200, 'Town water board'],
  ['2026-08-18', 'Water', 4900, 'Town water board'],
  ['2026-09-08', 'Tools', 3400, 'Hardware Corner'],
];

export const RECORD_COUNT = HARVESTS.length + EXPENSES.length;

export const FIXTURE = {
  message: 'Load the made-up Willow Lane community garden season (report document eval)',
  operations: [
    {
      op: 'create',
      type: 'project',
      ref: 'project',
      data: {
        name: PROJECT_NAME,
        summary:
          'A made-up neighbourhood garden: twelve households share beds, a greenhouse and a small orchard. This is its 2026 season.',
        recordTypes: [HARVEST, EXPENSE],
      },
    },
    {
      op: 'create',
      type: 'stage',
      ref: 'spring',
      data: {
        projectId: '$project',
        name: 'Spring set-up',
        status: 'done',
        startDate: '2026-03-01',
        targetDate: '2026-05-31',
      },
    },
    {
      op: 'create',
      type: 'stage',
      ref: 'harvest',
      data: {
        projectId: '$project',
        name: 'Growing and harvest',
        status: 'active',
        startDate: '2026-06-01',
        targetDate: '2026-10-31',
      },
    },
    ...[
      ['spring', 'Order seeds for all beds', 'done'],
      ['spring', 'Repair greenhouse glass', 'done'],
      ['spring', 'Spread compost on the south beds', 'done'],
      ['harvest', 'Set up the watering rota', 'done'],
      ['harvest', 'Weekly harvest share-out', 'in_progress'],
      ['harvest', 'Fix the leaking water butt', 'blocked'],
      ['harvest', 'Plan winter cover crops', 'todo'],
      ['harvest', 'Apple pressing day', 'todo'],
    ].map(([stage, title, status]) => ({
      op: 'create',
      type: 'task',
      data: { projectId: '$project', stageId: `$${stage}`, title, status },
    })),
    ...HARVESTS.map(([date, crop, plot, kg]) => ({
      op: 'create',
      type: 'record',
      data: {
        projectId: '$project',
        recordType: 'harvest',
        title: `${crop}, ${plot} (${date})`,
        fields: { date, crop, plot, kg },
      },
    })),
    ...EXPENSES.map(([date, category, amount, paid_to]) => ({
      op: 'create',
      type: 'record',
      data: {
        projectId: '$project',
        recordType: 'expense',
        title: `${paid_to} (${category.toLowerCase()})`,
        fields: { date, amount: { amount, currency: 'EUR' }, category, paid_to },
      },
    })),
  ],
};
