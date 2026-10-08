/**
 * Metrics adapter for structured records embedded in `agent.log`.
 *
 * Adapter wire format (one JSON object per line):
 *   PHAROS_EVAL:{"version":1,"type":"tool_attempt",...}
 *   PHAROS_EVAL:{"version":1,"type":"model_usage",...}
 *   PHAROS_EVAL:{"version":1,"type":"diagnostic",...}
 *   PHAROS_EVAL:{"version":1,"type":"capture_end",...}
 *
 * Tool attempts are keyed by (invocation_id, call_id, dispatch_attempt), so a
 * repeated record for a streamed result does not inflate the count. Model
 * usage records are finalized, per-request records with already-disjoint
 * input_uncached, cache_read_input, cache_write_input, and output token
 * counts. The adapter must preserve provider raw records separately and must
 * not include cumulative session totals in these per-request records.
 * A single capture_end record describes completeness for the whole run.
 */

const RECORD_PREFIX = 'PHAROS_EVAL:';
const ADAPTER_VERSION = 1;

export type AgentFailureDiagnostic = 'query_error' | 'agent_refusal';
export type CaptureCompleteness = 'complete' | 'incomplete' | 'unavailable';

export interface ExtractedMetrics {
  toolCalls: {
    total: number | null;
    knownCount: number;
    pharos: number | null;
    other: number | null;
    success: number | null;
    error: number | null;
    byTool: Record<string, { total: number; success: number; error: number }>;
    completeness: CaptureCompleteness;
  };
  tokens: {
    inputUncached: number | null;
    cacheReadInput: number | null;
    cacheWriteInput: number | null;
    inputTotal: number | null;
    output: number | null;
    total: number | null;
    reasoningOutput: number | null;
    knownSubtotal: {
      inputUncached: number | null;
      cacheReadInput: number | null;
      cacheWriteInput: number | null;
      inputTotal: number | null;
      output: number | null;
      total: number | null;
    };
    completeness: CaptureCompleteness;
  };
  cost: {
    actualUsd: number | null;
    knownActualSubtotalUsd: number | null;
    estimatedUsd: number | null;
    completeness: CaptureCompleteness;
  };
  /** The last explicit adapter diagnostic, suitable for run classification. */
  failureClass: AgentFailureDiagnostic | null;
  diagnostics: Array<{
    classification: AgentFailureDiagnostic;
    message?: string;
  }>;
  /** Malformed or contradictory adapter records make the affected captures incomplete. */
  adapterErrors: string[];
}

interface ToolAttempt {
  version: 1;
  type: 'tool_attempt';
  invocation_id: string;
  call_id: string;
  dispatch_attempt: string | number;
  tool_name: string;
  server: 'pharos' | 'other';
  outcome: 'success' | 'error';
}

interface ModelUsage {
  version: 1;
  type: 'model_usage';
  request_id: string;
  final: true;
  input_uncached: number;
  cache_read_input: number;
  cache_write_input: number;
  output: number;
  reasoning_output?: number;
  actual_cost_usd?: number;
}

interface DiagnosticRecord {
  version: 1;
  type: 'diagnostic';
  classification: AgentFailureDiagnostic;
  message?: string;
}

interface CaptureEnd {
  version: 1;
  type: 'capture_end';
  tool_attempts_complete: boolean;
  model_usage_complete: boolean;
  billing_complete: boolean;
}

type AdapterRecord = ToolAttempt | ModelUsage | DiagnosticRecord | CaptureEnd;

type ParsedAttempt = ToolAttempt;

