import type { Pack } from './pack.js';

const SESSION_KINDS = [
  { value: 'reading', label: 'Reading', color: 'blue' },
  { value: 'practice', label: 'Practice', color: 'violet' },
  { value: 'flashcards', label: 'Flashcards', color: 'amber' },
  { value: 'lecture', label: 'Lecture', color: 'neutral' },
  { value: 'past_paper', label: 'Past paper', color: 'red' },
] as const;

const RESOURCE_KINDS = [
  { value: 'book', label: 'Book', color: 'blue' },
  { value: 'course', label: 'Course', color: 'violet' },
  { value: 'deck', label: 'Flashcard deck', color: 'amber' },
  { value: 'video', label: 'Video', color: 'red' },
  { value: 'notes', label: 'Notes', color: 'neutral' },
] as const;

const EXAM_KINDS = [
  { value: 'written', label: 'Written', color: 'blue' },
  { value: 'oral', label: 'Oral', color: 'violet' },
  { value: 'practical', label: 'Practical', color: 'amber' },
  { value: 'quiz', label: 'Quiz', color: 'neutral' },
] as const;

const SUBJECT = { key: 'subject', label: 'Subject', kind: 'reference', to: 'subject' } as const;
const SESSIONS = { type: 'record', where: { recordType: 'session' } } as const;

