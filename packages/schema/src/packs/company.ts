import { defaultOptions } from '../options.js';
import type { Pack } from './pack.js';

const RENEWAL_KINDS = [
  { value: 'registration', label: 'Registration', color: 'violet' },
  { value: 'licence', label: 'Licence', color: 'blue' },
  { value: 'insurance', label: 'Insurance', color: 'green' },
  { value: 'tax_filing', label: 'Tax filing', color: 'amber' },
  { value: 'annual_report', label: 'Annual report', color: 'neutral' },
] as const;

const EXPIRING = { type: 'file', where: { expiryDate: { exists: true } } } as const;

/**
 * The Company documents pack (R9): the documents themselves are project files (kind, issuer,
 * issued and expiry dates on the file); what has to be renewed or filed again is a record.
 */
export const COMPANY_PACK: Pack = {
  key: 'company',
  name: 'Company documents',
  description:
    'Company papers by kind and issuer, what expires soon, and the renewals and filings that repeat.',
  summary: "The company's papers, what expires soon and what has to be filed again",
  guide:
    "The documents are project files: ask for their folder with folder_request, add them from files_unadded, and set each one's kind (registration, licence, insurance, tax, contract, certificate, …), issuer, issuedDate and expiryDate (YYYY-MM-DD) in the same apply; the page reads those details, so a file without an expiryDate never shows as expiring. Record type renewal is something that comes back (a licence renewal, an annual report, a quarterly tax filing): document (the file it renews), authority, cost and an interval (every N months or years, lastDate = when it was last done). When a document is renewed, add the new file, set its dates, point the renewal's document at it and set interval.lastDate. Never guess an expiry date: leave it out and ask the owner.",
  recordTypes: [
    {
      key: 'renewal',
      name: 'Renewal',
      plural: 'Renewals and filings',
      interval: true,
      fields: [
        {
          key: 'kind',
          label: 'Kind',
          kind: 'option',
          options: RENEWAL_KINDS.map((o) => ({ ...o })),
        },
        { key: 'document', label: 'Document', kind: 'file' },
        { key: 'authority', label: 'Authority', kind: 'text' },
        { key: 'cost', label: 'Cost', kind: 'money', currency: 'EUR' },
      ],
    },
  ],
  options: {
    'file.kind': [
      { value: 'registration', label: 'Registration', meaning: 'certificate', color: 'violet' },
      { value: 'licence', label: 'Licence', meaning: 'certificate', color: 'blue' },
      { value: 'insurance', label: 'Insurance', meaning: 'contract', color: 'green' },
      { value: 'tax', label: 'Tax', meaning: 'statement', color: 'amber' },
      ...defaultOptions('file.kind'),
    ],
  },
  views: [
    {
      name: 'What expires soon',
      description: 'Papers that expire soon, renewals and filings due, and every document',
      widgets: [
        {
          id: 'headline',
          node: {
            component: 'Text',
            content:
              '**${expired}** expired and **${soon}** expiring within two months. **${due}** renewals or filings due within a month.',
            values: {
              expired: {
                count: { type: 'file', where: { expiryDate: { lt: '$today' } } },
              },
              soon: {
                count: {
                  type: 'file',
                  where: { expiryDate: { gte: '$today', lte: '$today+60d' } },
                },
              },
              due: {
                count: {
                  type: 'record',
                  where: {
                    recordType: 'renewal',
                    'due.band': ['past_due', 'very_urgent', 'urgent'],
                  },
                },
              },
            },
          },
        },
        {
          id: 'expiring',
          w: 7,
          node: {
            component: 'DueTracker',
            title: 'What expires soon',
            query: { ...EXPIRING },
            limit: 8,
          },
        },
        {
          id: 'renewals',
          w: 5,
          node: {
            component: 'DueTracker',
            title: 'Renewals and filings',
            query: { type: 'record', where: { recordType: 'renewal' } },
            show: ['fields.cost'],
          },
        },
        {
          id: 'documents',
          w: 8,
          node: {
            component: 'DataTable',
            title: 'Documents',
            query: {
              type: 'file',
              sort: [{ field: 'kind' }, { field: 'expiryDate' }],
            },
            columns: [
              { field: 'title', label: 'Document' },
              { field: 'kind', label: 'Kind' },
              { field: 'issuer', label: 'Issuer' },
              { field: 'issuedDate', label: 'Issued' },
              { field: 'expiryDate', label: 'Expires' },
            ],
          },
        },
        {
          id: 'issuers',
          w: 4,
          node: {
            component: 'CountChart',
            title: 'By issuer',
            query: { type: 'file', where: { issuer: { exists: true } } },
            by: 'issuer',
            sort: 'count',
          },
        },
      ],
    },
  ],
  examples: [
    {
      ref: 'annual',
      recordType: 'renewal',
      title: 'Annual return',
      fields: {
        kind: 'annual_report',
        authority: 'Companies registry',
        cost: { amount: 1300, currency: 'EUR' },
      },
      interval: { every: { n: 1, unit: 'years' }, lastDate: '$today-340d' },
    },
    {
      ref: 'vat',
      recordType: 'renewal',
      title: 'Quarterly VAT filing',
      fields: { kind: 'tax_filing', authority: 'Tax office' },
      interval: { every: { n: 3, unit: 'months' }, lastDate: '$today-95d' },
    },
    {
      ref: 'licence',
      recordType: 'renewal',
      title: 'Trading licence renewal',
      fields: {
        kind: 'licence',
        authority: 'City business office',
        cost: { amount: 25000, currency: 'EUR' },
      },
      interval: { every: { n: 2, unit: 'years' }, lastDate: '$today-700d' },
    },
    {
      ref: 'liability',
      recordType: 'renewal',
      title: 'Liability insurance',
      fields: { kind: 'insurance', cost: { amount: 64000, currency: 'EUR' } },
      interval: { every: { n: 1, unit: 'years' }, lastDate: '$today-200d' },
    },
  ],
};
