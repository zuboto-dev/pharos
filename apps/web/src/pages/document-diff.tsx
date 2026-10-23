import {
  parseDiff,
  type DiffHunk,
  type DiffLine,
  type DiffPart,
  type DocLeafBlock,
} from '@pharos/schema';
import clsx from 'clsx';
import { ChevronDown, FileCode2, GitCompareArrows } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Markdown } from '../catalog/ui';

// A code change in a report document: one card per file, like a code review. Removed lines on
// rose, added on emerald, with − / + and both line numbers so colour is never the only cue; the
// words changed inside an edited line are marked (<del>/<ins>). Long files open at their first
// lines with the rest one click away.

export type Diff = Extract<DocLeafBlock, { kind: 'diff' }>;
type DiffFile = Diff['files'][number];

/** Lines a file shows before "Show all". */
export const DIFF_FOLD = 40;

export function DiffView({ block }: { block: Diff }) {
  const files = useMemo(
    () => block.files.map((file) => ({ file, parsed: parseDiff(file.patch) })),
    [block.files],
  );
  const added = files.reduce((n, f) => n + f.parsed.added, 0);
  const removed = files.reduce((n, f) => n + f.parsed.removed, 0);
  return (
    <>
      {(block.title || block.ref) && (
        <div className="doc-diff-head">
          {block.title && <h3 className="doc-block-title">{block.title}</h3>}
          <div className="doc-diff-summary">
            <GitCompareArrows aria-hidden className="size-4" />
            {block.ref && <code>{block.ref}</code>}
            <span>
              {files.length} {files.length === 1 ? 'file' : 'files'}
            </span>
            <Counts added={added} removed={removed} />
          </div>
        </div>
      )}
      <div className="space-y-3">
        {files.map(({ file, parsed }) => (
          <FileCard key={file.path} file={file} parsed={parsed} />
        ))}
      </div>
      {block.caption && (
        <div className="doc-caption doc-caption-md">
          <Markdown>{block.caption}</Markdown>
        </div>
      )}
    </>
  );
}

function Counts({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="doc-diff-counts">
      <span className="text-ok">
        +{added}
        <span className="sr-only"> added</span>
      </span>
      <span className="text-danger">
        −{removed}
        <span className="sr-only"> removed</span>
      </span>
    </span>
  );
}

function FileCard({ file, parsed }: { file: DiffFile; parsed: ReturnType<typeof parseDiff> }) {
  const total = parsed.hunks.reduce((n, h) => n + h.lines.length + 1, 0);
  const [all, setAll] = useState(total <= DIFF_FOLD + 10);
  const slash = file.path.lastIndexOf('/');
  const shown = foldHunks(parsed.hunks, all ? Infinity : DIFF_FOLD);
  return (
    <section data-diff-file={file.path} className="doc-diff-file">
      <header className="doc-diff-file-head">
        <FileCode2 aria-hidden className="size-4 shrink-0 text-muted" />
        <span className="min-w-0 truncate font-mono text-[0.8125rem]" title={file.path}>
          <span className="text-muted">{file.path.slice(0, slash + 1)}</span>
          <span className="font-semibold text-ink">{file.path.slice(slash + 1)}</span>
        </span>
        <Counts added={parsed.added} removed={parsed.removed} />
      </header>
      {file.note && (
        <div className="doc-diff-note">
          <Markdown>{file.note}</Markdown>
        </div>
      )}
      <div className="doc-diff-body">
        <table>
          {shown.map(({ hunk, lines }, h) => (
            <tbody key={h}>
              {(hunk.header || h > 0) && (
                <tr className="doc-diff-hunk">
                  <td colSpan={3}>
                    <span aria-hidden>⋯</span>
                    {hunk.context && <span className="ml-2">{hunk.context}</span>}
                  </td>
                </tr>
              )}
              {lines.map((line, i) => (
                <Row key={i} line={line} />
              ))}
            </tbody>
          ))}
        </table>
      </div>
      {!all && (
        <button type="button" className="doc-diff-more" onClick={() => setAll(true)}>
          <ChevronDown aria-hidden className="size-4" />
          Show all {total} lines
        </button>
      )}
    </section>
  );
}

/** The hunks and lines shown within `limit` lines (each hunk's own row counts as one). */
function foldHunks(hunks: DiffHunk[], limit: number) {
  const shown: { hunk: DiffHunk; lines: DiffLine[] }[] = [];
  let left = limit;
  for (const hunk of hunks) {
    if (left <= 0) break;
    const lines = hunk.lines.slice(0, left);
    shown.push({ hunk, lines });
    left -= lines.length + 1;
  }
  return shown;
}

function Row({ line }: { line: DiffLine }) {
  const sign = line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' ';
  return (
    <tr data-line={line.kind} className={clsx('doc-diff-line', `is-${line.kind}`)}>
      <td className="doc-diff-no">{line.kind !== 'added' ? line.old : ''}</td>
      <td className="doc-diff-no">{line.kind !== 'removed' ? line.new : ''}</td>
      <td className="doc-diff-text">
        <span aria-hidden className="doc-diff-sign">
          {sign}
        </span>
        {line.kind !== 'same' && (
          <span className="sr-only">{line.kind === 'added' ? 'added: ' : 'removed: '}</span>
        )}
        {line.kind !== 'same' && line.parts ? <Parts parts={line.parts} /> : line.text || ' '}
      </td>
    </tr>
  );
}

function Parts({ parts }: { parts: DiffPart[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.op === 'removed' ? (
          <del key={i}>{p.text}</del>
        ) : p.op === 'added' ? (
          <ins key={i}>{p.text}</ins>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}
