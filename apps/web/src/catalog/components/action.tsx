import {
  ACTION_VERSION,
  actionForm,
  currencyDigits,
  dueOf,
  isMoney,
  logValue,
  meterField,
  submissionErrors,
  type ActionDef,
  type ActionForm as Form,
  type ActionFormField,
  type ActionResult,
  type ActionSubmission,
  type Entity,
  type NodeOf,
} from '@pharos/schema';
import clsx from 'clsx';
import { AlertTriangle, Check, ClipboardX, Loader2, Plus, X } from 'lucide-react';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { formatDate, localToday } from '../../lib/format';
import { useBoardActions } from '../action-board';
import { useWidgetId } from '../board-files';
import { useViewData, type ViewData } from '../context';
import { AskAgentButton, EmptyState } from '../empty-state';
import { BUTTON } from '../ui';
import { useInDocument } from '../variant';

/**
 * An Action block (R10): a button and a short form built from a record type's fields, e.g.
 * "Log a service" or "Mark paid". The form keeps its own state (what was typed, pending, field
 * errors); sending it is one store write, one revision the page's toast can undo. On a phone the
 * form is a bottom sheet. Everything works by keyboard: the form takes focus, Escape closes it,
 * and focus returns to the button that opened it.
 */

const INPUT =
  'w-full min-h-10 rounded-control border border-line-strong bg-surface px-2.5 py-1.5 text-base outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200 aria-invalid:border-rose-400 sm:min-h-0 sm:text-sm dark:focus:border-sky-700 dark:focus:ring-sky-900 dark:aria-invalid:border-rose-700';

/** A fresh idempotency key: one per opened form, sent with every retry of it. */
function newKey(): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `form-${random}`;
}

/** Money as the form shows it: "12.50" for 1250 cents. */
function moneyText(value: unknown): string {
  if (!isMoney(value)) return '';
  const digits = currencyDigits(value.currency);
  return (value.amount / 10 ** digits).toFixed(digits);
}

/** What the form sends for one field, from what was typed (a bad value goes as typed). */
function typed(field: ActionFormField, raw: string | undefined): unknown {
  const text = raw?.trim() ?? '';
  if (!text) return undefined;
  switch (field.kind) {
    case 'number':
    case 'meter': {
      const n = Number(text.replace(',', '.'));
      return Number.isFinite(n) ? n : text;
    }
    case 'money': {
      const clean = text.replace(/[\s_]/g, '').replace(',', '.');
      if (!/^-?\d+(\.\d+)?$/.test(clean)) return text;
      const currency = field.currency ?? 'EUR';
      return { amount: Math.round(Number(clean) * 10 ** currencyDigits(currency)), currency };
    }
    default:
      return text;
  }
}

/** Records a reference or picker can choose from, most urgent first for repeating ones. */
function choices(data: ViewData, field: ActionFormField) {
  if (field.kind === 'file')
    return (data.files ?? []).map((f) => ({ value: f.id, label: f.data.title }));
  const records = (data.records ?? []).filter((r) => r.data.recordType === field.to);
  if (field.kind !== 'record') return records.map((r) => ({ value: r.id, label: r.data.title }));
  return records
    .filter((r) => r.data.interval)
    .map((r) => ({ record: r, due: dueOf(data, r) }))
    .sort((a, b) => (a.due?.date ?? '9999').localeCompare(b.due?.date ?? '9999'))
    .map(({ record, due }) => ({
      value: record.id,
      label: `${record.data.title}${due?.date ? ` · due ${formatDate(due.date, true)}` : ''}`,
    }));
}

/** The values a form opens with: today for dates, the only choice for a reference. */
function initialValues(form: Form, data: ViewData, recordId?: string): Record<string, string> {
  const values: Record<string, string> = {};
  const today = localToday();
  for (const field of form.fields) {
    if (field.kind === 'date') values[field.key] = today;
    if (field.kind === 'reference') {
      const options = choices(data, field);
      if (options.length === 1) values[field.key] = options[0]!.value;
    }
  }
  if (recordId) values.recordId = recordId;
  return values;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'stale'; message: string }
  | { kind: 'error'; message: string };

