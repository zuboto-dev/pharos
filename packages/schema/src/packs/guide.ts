import type { RecordFieldDef } from '../records.js';
import type { Pack } from './pack.js';

/**
 * The pack guide (R9.6 prep): everything an agent needs to set up a pack project from scratch,
 * with no other reading. pack_list returns it and pharos://guide/packs serves it. The steps are
 * generic; the per-pack part is written from the packs' own data, so it never drifts.
 */

const STEPS = `# Setting up a pack project

A pack sets a project up for one kind of life admin (a car, money, music, study, company papers):
its record types, option lists and a hand-made page. You add the owner's data; the page reads it.

## 1. Pick a pack
- pack_list gives each pack's key, record types and page. Pick the one that fits what the owner
  asked for; don't invent record types for something a pack already covers.
- One pack per project is usual. To add a pack to a project that has one, pass projectId instead
  of name (its record types must not clash).

## 2. Apply it
- pack_apply {pack, name} starts a new project in one revision and returns projectId, the page
  (views[].id, url) and the pack's own guide. Read that guide before adding records.
- examples: true adds made-up records to look at. For the owner's real data leave it out (the
  default): made-up records would mix with theirs.
- Undo everything with history_revert on the revision it returns.

## 3. Add records
- One apply, many operations: {op: "create", type: "record", ref: "s1", data: {projectId,
  recordType, title, fields}}. Later operations in the same apply refer to it as "$s1", so a song
  and its mixes, or a subject and its sessions, go in together.
- fields use the keys of the record type (project_snapshot.recordTypes lists them with kinds):
  text; number (a plain number, its unit is on the type); money {amount in cents, currency}, e.g.
  {amount: 1250, currency: "EUR"} for 12.50; date "YYYY-MM-DD"; option (one of the listed
  values); reference (a record id or "$ref" of the type it points at); file (a project file id);
  meter (a number). Required fields must be set.
- Repeating record types (interval: true) take interval {every: {n, unit: "days" | "weeks" |
  "months" | "years"}, lastDate} and/or {meter: {n, from}, lastMeter}. lastDate is when it was
  last done; the page works out when it is due.
- A new event is a new record (a new mix, a new session, a new service); don't overwrite the old
  one. Fix a mistake with an update: {op: "update", type: "record", id, data: {fields: {…}}}
  (fields are merged).
- A refused apply changes nothing and says which field of which operation is wrong and what is
  allowed: fix exactly that and send the whole apply again.

## 4. Add files (documents, audio)
- Files stay on the owner's disk; you can't upload or invent them. If no shared folder holds
  them: folder_request {path, level: "details", reason, projectId}, tell the owner in one line to
  click Approve in Pharos, and check with folder_request_status.
- Once approved, files_unadded {projectId} lists what you can add. Add them in one apply:
  {op: "create", type: "file", ref: "f1", data: {projectId, rootId: folderId, path, title, kind,
  tags}}, and set issuer, issuedDate and expiryDate with {op: "update", type: "file", id: "$f1",
  data: {…}} in the same apply. Kinds are the project's file kinds (project_snapshot.options).
- Point records at files in the same apply: fields.file: "$f1".
- You see a file's details only, never its contents; never guess a date that isn't in its name
  or the owner's words: leave it out and ask.

## 5. The page
- The pack's page is already there and reads live data: usually nothing to build. Read it with
  view_get before changing it, and change it with view_update ops, keeping widget ids:
  {op: "update", id, set: {title: "…"}}, {op: "add", widget: {id, w, node}}, {op: "remove", id}.
- Queries over records: {type: "record", where: {recordType: "mix"}}; fields are
  "fields.<key>", one hop through a reference or file field ("fields.song.title",
  "fields.song.fields.stage"), money parts "fields.cost.amount" (cents); repeating records also
  have "due.band", "due.date". Dates: "$today", "$today+30d", "$monthStart", "$yearStart".
- sort + onePer keeps one row per value: the latest mix of each song is mixes sorted by
  fields.date desc with onePer "fields.song".
- Blocks that fit packs: DataTable (columns, total: true for a ledger), DueTracker (repeating
  records, files by expiryDate, or one-off dates with date: "fields.date"), CategoryBreakdown
  (planned against actual; aim: "target" for hours against a target), CountChart (by a field;
  sum and bucket "month"/"year" for totals over time), Stat (sum, target), Text with live values
  ({count}, {sum}), FileList and FileView (audio plays in place).

## 6. Pass the checks
- Query checks run on every view save: an unknown field, record type or option value, a sum over
  text, a bad relative date or a range on money refuses the save. The error names the JSON path,
  the allowed values, the closest match and a corrected example: fix exactly that and retry.
- Fact checks: every number on the page must come from a query. Never write a number into
  Markdown or Text prose by hand ("12 hours", "3 songs"): use a Text value ("\${hours}") instead.
- Before you finish, call view_preview {viewId} and compare what each widget shows with the
  records you added: counts, totals per currency, what's due and when, the latest row per group.
  If a number is wrong, the data is wrong (a date, a reference, a missing field): fix the data,
  not the page.
- Then tell the owner in one or two sentences what you set up, with the page's link.`;

function fieldLine(f: RecordFieldDef): string {
  const kind =
    f.kind === 'option'
      ? `option: ${(f.options ?? []).map((o) => o.value).join(', ')}`
      : f.kind === 'reference'
        ? `reference to ${f.to}`
        : f.kind === 'money'
          ? `money${f.currency ? `, usually ${f.currency}` : ''}`
          : f.unit
            ? `${f.kind} in ${f.unit}`
            : f.kind;
  return `${f.key} (${kind}${f.required ? ', required' : ''})`;
}

function packSection(pack: Pack): string {
  const types = pack.recordTypes.map(
    (t) =>
      `  - ${t.key}${t.interval ? ' (repeats: interval)' : ''}: ${t.fields.map(fieldLine).join('; ')}`,
  );
  const fileKinds = pack.options?.['file.kind']?.map((o) => o.value);
  return [
    `### ${pack.name} (\`${pack.key}\`)`,
    pack.description,
    `- Record types:`,
    ...types,
    ...(fileKinds ? [`- File kinds: ${fileKinds.join(', ')}`] : []),
    `- Page: ${pack.views.map((v) => `"${v.name}" (widgets ${v.widgets.map((w) => w.id).join(', ')})`).join('; ')}`,
    `- ${pack.guide}`,
  ].join('\n');
}

/** The whole guide: the steps, then each pack's record types and page. */
export function packGuide(packs: readonly Pack[]): string {
  return [STEPS, '', '## The packs', '', ...packs.map(packSection).flatMap((s) => [s, ''])].join(
    '\n',
  );
}
