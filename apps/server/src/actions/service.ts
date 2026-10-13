import {
  ACTION_VERSION,
  ActionSubmission,
  actionForm,
  actionOperations,
  submissionErrors,
  submissionFingerprint,
  type ActionDef,
  type ActionDone,
  type ActionResult,
  type Author,
  type Entity,
  type Lookup,
  type ViewNode,
} from '@pharos/schema';
import { AgentFiles } from '../store/agent-files.js';
import { PharosError, formatPath } from '../store/errors.js';
import type { Store } from '../store/store.js';
import { effectiveBoard } from '../views/service.js';

/**
 * Record-form actions (R10): one submission of an Action block's form becomes one revision through
 * Store.apply, attributed to its author, or one of the contract's results (invalid, stale,
 * duplicate, not_found, failed). The action itself is read from the saved page, never from the
 * request. docs/reframe/r10-notes.md has the contract.
 */

type Row = { key: string; project_id: string; fingerprint: string; result: string | null };

const v = ACTION_VERSION;

/** The first Action node in a widget (the widget itself, or inside a Grid, Section or Tabs). */
function actionIn(node: ViewNode): (ActionDef & { component: 'Action' }) | undefined {
  if (node.component === 'Action') return node;
  const children =
    node.component === 'Grid' || node.component === 'Section'
      ? node.children
      : node.component === 'Tabs'
        ? node.tabs.flatMap((t) => t.children)
        : [];
  for (const child of children) {
    const found = actionIn(child);
    if (found) return found;
  }
  return undefined;
}

function invalid(message: string, fieldErrors: Record<string, string>): ActionResult {
  return { v, status: 'invalid', message, fieldErrors };
}

/** A store refusal as field errors: "fields.cost: …" lands on cost, the rest on the form. */
function storeErrors(err: PharosError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const line of err.issues.length ? err.issues : [err.message]) {
    const field = /fields\.([a-z][a-z0-9_]*)/.exec(line)?.[1];
    const key = field ?? 'form';
    errors[key] = errors[key] ? `${errors[key]}; ${line}` : line;
  }
  return errors;
}

export class ActionService {
  constructor(private readonly store: Store) {}

  private row(key: string): Row | undefined {
    return this.store.database
      .prepare('SELECT * FROM action_submissions WHERE key = ?')
      .get(key) as Row | undefined;
  }

  /** Takes the key before writing; false when another submission holds it already. */
  private reserve(key: string, projectId: string, fingerprint: string): boolean {
    const result = this.store.database
      .prepare(
        'INSERT OR IGNORE INTO action_submissions (key, project_id, fingerprint, result, created_at) VALUES (?, ?, ?, NULL, ?)',
      )
      .run(key, projectId, fingerprint, new Date().toISOString());
    return Number(result.changes) === 1;
  }

  private release(key: string): void {
    this.store.database
      .prepare('DELETE FROM action_submissions WHERE key = ? AND result IS NULL')
      .run(key);
  }

  private settle(key: string, result: ActionDone): void {
    this.store.database
      .prepare('UPDATE action_submissions SET result = ? WHERE key = ?')
      .run(JSON.stringify(result), key);
  }

  /** What a key already did: the first result again, or why the key can't be used. */
  private replay(row: Row, fingerprint: string, projectId: string): ActionResult {
    if (row.fingerprint !== fingerprint || row.project_id !== projectId)
      return invalid('This form was already sent with different values; open it again', {
        form: 'idempotencyKey was used for a different submission',
      });
    if (!row.result)
      return {
        v,
        status: 'failed',
        message:
          "The first try with this form hasn't finished; reload the page to see whether it was saved",
      };
    const first = JSON.parse(row.result) as ActionDone;
    const undone =
      first.revision !== null && this.store.revision(first.revision)?.revertedBy !== null;
    return { ...first, status: 'duplicate', ...(undone ? { undone: true } : {}) };
  }