export function ActionForm({
  def,
  form,
  widgetId,
  viewId,
  recordId,
  onClose,
}: {
  def: ActionDef;
  form: Form;
  widgetId: string;
  viewId: string;
  recordId?: string;
  onClose: () => void;
}) {
  const data = useViewData();
  const titleId = useId();
  const [values, setValues] = useState(() => initialValues(form, data, recordId));
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  // One key for this form: a retry (after a network error or a refusal) sends the same one.
  const [key] = useState(newKey);
  const picked =
    form.kind === 'done' && values.recordId
      ? (data.entityById.get(values.recordId) as Entity<'record'> | undefined)
      : undefined;
  // The record as it was when picked: if someone changes it meanwhile, the save is refused.
  const [expected, setExpected] = useState<{ id: string; revision: number } | null>(null);
  useEffect(() => {
    if (picked && expected?.id !== picked.id)
      setExpected({ id: picked.id, revision: picked.updatedRev });
  }, [picked, expected]);
  // Log fields start from the record marked done (the bill's amount), until the person types.
  useEffect(() => {
    if (!picked || !def.log) return;
    setValues((v) => {
      const next = { ...v };
      for (const key of def.log!.ask ?? []) {
        if (touched.has(key)) continue;
        const value = logValue(def.log!.fields[key] ?? '', picked, v.date);
        next[key] = isMoney(value) ? moneyText(value) : value === undefined ? '' : String(value);
      }
      return next;
    });
  }, [picked, def.log, touched]);
  const fields = useMemo(
    () => [...form.fields, ...(picked ? meterField(picked.data.interval, form.type) : [])],
    [form, picked],
  );

  const panel = useRef<HTMLFormElement>(null);
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('input, select, textarea')?.focus();
  }, []);
  const pending = status.kind === 'pending';
  const close = () => {
    if (!pending) onClose();
  };

  const submission = (): ActionSubmission => {
    const out: Record<string, unknown> = {};
    for (const field of fields) {
      if (field.key === 'title' || field.key === 'recordId') continue;
      const value = typed(field, values[field.key]);
      if (value !== undefined) out[field.key] = value;
    }
    return {
      v: ACTION_VERSION,
      projectId: data.project.id,
      viewId,
      widgetId,
      ...(form.kind === 'done' && values.recordId ? { recordId: values.recordId } : {}),
      ...(form.kind === 'create' && values.title?.trim() ? { title: values.title.trim() } : {}),
      values: out as ActionSubmission['values'],
      idempotencyKey: key,
      ...(form.kind === 'done' && expected ? { expectedRevision: expected.revision } : {}),
    };
  };

  const focusFirstError = (found: Record<string, string>) => {
    const first = fields.find((f) => found[f.key]);
    if (first) panel.current?.querySelector<HTMLElement>(`[name="${first.key}"]`)?.focus();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending || !data.actions.act) return;
    const sending = submission();
    const lookup = (id: string) => data.entityById.get(id);
    const local = submissionErrors({ ...form, fields }, sending, lookup);
    setErrors(local);
    if (Object.keys(local).length) {
      setStatus({ kind: 'idle' });
      focusFirstError(local);
      return;
    }
    setStatus({ kind: 'pending' });
    let result: ActionResult;
    try {
      result = await data.actions.act(sending);
    } catch {
      setStatus({
        kind: 'error',
        message: "Couldn't reach Pharos. Nothing was saved; try again.",
      });
      return;
    }
    switch (result.status) {
      case 'done':
      case 'duplicate':
        onClose();
        return;
      case 'invalid': {
        const { form: whole, ...byField } = result.fieldErrors;
        setErrors(byField);
        setStatus(whole ? { kind: 'error', message: whole } : { kind: 'idle' });
        focusFirstError(byField);
        return;
      }
      case 'stale':
        // Show what it is now and send again with that revision, if it still applies.
        setExpected({ id: result.current.recordId, revision: result.current.revision });
        setStatus({
          kind: 'stale',
          message: `${result.message}${result.current.lastDate ? ` It was last done on ${formatDate(result.current.lastDate, true)}.` : ''} Send again to save it anyway.`,
        });
        return;
      default:
        setStatus({ kind: 'error', message: result.message });
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
    // Keep Tab inside the form while it is open.
    if (e.key === 'Tab' && panel.current) {
      const focusable = [
        ...panel.current.querySelectorAll<HTMLElement>(
          'input, select, textarea, button:not([disabled])',
        ),
      ];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  };

  const set = (key: string, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    setTouched((t) => new Set(t).add(key));
    if (errors[key])
      setErrors(({ [key]: _gone, ...rest }) => {
        void _gone;
        return rest;
      });
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div
        className="absolute inset-0 bg-neutral-900/30 dark:bg-black/50"
        onClick={close}
        aria-hidden
      />
      <form
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={pending || undefined}
        noValidate
        onSubmit={(e) => void submit(e)}
        onKeyDown={onKeyDown}
        data-sheet
        className="relative max-h-[88vh] w-full overflow-y-auto rounded-t-block bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-overlay sm:max-w-md sm:rounded-block sm:p-5"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-neutral-300 sm:hidden dark:bg-neutral-700" />
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold">
              {def.label}
            </h2>
            {def.description && <p className="text-sm text-muted">{def.description}</p>}
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="-m-1 rounded-control p-2 text-muted hover:bg-subtle hover:text-ink"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <div className="space-y-3">
          {fields.map((field) => (
            <FieldInput
              key={field.key}
              field={field}
              value={values[field.key] ?? ''}
              error={errors[field.key]}
              onChange={(v) => set(field.key, v)}
              data={data}
              disabled={pending}
            />
          ))}
        </div>
        {(status.kind === 'stale' || status.kind === 'error') && (
          <p
            role="alert"
            className={clsx(
              'mt-3 flex items-start gap-2 rounded-tile px-3 py-2 text-sm',
              status.kind === 'stale'
                ? 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
                : 'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200',
            )}
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{status.message}</span>
          </p>
        )}
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={close}
            disabled={pending}
            className={clsx(BUTTON.secondary, 'min-h-10 sm:min-h-0')}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending || !data.actions.act}
            className={clsx(BUTTON.primary, 'min-h-10 sm:min-h-0')}
          >
            {pending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Check className="size-3.5" aria-hidden />
            )}
            {pending ? 'Saving…' : status.kind === 'stale' ? 'Send again' : 'Save'}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

