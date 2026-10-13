import { ProjectStatus, type Entity, type Operation } from '@pharos/schema';
import { X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Select } from '../catalog/select';
import { BUTTON, toneOf } from '../catalog/ui';
import { ApiError, postJson, useResource } from '../lib/api';
import { humanize } from '../lib/format';
import { notifyProjectsChanged } from './projects';

const FIELD =
  'w-full rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900';
const NEW_REPO = '__new__';

function Label({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{text}</span>
      {children}
    </label>
  );
}

/** A pack a project can start from (R8), as GET /api/packs lists it. */
type PackSummary = { key: string; name: string; description: string; recordTypes: string[] };

/**
 * Creates a project by hand (saved as a revision by you), optionally with a new repository, or
 * from a pack (R8): its record types and page, in one revision.
 */
export function NewProjectDialog({
  onClose,
  initial = {},
}: {
  onClose: () => void;
  /** Where to create it, e.g. the folder or section whose menu opened this. */
  initial?: { repositoryId?: string; sectionId?: string };
}) {
  const navigate = useNavigate();
  const repositories = useResource<Entity<'repository'>[]>('/api/entities/repository');
  const packs = useResource<PackSummary[]>('/api/packs');
  const [pack, setPack] = useState('');
  const [examples, setExamples] = useState(false);
  const chosen = packs.data?.find((p) => p.key === pack);
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [status, setStatus] = useState<string>('planning');
  const [repository, setRepository] = useState(initial.repositoryId ?? '');
  const [repoName, setRepoName] = useState('');
  const [repoPath, setRepoPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const startFromPack = async () => {
    setSaving(true);
    try {
      const result = await postJson<{ projectId: string }>('/api/packs/apply', {
        pack,
        name: name.trim(),
        examples,
      });
      notifyProjectsChanged();
      onClose();
      navigate(`/projects/${result.projectId}`);
    } catch (err) {
      setError(err instanceof ApiError ? [err.message, ...err.issues].join('\n') : String(err));
      setSaving(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pack) return startFromPack();
    const operations: Operation[] = [];
    if (repository === NEW_REPO) {
      operations.push({
        op: 'create',
        type: 'repository',
        ref: 'repo',
        data: {
          name: repoName.trim(),
          ...(repoPath.trim() ? { path: repoPath.trim() } : {}),
          ...(initial.sectionId ? { sectionId: initial.sectionId } : {}),
        },
      });
    }
    operations.push({
      op: 'create',
      type: 'project',
      ref: 'project',
      data: {
        name: name.trim(),
        status,
        ...(summary.trim() ? { summary: summary.trim() } : {}),
        ...(repository === NEW_REPO
          ? { repositoryId: '$repo' }
          : repository
            ? { repositoryId: repository }
            : initial.sectionId
              ? { sectionId: initial.sectionId }
              : {}),
      },
    });
    setSaving(true);
    try {
      const result = await postJson<{ created: Record<string, string> }>('/api/apply', {
        message: `Create project “${name.trim()}”`,
        operations,
      });
      notifyProjectsChanged();
      onClose();
      navigate(`/projects/${result.created.project}`);
    } catch (err) {
      setError(err instanceof ApiError ? [err.message, ...err.issues].join('\n') : String(err));
      setSaving(false);
    }
  };

  const valid = name.trim() && (repository !== NEW_REPO || repoName.trim());

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="New project"
    >
      <div className="absolute inset-0 bg-neutral-900/30 dark:bg-black/50" onClick={onClose} />
      <form
        onSubmit={(e) => void submit(e)}
        className="relative w-full max-w-md space-y-4 rounded-xl bg-white p-5 shadow-xl dark:bg-neutral-900"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">New project</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <X className="size-5" />
          </button>
        </div>
        <Label text="Name">
          <input
            autoFocus
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={FIELD}
          />
        </Label>
        <Label text="Start from">
          <Select
            label="Start from"
            value={pack}
            onChange={setPack}
            options={[
              { value: '', label: 'A blank project', description: 'Goals, stages and tasks' },
              ...(packs.data ?? []).map((p) => ({
                value: p.key,
                label: `${p.name} pack`,
                description: p.description,
              })),
            ]}
          />
        </Label>
        {chosen && (
          <div className="space-y-2 rounded-lg bg-neutral-50 p-3 text-sm dark:bg-neutral-800/50">
            <p>
              Keeps {chosen.recordTypes.join(', ').toLowerCase()} records and opens on its own page.
              Undo it from History in one step.
            </p>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={examples}
                onChange={(e) => setExamples(e.target.checked)}
              />
              Add made-up examples to see how it looks
            </label>
          </div>
        )}
        {!chosen && (
          <Label text="Summary">
            <input
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="One line about the project"
              className={FIELD}
            />
          </Label>
        )}
        {!chosen && (
          <div className="grid grid-cols-2 gap-3">
            <Label text="Status">
              <Select
                label="Status"
                value={status}
                onChange={setStatus}
                options={ProjectStatus.options.map((s) => ({
                  value: s,
                  label: humanize(s),
                  color: toneOf(s),
                }))}
              />
            </Label>
            <Label text="Repository">
              <Select
                label="Repository"
                value={repository}
                onChange={setRepository}
                options={[
                  { value: '', label: 'None' },
                  ...(repositories.data ?? []).map((r) => ({
                    value: r.id,
                    label: r.data.name,
                    ...(r.data.path ? { description: r.data.path } : {}),
                  })),
                  {
                    value: NEW_REPO,
                    label: 'New repository…',
                    description: 'Add a repository with this project',
                  },
                ]}
              />
            </Label>
          </div>
        )}
        {!chosen && repository === NEW_REPO && (
          <div className="grid grid-cols-2 gap-3 rounded-lg bg-neutral-50 p-3 dark:bg-neutral-800/50">
            <Label text="Repository name">
              <input
                required
                value={repoName}
                onChange={(e) => setRepoName(e.target.value)}
                className={FIELD}
              />
            </Label>
            <Label text="Local path">
              <input
                value={repoPath}
                onChange={(e) => setRepoPath(e.target.value)}
                placeholder="~/code/app"
                className={FIELD}
              />
            </Label>
          </div>
        )}
        {!chosen && (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            The project starts with the default Overview. Ask your agent to fill in goals, stages,
            and tasks, or add them as you go.
          </p>
        )}
        {error && <p className="text-sm whitespace-pre-line text-rose-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={BUTTON.secondary}>
            Cancel
          </button>
          <button type="submit" disabled={!valid || saving} className={BUTTON.primary}>
            {saving ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </form>
    </div>
  );
}