/** The Study pack (R9): hours against a target per subject, the next exams, a practice log. */
export const STUDY_PACK: Pack = {
  key: 'study',
  name: 'Study',
  description: 'Hours studied against a target per subject, the next exams, and a practice log.',
  summary: 'Study hours against targets, and the exams coming up',
  guide:
    'Record types: subject (target: the hours you mean to study for it this term), session (one sitting: subject, date, hours, kind), resource (a book, course, flashcard deck, video or notes: subject, kind, link, or file for a document the owner shares) and exam (subject, date, kind, where). Log each sitting as a new session; hours are decimals (1.5 is an hour and a half). Change a subject\'s target when the plan changes, never the sessions. The page "Study" shows hours against target per subject (a CategoryBreakdown with aim "target"), the next exams (a DueTracker with date "fields.date" over exams from today) and hours per month. Pharos has no spaced-repetition scheduler: link a flashcard deck (e.g. Anki) as a resource.',
  recordTypes: [
    {
      key: 'subject',
      name: 'Subject',
      plural: 'Subjects',
      fields: [
        { key: 'target', label: 'Target', kind: 'number', unit: 'h' },
        { key: 'level', label: 'Level', kind: 'text' },
      ],
    },
    {
      key: 'session',
      name: 'Session',
      plural: 'Sessions',
      fields: [
        { ...SUBJECT, required: true },
        { key: 'date', label: 'Date', kind: 'date', required: true },
        { key: 'hours', label: 'Hours', kind: 'number', unit: 'h', required: true },
        {
          key: 'kind',
          label: 'Kind',
          kind: 'option',
          options: SESSION_KINDS.map((o) => ({ ...o })),
        },
      ],
    },
    {
      key: 'resource',
      name: 'Resource',
      plural: 'Resources',
      fields: [
        { ...SUBJECT },
        {
          key: 'kind',
          label: 'Kind',
          kind: 'option',
          options: RESOURCE_KINDS.map((o) => ({ ...o })),
        },
        { key: 'link', label: 'Link', kind: 'text' },
        { key: 'file', label: 'File', kind: 'file' },
      ],
    },
    {
      key: 'exam',
      name: 'Exam',
      plural: 'Exams',
      fields: [
        { ...SUBJECT, required: true },
        { key: 'date', label: 'Date', kind: 'date', required: true },
        {
          key: 'kind',
          label: 'Kind',
          kind: 'option',
          options: EXAM_KINDS.map((o) => ({ ...o })),
        },
        { key: 'place', label: 'Where', kind: 'text' },
      ],
    },
  ],
  views: [
    {
      name: 'Study',
      description: 'Hours against target per subject, the next exams and the practice log',
      widgets: [
        {
          id: 'headline',
          node: {
            component: 'Text',
            content:
              '**${hours}** studied of **${target}** planned; **${week}** in the last week. **${exams}** exams in the next month.',
            values: {
              hours: { sum: { query: { ...SESSIONS }, field: 'fields.hours' } },
              target: {
                sum: {
                  query: { type: 'record', where: { recordType: 'subject' } },
                  field: 'fields.target',
                },
              },
              week: {
                sum: {
                  query: {
                    type: 'record',
                    where: { recordType: 'session', 'fields.date': { gte: '$today-6d' } },
                  },
                  field: 'fields.hours',
                },
              },
              exams: {
                count: {
                  type: 'record',
                  where: {
                    recordType: 'exam',
                    'fields.date': { gte: '$today', lte: '$today+30d' },
                  },
                },
              },
            },
          },
        },
        {
          id: 'targets',
          w: 7,
          node: {
            component: 'CategoryBreakdown',
            title: 'Hours against target',
            categories: { type: 'record', where: { recordType: 'subject' } },
            planned: 'fields.target',
            spent: { query: { ...SESSIONS }, by: 'fields.subject', sum: 'fields.hours' },
            aim: 'target',
          },
        },
        {
          id: 'exams',
          w: 5,
          node: {
            component: 'DueTracker',
            title: 'Next exams',
            query: {
              type: 'record',
              where: { recordType: 'exam', 'fields.date': { gte: '$today' } },
            },
            date: 'fields.date',
            show: ['fields.kind', 'fields.place'],
            limit: 5,
          },
        },
        {
          id: 'per-month',
          w: 5,
          node: {
            component: 'CountChart',
            title: 'Hours per month',
            query: { ...SESSIONS },
            by: 'fields.date',
            bucket: 'month',
            sum: 'fields.hours',
          },
        },
        {
          id: 'log',
          w: 7,
          node: {
            component: 'DataTable',
            title: 'Practice log',
            query: { ...SESSIONS, sort: [{ field: 'fields.date', dir: 'desc' }], limit: 10 },
            columns: [
              { field: 'fields.date', label: 'Date' },
              { field: 'title', label: 'What' },
              { field: 'fields.subject', label: 'Subject' },
              { field: 'fields.kind', label: 'Kind' },
              { field: 'fields.hours', label: 'Hours' },
            ],
            total: true,
          },
        },
        {
          id: 'resources',
          node: {
            component: 'DataTable',
            title: 'Resources',
            query: {
              type: 'record',
              where: { recordType: 'resource' },
              sort: [{ field: 'fields.subject.title' }],
            },
            columns: [
              { field: 'title', label: 'Resource' },
              { field: 'fields.subject', label: 'Subject' },
              { field: 'fields.kind', label: 'Kind' },
              { field: 'fields.link', label: 'Link' },
              { field: 'fields.file', label: 'File' },
            ],
          },
        },
      ],
    },
  ],
  examples: [
    {
      ref: 'stats',
      recordType: 'subject',
      title: 'Statistics',
      fields: { target: 40, level: 'Year 2' },
    },
    {
      ref: 'spanish',
      recordType: 'subject',
      title: 'Spanish',
      fields: { target: 30, level: 'B1' },
    },
    {
      ref: 'history',
      recordType: 'subject',
      title: 'Art history',
      fields: { target: 20 },
    },
    {
      ref: 'se1',
      recordType: 'session',
      title: 'Regression chapter',
      fields: { subject: '$stats', date: '$today-20d', hours: 2, kind: 'reading' },
    },
    {
      ref: 'se2',
      recordType: 'session',
      title: 'Problem set 3',
      fields: { subject: '$stats', date: '$today-12d', hours: 3, kind: 'practice' },
    },
    {
      ref: 'se3',
      recordType: 'session',
      title: 'Past paper 2024',
      fields: { subject: '$stats', date: '$today-3d', hours: 2.5, kind: 'past_paper' },
    },
    {
      ref: 'se4',
      recordType: 'session',
      title: 'Verb drills',
      fields: { subject: '$spanish', date: '$today-9d', hours: 1, kind: 'flashcards' },
    },
    {
      ref: 'se5',
      recordType: 'session',
      title: 'Conversation class',
      fields: { subject: '$spanish', date: '$today-2d', hours: 1.5, kind: 'lecture' },
    },
    {
      ref: 'se6',
      recordType: 'session',
      title: 'Baroque painters',
      fields: { subject: '$history', date: '$today-5d', hours: 2, kind: 'reading' },
    },
    {
      ref: 'r1',
      recordType: 'resource',
      title: 'Intro to statistical learning',
      fields: { subject: '$stats', kind: 'book' },
    },
    {
      ref: 'r2',
      recordType: 'resource',
      title: 'Spanish verbs deck',
      fields: { subject: '$spanish', kind: 'deck', link: 'https://apps.ankiweb.net' },
    },
    {
      ref: 'e1',
      recordType: 'exam',
      title: 'Statistics midterm',
      fields: { subject: '$stats', date: '$today+9d', kind: 'written', place: 'Hall B' },
    },
    {
      ref: 'e2',
      recordType: 'exam',
      title: 'Spanish oral',
      fields: { subject: '$spanish', date: '$today+24d', kind: 'oral', place: 'Room 12' },
    },
    {
      ref: 'e3',
      recordType: 'exam',
      title: 'Art history essay exam',
      fields: { subject: '$history', date: '$today+60d', kind: 'written' },
    },
  ],
};