function FieldInput({
  field,
  value,
  error,
  onChange,
  data,
  disabled,
}: {
  field: ActionFormField;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  data: ViewData;
  disabled: boolean;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const common = {
    id,
    name: field.key,
    disabled,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? errorId : undefined,
    'aria-required': field.required || undefined,
  } as const;
  let input: ReactNode;
  if (
    field.kind === 'option' ||
    field.kind === 'reference' ||
    field.kind === 'file' ||
    field.kind === 'record'
  ) {
    const options = field.kind === 'option' ? (field.options ?? []) : choices(data, field);
    input = (
      <select
        {...common}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT}
      >
        <option value="">{field.required ? 'Choose…' : '—'}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  } else {
    const suffix = field.kind === 'money' ? (field.currency ?? 'EUR') : field.unit;
    input = (
      <div className="flex items-center gap-2">
        <input
          {...common}
          type={field.kind === 'date' ? 'date' : 'text'}
          inputMode={
            field.kind === 'money' || field.kind === 'number' || field.kind === 'meter'
              ? 'decimal'
              : undefined
          }
          autoComplete="off"
          placeholder={field.kind === 'money' ? '0.00' : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={INPUT}
        />
        {suffix && <span className="shrink-0 text-sm text-muted">{suffix}</span>}
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-ink-soft">
        {field.label}
        {!field.required && field.key !== 'title' && (
          <span className="font-normal text-faint"> (optional)</span>
        )}
        {field.key === 'title' && <span className="font-normal text-faint"> (optional)</span>}
      </label>
      {input}
      {error && (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** Opens an action's form from any button (the block's own, or a DueTracker row's). */
export function useActionForm(def: NodeOf<'Action'> | undefined, widgetId: string | undefined) {
  const data = useViewData();
  const { viewId } = useBoardActions();
  const [open, setOpen] = useState<{ recordId?: string; from: HTMLElement | null } | null>(null);
  const built = useMemo(
    () => (def ? actionForm(def, data.project) : undefined),
    [def, data.project],
  );
  const usable = Boolean(built?.form && viewId && widgetId && data.actions.act);
  const start = (recordId?: string) =>
    setOpen({ recordId, from: document.activeElement as HTMLElement | null });
  const element =
    open && def && built?.form && viewId && widgetId ? (
      <ActionForm
        def={def}
        form={built.form}
        widgetId={widgetId}
        viewId={viewId}
        recordId={open.recordId}
        onClose={() => {
          // Back to the button that opened it, so the keyboard stays where it was.
          const from = open.from;
          setOpen(null);
          requestAnimationFrame(() => from?.isConnected && from.focus());
        }}
      />
    ) : null;
  return { usable, problems: built?.problems ?? [], start, element };
}

export function Action({ node }: { node: NodeOf<'Action'> }) {
  const widgetId = useWidgetId() ?? undefined;
  const { usable, problems, start, element } = useActionForm(node, widgetId);
  // A report document (R14) is read-only: it says what the action is, without the form.
  const readOnly = useInDocument();
  if (readOnly)
    return node.description ? <p className="text-sm text-muted">{node.description}</p> : null;
  if (problems.length)
    return (
      <EmptyState
        icon={ClipboardX}
        title={`“${node.label}” can’t be used here`}
        hint={`${problems.join('; ')}.`}
      >
        <AskAgentButton
          question={`Fix the “${node.label}” action on this page: ${problems.join('; ')}.`}
        />
      </EmptyState>
    );
  const Icon = node.does === 'done' ? Check : Plus;
  return (
    <div className="flex h-full flex-col justify-center gap-2">
      {node.description && <p className="text-sm text-muted">{node.description}</p>}
      <button
        type="button"
        onClick={() => start()}
        disabled={!usable}
        title={usable ? undefined : 'Open this page in Pharos to use it'}
        className={clsx(BUTTON.primary, 'min-h-10 w-full sm:w-auto sm:self-start')}
      >
        <Icon className="size-4" aria-hidden /> {node.label}
      </button>
      {element}
    </div>
  );
}

/** A DueTracker row's button for its done Action (R10), with that record picked. */
export function RowAction({
  actionId,
  recordId,
  title,
}: {
  actionId: string;
  recordId: string;
  title: string;
}) {
  const def = useBoardActions().action(actionId);
  const { usable, start, element } = useActionForm(def, actionId);
  const readOnly = useInDocument();
  if (!def || !usable || readOnly) return null;
  return (
    <>
      <button
        type="button"
        data-no-open
        onClick={() => start(recordId)}
        aria-label={`${def.label}: ${title}`}
        className={clsx(BUTTON.secondary, 'min-h-10 shrink-0 px-2 text-xs sm:min-h-0')}
      >
        <Check className="size-3.5" aria-hidden /> {def.label}
      </button>
      {element}
    </>
  );
}
