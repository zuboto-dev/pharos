import { FILE_ROUTES, type MentionedFile } from '@pharos/schema';
import { FilePlus } from 'lucide-react';
import { useState } from 'react';
import { FileList } from '../catalog/components/file-list';
import { useViewData } from '../catalog/context';
import { SourceStatus } from '../catalog/source-file';
import { BUTTON, Panel } from '../catalog/ui';
import { useResource } from '../lib/api';
import { plural } from '../lib/format';
import { AddFilesDialog } from './AddFilesDialog';

/**
 * A project's Files page: every file added to the project, grouped by kind with search and
 * filters, and "Add files" to pick more from the owner's folders. Rendered by ProjectPage at
 * /projects/:projectId/files, inside its data and drawer.
 */
const WHY: Record<MentionedFile['match']['state'], string> = {
  'not-in-folder': 'Folder not approved',
  'in-folder': 'Not added yet',
  missing: 'File not found',
  refused: 'Refused for safety',
};

/**
 * Documents the project mentions (artifacts with a local path) that aren't project files yet
 * (R7.12), with why: the folder isn't approved (Approve, when an agent asked), the file isn't
 * there, or Pharos never reads it. Each opens its artifact.
 */
function MentionedFiles({ projectId, version }: { projectId: string; version: number }) {
  const [refresh, setRefresh] = useState(0);
  const url = `${FILE_ROUTES.mentioned.replace(':projectId', encodeURIComponent(projectId))}?v=${version}.${refresh}`;
  const mentioned = useResource<MentionedFile[]>(url);
  const { actions } = useViewData();
  const list = Array.isArray(mentioned.data) ? mentioned.data : [];
  if (!list.length) return null;
  return (
    <section aria-label="Mentioned but not in Pharos yet" className="space-y-2">
      <h2 className="text-sm font-semibold">Mentioned but not in Pharos yet</h2>
      <p className="text-sm text-muted">
        Documents this project points to that Pharos can’t open yet.
      </p>
      <Panel>
        <ul className="-my-2 divide-y divide-line-soft">
          {list.map((m) => (
            <li key={m.artifactId} className="space-y-1 py-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <button
                  type="button"
                  onClick={() => actions.open({ entity: m.artifactId })}
                  className="min-w-0 truncate text-left text-sm font-medium hover:underline focus-visible:outline-2 focus-visible:outline-sky-400"
                >
                  {m.title}
                </button>
                <span className="text-xs font-medium text-warn">{WHY[m.match.state]}</span>
              </div>
              <code className="block truncate text-xs text-muted">{m.uri}</code>
              <SourceStatus match={m.match} onApproved={() => setRefresh((n) => n + 1)} />
            </li>
          ))}
        </ul>
      </Panel>
    </section>
  );
}

export function FilesPage({ onAdded }: { onAdded: () => void }) {
  const { project, files = [], version } = useViewData();
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<number | null>(null);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">Files</h1>
          <p className="text-sm text-muted">
            {files.length
              ? `${plural(files.length, 'file')} from your folders. Open one to preview it, download it or show it in Finder.`
              : 'Statements, receipts, contracts and certificates from your folders. They stay where they are.'}
          </p>
        </div>
        <button type="button" onClick={() => setAdding(true)} className={BUTTON.primary}>
          <FilePlus className="size-3.5" aria-hidden /> Add files
        </button>
      </div>
      {added !== null && (
        <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
          Added {plural(added, 'file')}.
        </p>
      )}
      <Panel>
        <FileList
          node={{ component: 'FileList', details: ['issuer', 'issuedDate', 'expiryDate'] }}
        />
      </Panel>
      <MentionedFiles projectId={project.id} version={version} />
      {adding && (
        <AddFilesDialog
          projectId={project.id}
          onClose={() => setAdding(false)}
          onAdded={(count) => {
            setAdded(count);
            onAdded();
          }}
        />
      )}
    </div>
  );
}
