import { FilePlus } from 'lucide-react';
import { useState } from 'react';
import { FileList } from '../catalog/components/file-list';
import { useViewData } from '../catalog/context';
import { BUTTON, Panel } from '../catalog/ui';
import { plural } from '../lib/format';
import { AddFilesDialog } from './AddFilesDialog';

/**
 * A project's Files page: every file added to the project, grouped by kind with search and
 * filters, and "Add files" to pick more from the owner's folders. Rendered by ProjectPage at
 * /projects/:projectId/files, inside its data and drawer.
 */
export function FilesPage({ onAdded }: { onAdded: () => void }) {
  const { project, files = [] } = useViewData();
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<number | null>(null);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">Files</h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
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