  /** Runs one submission. Never throws for a bad submission; `failed` covers the unexpected. */
  run(author: Author, raw: unknown): ActionResult {
    const parsed = ActionSubmission.safeParse(raw);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const [first, second] = issue.path;
        const key = first === 'values' && second !== undefined ? String(second) : String(first);
        errors[key || 'form'] ??= `${formatPath(issue.path)}: ${issue.message}`;
      }
      return invalid("The form couldn't be read", errors);
    }
    const submission = parsed.data;
    const fingerprint = submissionFingerprint(submission);
    const existing = this.row(submission.idempotencyKey);
    if (existing) return this.replay(existing, fingerprint, submission.projectId);

    const files = author.kind === 'agent' ? new AgentFiles(this.store) : null;
    const lookup: Lookup = (id) => {
      const found = this.store.get(id);
      return found && (!files || files.visible(found.id)) ? found : null;
    };
    const project = this.store.get(submission.projectId);
    if (project?.type !== 'project')
      return { v, status: 'not_found', message: 'That project no longer exists' };
    const view = this.store.get(submission.viewId);
    if (view?.type !== 'view' || (view as Entity<'view'>).data.projectId !== project.id)
      return { v, status: 'not_found', message: 'That page is no longer in this project; reload' };
    const widget = effectiveBoard(view as Entity<'view'>).widgets.find(
      (w) => w.id === submission.widgetId,
    );
    const def = widget && actionIn(widget.node);
    if (!def)
      return {
        v,
        status: 'not_found',
        message: 'That page no longer has this action; reload it',
      };
    const { form, problems } = actionForm(def, project as Entity<'project'>);
    if (!form)
      return {
        v,
        status: 'failed',
        message: `"${def.label}" can't be used on this project: ${problems.join('; ')}`,
      };
    if (form.kind === 'done' && submission.recordId) {
      const target = lookup(submission.recordId);
      if (
        target?.type === 'record' &&
        (target.data as { projectId: string }).projectId !== project.id
      )
        return { v, status: 'not_found', message: 'That record is in another project' };
    }
    // A record someone changed since the form was filled is stale before anything else: the
    // person sees what changed, not errors worked out against values they never saw.
    const target =
      form.kind === 'done' && submission.recordId ? lookup(submission.recordId) : undefined;
    if (
      target?.type === 'record' &&
      (target.data as { recordType: string }).recordType === form.type.key &&
      submission.expectedRevision !== undefined &&
      target.updatedRev !== submission.expectedRevision
    ) {
      const record = target as Entity<'record'>;
      return {
        v,
        status: 'stale',
        message: `“${record.data.title}” changed since the form was opened; check it and send again`,
        current: {
          recordId: record.id,
          revision: record.updatedRev,
          title: record.data.title,
          ...(record.data.interval?.lastDate ? { lastDate: record.data.interval.lastDate } : {}),
        },
      };
    }
    const errors = submissionErrors(form, submission, lookup);
    if (form.kind === 'done' && submission.expectedRevision === undefined && !errors.recordId)
      errors.form =
        "expectedRevision is required: the record's updatedRev when the form was filled";
    if (Object.keys(errors).length)
      return invalid(
        `Check ${Object.keys(errors).length === 1 ? 'this field' : 'these fields'}`,
        errors,
      );

    if (!this.reserve(submission.idempotencyKey, project.id, fingerprint)) {
      const raced = this.row(submission.idempotencyKey);
      if (raced) return this.replay(raced, fingerprint, submission.projectId);
    }
    try {
      const records = this.store.list('record', { projectId: project.id });
      const plan = actionOperations(def, form, submission, records, lookup);
      const applied = this.store.apply(author, {
        message: plan.message,
        operations: plan.operations,
      });
      const recordId =
        plan.recordId === '$action' ? (applied.created.action ?? plan.recordId) : plan.recordId;
      const changed = applied.changes.filter((c) => c.type === 'record');
      const done: ActionDone = {
        v,
        status: 'done',
        revision: applied.revision?.id ?? null,
        recordId,
        created: changed.filter((c) => c.op === 'create').map((c) => c.id),
        updated: changed.filter((c) => c.op === 'update').map((c) => c.id),
        message: applied.revision ? plan.message : 'Nothing changed: it was already recorded',
      };
      this.settle(submission.idempotencyKey, done);
      return done;
    } catch (err) {
      // Nothing was written: the key is free again, so the same form can be sent once more.
      this.release(submission.idempotencyKey);
      if (err instanceof PharosError) {
        if (err.code === 'not_found') return { v, status: 'not_found', message: err.message };
        if (err.code === 'conflict')
          return { v, status: 'failed', message: `${err.message}; reload and try again` };
        return invalid('Pharos refused the change', storeErrors(err));
      }
      console.error('[pharos] An action failed:', err);
      return {
        v,
        status: 'failed',
        message: 'Saving failed; nothing was changed. Try again',
      };
    }
  }
}

/** Every Action block on a project's pages, for agents (project_snapshot). */
export function projectActions(store: Store, projectId: string) {
  return store
    .list('view', { projectId })
    .filter((view) => !view.data.archived)
    .flatMap((view) =>
      effectiveBoard(view).widgets.flatMap((w) => {
        const def = actionIn(w.node);
        return def
          ? [
              {
                viewId: view.id,
                widgetId: w.id,
                label: def.label,
                does: def.does ?? 'create',
                recordType: def.recordType,
              },
            ]
          : [];
      }),
    );
}
