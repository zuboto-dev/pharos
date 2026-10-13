import type { Pack } from './pack.js';

const THIS_MONTH = { gte: '$monthStart', lt: '$monthStart+1m' };
const eur = (amount: number) => ({ amount, currency: 'EUR' });

/** The Money pack: planned against spent by category, upcoming bills and a savings target. */
export const MONEY_PACK: Pack = {
  key: 'money',
  name: 'Money',
  description:
    'Planned against spent by category, upcoming bills and a savings target. Entered by hand or by an agent; no bank connection.',
  summary: 'What I planned, what I spent, and what is due',
  guide:
    'Record types: category (planned: the monthly plan), spending (date, amount, category), bill (repeats: every N months, amount) and goal (target and saved so far). Amounts are {amount in cents, currency}; never convert currencies, keep each spending in the currency it was paid in. When a bill is paid, set its interval.lastDate to the payment date and add a spending record. Bank statements are files of kind "statement".',
  recordTypes: [
    {
      key: 'category',
      name: 'Category',
      plural: 'Categories',
      fields: [
        {
          key: 'planned',
          label: 'Planned per month',
          kind: 'money',
          currency: 'EUR',
          required: true,
        },
      ],
    },
    {
      key: 'spending',
      name: 'Spending',
      plural: 'Spending',
      fields: [
        { key: 'date', label: 'Date', kind: 'date', required: true },
        { key: 'amount', label: 'Amount', kind: 'money', currency: 'EUR', required: true },
        { key: 'category', label: 'Category', kind: 'reference', to: 'category' },
        { key: 'payee', label: 'Paid to', kind: 'text' },
      ],
    },
    {
      key: 'bill',
      name: 'Bill',
      plural: 'Bills',
      interval: true,
      fields: [
        { key: 'amount', label: 'Amount', kind: 'money', currency: 'EUR' },
        { key: 'category', label: 'Category', kind: 'reference', to: 'category' },
        { key: 'payee', label: 'Paid to', kind: 'text' },
      ],
    },
    {
      key: 'goal',
      name: 'Goal',
      plural: 'Goals',
      fields: [
        { key: 'target', label: 'Target', kind: 'money', currency: 'EUR', required: true },
        { key: 'saved', label: 'Saved', kind: 'money', currency: 'EUR' },
        { key: 'by', label: 'By', kind: 'date' },
      ],
    },
  ],
  views: [
    {
      name: 'This month',
      description: 'Planned against spent by category, bills coming up and savings',
      widgets: [
        {
          id: 'headline',
          node: {
            component: 'Text',
            content:
              'Spent **${spent}** of **${planned}** planned this month. **${bills}** bills due within a month.',
            values: {
              spent: {
                sum: {
                  query: {
                    type: 'record',
                    where: { recordType: 'spending', 'fields.date': THIS_MONTH },
                  },
                  field: 'fields.amount',
                },
              },
              planned: {
                sum: {
                  query: { type: 'record', where: { recordType: 'category' } },
                  field: 'fields.planned',
                },
              },
              bills: {
                count: {
                  type: 'record',
                  where: { recordType: 'bill', 'due.date': { lte: '$today+1m' } },
                },
              },
            },
          },
        },
        {
          id: 'categories',
          w: 7,
          node: {
            component: 'CategoryBreakdown',
            title: 'Planned and spent',
            categories: { type: 'record', where: { recordType: 'category' } },
            planned: 'fields.planned',
            spent: {
              query: {
                type: 'record',
                where: { recordType: 'spending', 'fields.date': THIS_MONTH },
              },
              by: 'fields.category',
              sum: 'fields.amount',
            },
          },
        },
        {
          id: 'bills',
          w: 5,
          node: {
            component: 'DueTracker',
            title: 'Upcoming bills',
            query: { type: 'record', where: { recordType: 'bill' } },
            show: ['fields.amount'],
          },
        },
        {
          id: 'savings',
          w: 4,
          node: {
            component: 'Stat',
            label: 'Saved towards goals',
            query: { type: 'record', where: { recordType: 'goal' } },
            sum: 'fields.saved',
            target: 'fields.target',
            tone: 'good',
          },
        },
        {
          id: 'spending',
          w: 8,
          node: {
            component: 'DataTable',
            title: 'Spending this month',
            query: {
              type: 'record',
              where: { recordType: 'spending', 'fields.date': THIS_MONTH },
              sort: [{ field: 'fields.date', dir: 'desc' }],
            },
            columns: [
              { field: 'title', label: 'What' },
              { field: 'fields.date', label: 'Date' },
              { field: 'fields.category', label: 'Category' },
              { field: 'fields.amount', label: 'Amount' },
            ],
            total: true,
          },
        },
        {
          id: 'statements',
          node: {
            component: 'FileList',
            title: 'Statements',
            filter: { where: { kind: 'statement' } },
            groupBy: 'none',
            controls: [],
            details: ['issuer', 'issuedDate'],
          },
        },
      ],
    },
  ],
  examples: [
    {
      ref: 'groceries',
      recordType: 'category',
      title: 'Groceries',
      fields: { planned: eur(40000) },
    },
    {
      ref: 'transport',
      recordType: 'category',
      title: 'Transport',
      fields: { planned: eur(15000) },
    },
    { ref: 'eating', recordType: 'category', title: 'Eating out', fields: { planned: eur(12000) } },
    { ref: 'fun', recordType: 'category', title: 'Fun', fields: { planned: eur(10000) } },
    { ref: 'home', recordType: 'category', title: 'Home', fields: { planned: eur(8000) } },
    ...(
      [
        ['sp1', 'Weekly shop', '$monthStart', 8240, 'groceries', 'Market Hall'],
        ['sp2', 'Monthly train pass', '$monthStart+1d', 4500, 'transport', 'City Rail'],
        ['sp3', 'Lunch with Sam', '$monthStart+3d', 3880, 'eating', 'Noodle Bar'],
        ['sp4', 'Weekly shop', '$monthStart+4d', 6415, 'groceries', 'Market Hall'],
        ['sp5', 'Light bulbs and hooks', '$monthStart+5d', 3499, 'home', 'Hardware Corner'],
        ['sp6', 'Taxi home', '$monthStart+6d', 2750, 'transport', 'Cab Co'],
        ['sp7', 'Dinner out', '$monthStart+8d', 5600, 'eating', 'Bistro 9'],
        ['sp8', 'Weekly shop', '$monthStart+9d', 9120, 'groceries', 'Market Hall'],
        ['sp0', 'Weekly shop', '$monthStart-6d', 10200, 'groceries', 'Market Hall'],
      ] as const
    ).map(([ref, title, date, amount, category, payee]) => ({
      ref,
      recordType: 'spending',
      title,
      fields: { date, amount: eur(amount), category: `$${category}`, payee },
    })),
    {
      ref: 'sp9',
      recordType: 'spending',
      title: 'Game on sale',
      fields: {
        date: '$monthStart+2d',
        amount: { amount: 2500, currency: 'USD' },
        category: '$fun',
        payee: 'Online store',
      },
    },
    {
      ref: 'b_rent',
      recordType: 'bill',
      title: 'Rent',
      fields: { amount: eur(95000), category: '$home', payee: 'Landlord' },
      interval: { every: { n: 1, unit: 'months' }, lastDate: '$monthStart' },
    },
    {
      ref: 'b_phone',
      recordType: 'bill',
      title: 'Phone',
      fields: { amount: eur(2500), payee: 'Mobile Co' },
      interval: { every: { n: 1, unit: 'months' }, lastDate: '$today-25d' },
    },
    {
      ref: 'b_internet',
      recordType: 'bill',
      title: 'Internet',
      fields: { amount: eur(3500), category: '$home', payee: 'Fibre Co' },
      interval: { every: { n: 1, unit: 'months' }, lastDate: '$today-12d' },
    },
    {
      ref: 'b_streaming',
      recordType: 'bill',
      title: 'Streaming',
      fields: { amount: { amount: 1299, currency: 'USD' }, category: '$fun', payee: 'Stream Inc' },
      interval: { every: { n: 1, unit: 'months' }, lastDate: '$today-32d' },
    },
    {
      ref: 'b_insurance',
      recordType: 'bill',
      title: 'Home insurance',
      fields: { amount: eur(18000), category: '$home', payee: 'Insure Co' },
      interval: { every: { n: 1, unit: 'years' }, lastDate: '$today-340d' },
    },
    {
      ref: 'g_fund',
      recordType: 'goal',
      title: 'Emergency fund',
      fields: { target: eur(500000), saved: eur(320000), by: '$yearStart+1y' },
    },
  ],
};