interface UsageTotals {
  inputUncached: number;
  cacheReadInput: number;
  cacheWriteInput: number;
  inputTotal: number;
  output: number;
  total: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isUsd(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function adapterRecord(value: unknown): AdapterRecord | null {
  if (!isObject(value) || value.version !== ADAPTER_VERSION || typeof value.type !== 'string') {
    return null;
  }

  if (value.type === 'tool_attempt') {
    if (
      !isNonEmptyString(value.invocation_id) ||
      !isNonEmptyString(value.call_id) ||
      !(isNonEmptyString(value.dispatch_attempt) || isCount(value.dispatch_attempt)) ||
      !isNonEmptyString(value.tool_name) ||
      (value.server !== 'pharos' && value.server !== 'other') ||
      (value.outcome !== 'success' && value.outcome !== 'error')
    ) {
      return null;
    }
    return value as unknown as ToolAttempt;
  }

  if (value.type === 'model_usage') {
    if (
      !isNonEmptyString(value.request_id) ||
      value.final !== true ||
      !isCount(value.input_uncached) ||
      !isCount(value.cache_read_input) ||
      !isCount(value.cache_write_input) ||
      !isCount(value.output) ||
      (value.reasoning_output !== undefined && !isCount(value.reasoning_output)) ||
      (value.actual_cost_usd !== undefined && !isUsd(value.actual_cost_usd))
    ) {
      return null;
    }
    return value as unknown as ModelUsage;
  }

  if (value.type === 'diagnostic') {
    if (
      (value.classification !== 'query_error' && value.classification !== 'agent_refusal') ||
      (value.message !== undefined && typeof value.message !== 'string')
    ) {
      return null;
    }
    return value as unknown as DiagnosticRecord;
  }

  if (value.type === 'capture_end') {
    if (
      typeof value.tool_attempts_complete !== 'boolean' ||
      typeof value.model_usage_complete !== 'boolean' ||
      typeof value.billing_complete !== 'boolean'
    ) {
      return null;
    }
    return value as unknown as CaptureEnd;
  }

  return null;
}

function attemptKey(record: ToolAttempt): string {
  return JSON.stringify([record.invocation_id, record.call_id, record.dispatch_attempt]);
}

function sameAttempt(left: ToolAttempt, right: ToolAttempt): boolean {
  return (
    left.tool_name === right.tool_name &&
    left.server === right.server &&
    left.outcome === right.outcome
  );
}

function sameUsage(left: ModelUsage, right: ModelUsage): boolean {
  return (
    left.input_uncached === right.input_uncached &&
    left.cache_read_input === right.cache_read_input &&
    left.cache_write_input === right.cache_write_input &&
    left.output === right.output &&
    left.reasoning_output === right.reasoning_output &&
    left.actual_cost_usd === right.actual_cost_usd
  );
}

function zeroResult(): ExtractedMetrics {
  return {
    toolCalls: {
      total: 0,
      knownCount: 0,
      pharos: 0,
      other: 0,
      success: 0,
      error: 0,
      byTool: {},
      completeness: 'complete',
    },
    tokens: {
      inputUncached: 0,
      cacheReadInput: 0,
      cacheWriteInput: 0,
      inputTotal: 0,
      output: 0,
      total: 0,
      reasoningOutput: 0,
      knownSubtotal: {
        inputUncached: 0,
        cacheReadInput: 0,
        cacheWriteInput: 0,
        inputTotal: 0,
        output: 0,
        total: 0,
      },
      completeness: 'complete',
    },
    cost: {
      actualUsd: 0,
      knownActualSubtotalUsd: 0,
      estimatedUsd: 0,
      completeness: 'complete',
    },
    failureClass: null,
    diagnostics: [],
    adapterErrors: [],
  };
}

function emptyTotals(): UsageTotals {
  return {
    inputUncached: 0,
    cacheReadInput: 0,
    cacheWriteInput: 0,
    inputTotal: 0,
    output: 0,
    total: 0,
  };
}

function addUsage(totals: UsageTotals, usage: ModelUsage): void {
  totals.inputUncached += usage.input_uncached;
  totals.cacheReadInput += usage.cache_read_input;
  totals.cacheWriteInput += usage.cache_write_input;
  totals.inputTotal += usage.input_uncached + usage.cache_read_input + usage.cache_write_input;
  totals.output += usage.output;
  totals.total +=
    usage.input_uncached + usage.cache_read_input + usage.cache_write_input + usage.output;
}

function totalsAreSafe(totals: UsageTotals): boolean {
  return Object.values(totals).every((value) => Number.isSafeInteger(value));
}

/**
 * Extract the normalized metrics adapter records from `agent.log`.
 *
 * `noAgent` means the caller has independently verified that the run had no
 * agent phase (for example, answering was explicitly disabled). In that case
 * the W1.5 policy permits complete zero counts. Otherwise absent structured
 * capture stays null rather than being represented as zero.
 */
export function extractMetrics(log: string, noAgent = false): ExtractedMetrics {
  if (noAgent) {
    const result = zeroResult();
    result.diagnostics = readDiagnostics(log, result.adapterErrors);
    result.failureClass = result.diagnostics.at(-1)?.classification ?? null;
    return result;
  }

  const adapterErrors: string[] = [];
  const attempts = new Map<string, ParsedAttempt>();
  const conflictedAttempts = new Set<string>();
  const usageByRequest = new Map<string, ModelUsage>();
  const conflictedRequests = new Set<string>();
  const diagnostics: ExtractedMetrics['diagnostics'] = [];
  const captureEnds: CaptureEnd[] = [];
  let malformedToolRecord = false;
  let malformedUsageRecord = false;
  let malformedUnknownRecord = false;
  let conflictingCaptureEnds = false;

  for (const [lineIndex, line] of log.split(/\r?\n/).entries()) {
    const markerIndex = line.indexOf(RECORD_PREFIX);
    if (markerIndex === -1) continue;

    const serialized = line.slice(markerIndex + RECORD_PREFIX.length).trim();
    let decoded: unknown;
    try {
      decoded = JSON.parse(serialized) as unknown;
    } catch {
      adapterErrors.push(`line ${lineIndex + 1}: invalid adapter JSON`);
      malformedUnknownRecord = true;
      continue;
    }

    const record = adapterRecord(decoded);
    if (!record) {
      const type = isObject(decoded) && typeof decoded.type === 'string' ? decoded.type : 'unknown';
      adapterErrors.push(`line ${lineIndex + 1}: invalid or unsupported ${type} record`);
      if (type === 'tool_attempt') malformedToolRecord = true;
      if (type === 'model_usage') malformedUsageRecord = true;
      malformedUnknownRecord = true;
      continue;
    }

    if (record.type === 'tool_attempt') {
      const key = attemptKey(record);
      const previous = attempts.get(key);
      if (previous && !sameAttempt(previous, record)) {
        conflictedAttempts.add(key);
        adapterErrors.push(`line ${lineIndex + 1}: conflicting tool attempt ${record.call_id}`);
      } else if (!previous) {
        attempts.set(key, record);
      }
    } else if (record.type === 'model_usage') {
      const previous = usageByRequest.get(record.request_id);
      if (previous && !sameUsage(previous, record)) {
        conflictedRequests.add(record.request_id);
        adapterErrors.push(`line ${lineIndex + 1}: conflicting model usage ${record.request_id}`);
      } else if (!previous) {
        usageByRequest.set(record.request_id, record);
      }
    } else if (record.type === 'diagnostic') {
      diagnostics.push({
        classification: record.classification,
        ...(record.message ? { message: record.message } : {}),
      });
    } else {
      captureEnds.push(record);
    }
  }

  const captureEnd = captureEnds.at(-1);
  if (
    captureEnds.length > 1 &&
    captureEnds.some(
      (record) =>
        record.tool_attempts_complete !== captureEnd?.tool_attempts_complete ||
        record.model_usage_complete !== captureEnd?.model_usage_complete ||
        record.billing_complete !== captureEnd?.billing_complete,
    )
  ) {
    conflictingCaptureEnds = true;
    adapterErrors.push('conflicting capture_end records');
  }
  if (!captureEnd) adapterErrors.push('missing capture_end record');

  const uniqueAttempts = [...attempts.entries()]
    .filter(([key]) => !conflictedAttempts.has(key))
    .map(([, value]) => value);
  const toolsComplete =
    Boolean(captureEnd?.tool_attempts_complete) &&
    !malformedToolRecord &&
    !malformedUnknownRecord &&
    !conflictingCaptureEnds &&
    conflictedAttempts.size === 0;
  const toolCountByServer = uniqueAttempts.reduce(
    (counts, attempt) => {
      counts[attempt.server] += 1;
      return counts;
    },
    { pharos: 0, other: 0 },
  );
  const toolCountByOutcome = uniqueAttempts.reduce(
    (counts, attempt) => {
      counts[attempt.outcome] += 1;
      return counts;
    },
    { success: 0, error: 0 },
  );
  const byTool: Record<string, { total: number; success: number; error: number }> = {};
  for (const attempt of uniqueAttempts) {
    const key = `${attempt.server}/${attempt.tool_name}`;
    const counts = byTool[key] ?? { total: 0, success: 0, error: 0 };
    counts.total += 1;
    counts[attempt.outcome] += 1;
    byTool[key] = counts;
  }

  const validUsages = [...usageByRequest.entries()]
    .filter(([requestId]) => !conflictedRequests.has(requestId))
    .map(([, usage]) => usage);
  const rawKnownTotals = emptyTotals();
  let reasoningKnown = true;
  let reasoningOutput = 0;
  let knownActualSubtotalUsd = 0;
  let actualCostRecordCount = 0;
  for (const usage of validUsages) {
    addUsage(rawKnownTotals, usage);
    if (usage.reasoning_output === undefined) reasoningKnown = false;
    else reasoningOutput += usage.reasoning_output;
    if (usage.actual_cost_usd !== undefined) {
      actualCostRecordCount += 1;
      knownActualSubtotalUsd += usage.actual_cost_usd;
    }
  }
  const totalsSafe = totalsAreSafe(rawKnownTotals);
  if (!totalsSafe) adapterErrors.push('token subtotal exceeded the safe integer range');
  const usageComplete =
    Boolean(captureEnd?.model_usage_complete) &&
    !malformedUsageRecord &&
    !malformedUnknownRecord &&
    !conflictingCaptureEnds &&
    conflictedRequests.size === 0 &&
    totalsSafe;
  const billingComplete = Boolean(captureEnd?.billing_complete) && usageComplete;
  const allActualCostsPresent = validUsages.every((usage) => usage.actual_cost_usd !== undefined);
  const actualCostAvailable = billingComplete && allActualCostsPresent;
  const noBillableRequests = validUsages.length === 0 && usageComplete;

  const tokensCompleteness: CaptureCompleteness = usageComplete
    ? 'complete'
    : usageByRequest.size > 0 ||
        malformedUsageRecord ||
        malformedUnknownRecord ||
        conflictedRequests.size > 0 ||
        captureEnd?.model_usage_complete === false ||
        conflictingCaptureEnds
      ? 'incomplete'
      : 'unavailable';
  const costCompleteness: CaptureCompleteness =
    actualCostAvailable || noBillableRequests
      ? 'complete'
      : !captureEnd ||
          captureEnd.billing_complete === false ||
          !usageComplete ||
          actualCostRecordCount > 0
        ? 'incomplete'
        : 'unavailable';

  const subtotal = totalsSafe
    ? rawKnownTotals
    : {
        inputUncached: null,
        cacheReadInput: null,
        cacheWriteInput: null,
        inputTotal: null,
        output: null,
        total: null,
      };
  const allTokenValues = usageComplete ? rawKnownTotals : null;

  return {
    toolCalls: {
      total: toolsComplete ? uniqueAttempts.length : null,
      knownCount: uniqueAttempts.length,
      pharos: toolsComplete ? toolCountByServer.pharos : null,
      other: toolsComplete ? toolCountByServer.other : null,
      success: toolsComplete ? toolCountByOutcome.success : null,
      error: toolsComplete ? toolCountByOutcome.error : null,
      byTool,
      completeness: toolsComplete
        ? 'complete'
        : attempts.size > 0 ||
            malformedToolRecord ||
            malformedUnknownRecord ||
            captureEnd?.tool_attempts_complete === false ||
            conflictingCaptureEnds
          ? 'incomplete'
          : 'unavailable',
    },
    tokens: {
      inputUncached: allTokenValues?.inputUncached ?? null,
      cacheReadInput: allTokenValues?.cacheReadInput ?? null,
      cacheWriteInput: allTokenValues?.cacheWriteInput ?? null,
      inputTotal: allTokenValues?.inputTotal ?? null,
      output: allTokenValues?.output ?? null,
      total: allTokenValues?.total ?? null,
      reasoningOutput: usageComplete && reasoningKnown ? reasoningOutput : null,
      knownSubtotal: subtotal,
      completeness: tokensCompleteness,
    },
    cost: {
      actualUsd: actualCostAvailable
        ? knownActualSubtotalUsd
        : noBillableRequests && billingComplete
          ? 0
          : null,
      knownActualSubtotalUsd: actualCostRecordCount > 0 ? knownActualSubtotalUsd : null,
      // An estimated cost requires the dated, frozen provider rate card.
      estimatedUsd: null,
      completeness: costCompleteness,
    },
    failureClass: diagnostics.at(-1)?.classification ?? null,
    diagnostics,
    adapterErrors,
  };
}

function readDiagnostics(log: string, errors: string[]): ExtractedMetrics['diagnostics'] {
  const diagnostics: ExtractedMetrics['diagnostics'] = [];
  for (const [lineIndex, line] of log.split(/\r?\n/).entries()) {
    const markerIndex = line.indexOf(RECORD_PREFIX);
    if (markerIndex === -1) continue;
    const serialized = line.slice(markerIndex + RECORD_PREFIX.length).trim();
    let decoded: unknown;
    try {
      decoded = JSON.parse(serialized) as unknown;
    } catch {
      continue;
    }
    const record = adapterRecord(decoded);
    if (record?.type === 'diagnostic') {
      diagnostics.push({
        classification: record.classification,
        ...(record.message ? { message: record.message } : {}),
      });
    } else if (line.includes('"type":"diagnostic"') && !record) {
      errors.push(`line ${lineIndex + 1}: invalid diagnostic record`);
    }
  }
  return diagnostics;
}
