import type { Pack } from './pack.js';

const STAGES = [
  { value: 'idea', label: 'Idea', color: 'muted' },
  { value: 'writing', label: 'Writing', color: 'neutral' },
  { value: 'demo', label: 'Demo', color: 'blue' },
  { value: 'recording', label: 'Recording', color: 'violet' },
  { value: 'mixing', label: 'Mixing', color: 'amber' },
  { value: 'mastering', label: 'Mastering', color: 'red' },
  { value: 'released', label: 'Released', color: 'green' },
] as const;

const SESSION_KINDS = [
  { value: 'writing', label: 'Writing', color: 'neutral' },
  { value: 'rehearsal', label: 'Rehearsal', color: 'blue' },
  { value: 'recording', label: 'Recording', color: 'violet' },
  { value: 'mixing', label: 'Mixing', color: 'amber' },
] as const;

const SONG = { key: 'song', label: 'Song', kind: 'reference', to: 'song' } as const;

/** The Music pack (R9): songs by stage, the latest mix of each to play in place, sessions. */
export const MUSIC_PACK: Pack = {
  key: 'music',
  name: 'Music',
  description:
    'Songs by stage, the latest mix of each one to play in place, and a log of sessions.',
  summary: 'Songs, their mixes and the sessions behind them',
  guide:
    'Record types: song (stage: idea, writing, demo, recording, mixing, mastering, released; move it on as the song does), mix (one bounce of a song: song, date, version, and file: the audio file of that mix) and session (time spent: song, date, hours, kind). Every new bounce is a new mix record, never an edit of the old one, so the page plays the latest and keeps the rest. Audio files (wav, mp3, m4a, ogg, flac) come from a folder the owner shares: ask with folder_request, add them from files_unadded with kind "audio", then set the mix\'s fields.file to the file id. The page "Songs" shows the latest mix of each song: mixes sorted by fields.date (desc) with onePer "fields.song".',
  recordTypes: [
    {
      key: 'song',
      name: 'Song',
      plural: 'Songs',
      fields: [
        {
          key: 'stage',
          label: 'Stage',
          kind: 'option',
          required: true,
          options: STAGES.map((o) => ({ ...o })),
        },
        { key: 'key', label: 'Key', kind: 'text' },
        { key: 'bpm', label: 'Tempo', kind: 'number', unit: 'bpm' },
      ],
    },
    {
      key: 'mix',
      name: 'Mix',
      plural: 'Mixes',
      fields: [
        { ...SONG, required: true },
        { key: 'date', label: 'Date', kind: 'date', required: true },
        { key: 'version', label: 'Version', kind: 'text' },
        { key: 'file', label: 'Audio', kind: 'file' },
      ],
    },
    {
      key: 'session',
      name: 'Session',
      plural: 'Sessions',
      fields: [
        { ...SONG },
        { key: 'date', label: 'Date', kind: 'date', required: true },
        { key: 'hours', label: 'Hours', kind: 'number', unit: 'h' },
        {
          key: 'kind',
          label: 'Kind',
          kind: 'option',
          options: SESSION_KINDS.map((o) => ({ ...o })),
        },
      ],
    },
  ],
  views: [
    {
      name: 'Songs',
      description: 'Where each song is, its latest mix to play, and the sessions behind them',
      widgets: [
        {
          id: 'headline',
          w: 6,
          node: {
            component: 'Text',
            content:
              '**${songs}** songs, **${finishing}** in mixing or mastering. Sessions this month: **${hours}**.',
            values: {
              songs: { count: { type: 'record', where: { recordType: 'song' } } },
              finishing: {
                count: {
                  type: 'record',
                  where: { recordType: 'song', 'fields.stage': ['mixing', 'mastering'] },
                },
              },
              hours: {
                sum: {
                  query: {
                    type: 'record',
                    where: { recordType: 'session', 'fields.date': { gte: '$monthStart' } },
                  },
                  field: 'fields.hours',
                },
              },
            },
          },
        },
        {
          id: 'log-mix',
          w: 3,
          node: {
            component: 'Action',
            label: 'Log a mix',
            recordType: 'mix',
            fields: ['song', 'date', 'version'],
          },
        },
        {
          id: 'log-session',
          w: 3,
          node: {
            component: 'Action',
            label: 'Log a session',
            recordType: 'session',
            fields: ['song', 'date', 'hours', 'kind'],
          },
        },
        {
          id: 'latest',
          w: 8,
          node: {
            component: 'DataTable',
            title: 'Latest mix of each song',
            query: {
              type: 'record',
              where: { recordType: 'mix' },
              sort: [
                { field: 'fields.song.fields.stage', dir: 'desc' },
                { field: 'fields.date', dir: 'desc' },
              ],
              onePer: 'fields.song',
            },
            columns: [
              { field: 'fields.song', label: 'Song' },
              { field: 'fields.song.fields.stage', label: 'Stage' },
              { field: 'fields.file', label: 'Latest mix' },
              { field: 'fields.version', label: 'Version' },
              { field: 'fields.date', label: 'Date' },
            ],
          },
        },
        {
          id: 'stages',
          w: 4,
          node: {
            component: 'CountChart',
            title: 'Songs by stage',
            query: { type: 'record', where: { recordType: 'song' } },
            by: 'fields.stage',
          },
        },
        {
          id: 'sessions',
          w: 7,
          node: {
            component: 'DataTable',
            title: 'Sessions',
            query: {
              type: 'record',
              where: { recordType: 'session' },
              sort: [{ field: 'fields.date', dir: 'desc' }],
              limit: 10,
            },
            columns: [
              { field: 'fields.date', label: 'Date' },
              { field: 'title', label: 'Session' },
              { field: 'fields.song', label: 'Song' },
              { field: 'fields.kind', label: 'Kind' },
              { field: 'fields.hours', label: 'Hours' },
            ],
            total: true,
          },
        },
        {
          id: 'audio',
          w: 5,
          node: {
            component: 'FileList',
            title: 'Every mix',
            filter: { where: { kind: 'audio' }, sort: [{ field: 'modifiedAt', dir: 'desc' }] },
            groupBy: 'none',
            controls: ['search'],
          },
        },
      ],
    },
  ],
  examples: [
    {
      ref: 'night',
      recordType: 'song',
      title: 'Night Bus',
      fields: { stage: 'mixing', key: 'A minor', bpm: 92 },
    },
    {
      ref: 'paper',
      recordType: 'song',
      title: 'Paper Boats',
      fields: { stage: 'recording', key: 'D major', bpm: 120 },
    },
    {
      ref: 'tide',
      recordType: 'song',
      title: 'Low Tide',
      fields: { stage: 'demo', key: 'F major', bpm: 76 },
    },
    { ref: 'kite', recordType: 'song', title: 'Kite String', fields: { stage: 'idea' } },
    {
      ref: 'm1',
      recordType: 'mix',
      title: 'Night Bus mix 1',
      fields: { song: '$night', date: '$today-30d', version: 'v1' },
    },
    {
      ref: 'm2',
      recordType: 'mix',
      title: 'Night Bus mix 2',
      fields: { song: '$night', date: '$today-9d', version: 'v2' },
    },
    {
      ref: 'm3',
      recordType: 'mix',
      title: 'Paper Boats rough mix',
      fields: { song: '$paper', date: '$today-14d', version: 'rough' },
    },
    {
      ref: 'm4',
      recordType: 'mix',
      title: 'Low Tide demo',
      fields: { song: '$tide', date: '$today-40d', version: 'demo' },
    },
    {
      ref: 's1',
      recordType: 'session',
      title: 'Vocals',
      fields: { song: '$paper', date: '$today-6d', hours: 3, kind: 'recording' },
    },
    {
      ref: 's2',
      recordType: 'session',
      title: 'Mix notes pass',
      fields: { song: '$night', date: '$today-9d', hours: 2.5, kind: 'mixing' },
    },
    {
      ref: 's3',
      recordType: 'session',
      title: 'Band run-through',
      fields: { date: '$today-12d', hours: 2, kind: 'rehearsal' },
    },
    {
      ref: 's4',
      recordType: 'session',
      title: 'Chorus lyrics',
      fields: { song: '$kite', date: '$today-2d', hours: 1, kind: 'writing' },
    },
  ],
};
