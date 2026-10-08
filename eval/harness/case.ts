import { readFileSync } from 'node:fs';
import { isAbsolute, normalize, resolve } from 'node:path';

export type HarnessActor = 'runner' | 'observer' | 'agent' | 'human';

export interface HarnessCase {
  id: string;
  version: string;
  label: string;
  workflow: 'A';
  fixture: {
    path: string;
    variant: string;
    /** SHA-256 emitted by eval/fixtures/load.ts for this logical fixture. */
    checksum: string;
    /** Fixture ref key as emitted in the loader's `refs` map (without `$`). */
    projectRef: string;
    semanticDate: string;
    timezone: string;
  };
  request: {
    question: string;
    about?: string;
    viewId?: string;
    widgetId?: string;
    aboutId?: string;
  };
  timeoutMs: number;
  starting: {
    screen: string;
    state: string;
    seedViewProvenance: string;
    semanticDateStrategy: string;
    optionMeanings: Record<string, Record<string, string>>;
    preparation: {
      actions: string[];
      dismissedRequestRefs: string[];
      snapshotBoundary: string;
      outsideTimedWindow: boolean;
    };
  };
  script: {
    t0: string;
    tEnd: string;
    steps: Array<{
      id: string;
      actor: HarnessActor;
      action: string;
      purpose: 'planned' | 'observation' | 'capture';
      waitMs?: number;
    }>;
    normalWaitMs: number;
    answerOpenPolicy: string;
    persistenceBoundary: string;
    undoPath: string;
    correctionPolicy: { maxAttempts: number; description: string };
  };
  useful: {
    targetView: { kind: 'answer'; linkedBy: string; projectRef: string };
    milestone: string;
    checks: Array<{
      id: string;
      method: string;
      factCheckIds: string[];
      expected: string;
    }>;
    renderCapture: {
      mode: 'painted-browser' | 'persisted-rest' | 'none';
      painted: boolean;
      evidence: string;
      limitation: string;
      viewport: null | { width: number; height: number; zoom: string };
      headless: boolean;
    };
  };
  fact_checks: Array<{
    id: string;
    checkpoint: string;
    widgetId: string;
    expectedRefs: string[];
    derivation: string;
  }>;
  completion: {
    predicates: Array<{ id: string; condition: string; checkIds: string[] }>;
    deadlineMs: number;
    maxCorrections: number;
    terminalFailureBehavior: string;
    humanReview: string;
    humanReviewStatus: 'pending' | 'complete' | 'not-applicable';
    extraClaimAudit: string;
  };
  capture: {
    clock: { source: 'monotonic'; implementation: string; resolution: string };
    sources: { agentLog: string; revisions: string; viewSpec: string; requestTrace: string };
    adapters: { toolCalls: string; tokens: string; cost: string };
    rawEvidenceLocations: string[];
    reviewers: { requiredSlots: number; status: 'pending' | 'complete' | 'not-applicable' };
    limitations: string[];
  };
}

type ObjectValue = Record<string, unknown>;

function objectValue(value: unknown, field: string): ObjectValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as ObjectValue;
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a nonempty string`);
  }
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return stringValue(value, field);
}

function numberValue(value: unknown, field: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
    throw new Error(`${field} must be a number greater than or equal to ${minimum}`);
  }
  return value;
}

function stringArray(value: unknown, field: string, requireItems = false): string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  if (requireItems && value.length === 0) throw new Error(`${field} must not be empty`);
  return value.map((item, index) => stringValue(item, `${field}[${index}]`));
}

function stringMap(value: unknown, field: string): Record<string, string> {
  const record = objectValue(value, field);
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, stringValue(item, `${field}.${key}`)]),
  );
}

function optionMeaningMap(value: unknown, field: string): Record<string, Record<string, string>> {
  const record = objectValue(value, field);
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => [key, stringMap(item, `${field}.${key}`)]),
  );
}

function validateRepoRelativePath(value: unknown, field: string): string {
  const result = stringValue(value, field);
  if (
    result.includes('\\') ||
    isAbsolute(result) ||
    normalize(result).startsWith('..') ||
    result === '.'
  ) {
    throw new Error(`${field} must be a repository-relative path`);
  }
  return result;
}

/** Validate the case-file shape from W1.5 and return a typed case definition. */
export function validateCase(value: unknown): HarnessCase {
  const root = objectValue(value, 'case');
  if (root.workflow !== 'A') throw new Error('case.workflow must be "A"');

  const fixture = objectValue(root.fixture, 'case.fixture');
  const checksum = stringValue(fixture.checksum, 'case.fixture.checksum');
  if (!/^(?:sha256:)?[a-f0-9]{64}$/.test(checksum)) {
    throw new Error('case.fixture.checksum must be a lowercase SHA-256 digest');
  }
  const semanticDate = stringValue(fixture.semanticDate, 'case.fixture.semanticDate');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(semanticDate)) {
    throw new Error('case.fixture.semanticDate must use YYYY-MM-DD');
  }

  const request = objectValue(root.request, 'case.request');
  const requestContext: HarnessCase['request'] = {
    question: stringValue(request.question, 'case.request.question'),
  };
  for (const key of ['about', 'viewId', 'widgetId', 'aboutId'] as const) {
    const context = optionalString(request[key], `case.request.${key}`);
    if (context !== undefined) requestContext[key] = context;
  }

  const starting = objectValue(root.starting, 'case.starting');
  const preparation = objectValue(starting.preparation, 'case.starting.preparation');
  if (typeof preparation.outsideTimedWindow !== 'boolean') {
    throw new Error('case.starting.preparation.outsideTimedWindow must be a boolean');
  }
  const script = objectValue(root.script, 'case.script');
  const correctionPolicy = objectValue(script.correctionPolicy, 'case.script.correctionPolicy');
  if (!Array.isArray(script.steps) || script.steps.length === 0) {
    throw new Error('case.script.steps must be a nonempty array');
  }
  const steps = script.steps.map((value, index) => {
    const step = objectValue(value, `case.script.steps[${index}]`);
    const actor = stringValue(step.actor, `case.script.steps[${index}].actor`);
    if (!['runner', 'observer', 'agent', 'human'].includes(actor)) {
      throw new Error(`case.script.steps[${index}].actor is unsupported`);
    }
    const purpose = stringValue(step.purpose, `case.script.steps[${index}].purpose`);
    if (!['planned', 'observation', 'capture'].includes(purpose)) {
      throw new Error(`case.script.steps[${index}].purpose is unsupported`);
    }
    const waitMs =
      step.waitMs === undefined
        ? undefined
        : numberValue(step.waitMs, `case.script.steps[${index}].waitMs`);
    return {
      id: stringValue(step.id, `case.script.steps[${index}].id`),
      actor: actor as HarnessActor,
      action: stringValue(step.action, `case.script.steps[${index}].action`),
      purpose: purpose as 'planned' | 'observation' | 'capture',
      ...(waitMs === undefined ? {} : { waitMs }),
    };
  });

  const useful = objectValue(root.useful, 'case.useful');
  const targetView = objectValue(useful.targetView, 'case.useful.targetView');
  if (targetView.kind !== 'answer') throw new Error('case.useful.targetView.kind must be "answer"');
  const usefulChecksValue = useful.checks;
  if (!Array.isArray(usefulChecksValue) || usefulChecksValue.length === 0) {
    throw new Error('case.useful.checks must be a nonempty array');
  }
  const usefulChecks = usefulChecksValue.map((value, index) => {
    const check = objectValue(value, `case.useful.checks[${index}]`);
    return {
      id: stringValue(check.id, `case.useful.checks[${index}].id`),
      method: stringValue(check.method, `case.useful.checks[${index}].method`),
      factCheckIds: stringArray(check.factCheckIds, `case.useful.checks[${index}].factCheckIds`),
      expected: stringValue(check.expected, `case.useful.checks[${index}].expected`),
    };
  });
  const renderCapture = objectValue(useful.renderCapture, 'case.useful.renderCapture');
  const renderMode = stringValue(renderCapture.mode, 'case.useful.renderCapture.mode');
  if (!['painted-browser', 'persisted-rest', 'none'].includes(renderMode)) {
    throw new Error('case.useful.renderCapture.mode is unsupported');
  }
  if (typeof renderCapture.painted !== 'boolean') {
    throw new Error('case.useful.renderCapture.painted must be a boolean');
  }
  if (typeof renderCapture.headless !== 'boolean') {
    throw new Error('case.useful.renderCapture.headless must be a boolean');
  }
  let viewport: HarnessCase['useful']['renderCapture']['viewport'] = null;
  if (renderCapture.viewport !== null) {
    const viewportValue = objectValue(renderCapture.viewport, 'case.useful.renderCapture.viewport');
    viewport = {
      width: numberValue(viewportValue.width, 'case.useful.renderCapture.viewport.width', 1),
      height: numberValue(viewportValue.height, 'case.useful.renderCapture.viewport.height', 1),
      zoom: stringValue(viewportValue.zoom, 'case.useful.renderCapture.viewport.zoom'),
    };
  }

  if (!Array.isArray(root.fact_checks) || root.fact_checks.length === 0) {
    throw new Error('case.fact_checks must be a nonempty array');
  }
  const factChecks = root.fact_checks.map((value, index) => {
    const check = objectValue(value, `case.fact_checks[${index}]`);
    return {
      id: stringValue(check.id, `case.fact_checks[${index}].id`),
      checkpoint: stringValue(check.checkpoint, `case.fact_checks[${index}].checkpoint`),
      widgetId: stringValue(check.widgetId, `case.fact_checks[${index}].widgetId`),
      expectedRefs: stringArray(check.expectedRefs, `case.fact_checks[${index}].expectedRefs`),
      derivation: stringValue(check.derivation, `case.fact_checks[${index}].derivation`),
    };
  });

  const completion = objectValue(root.completion, 'case.completion');
  const humanReviewStatus = stringValue(
    completion.humanReviewStatus,
    'case.completion.humanReviewStatus',
  );
  if (!['pending', 'complete', 'not-applicable'].includes(humanReviewStatus)) {
    throw new Error('case.completion.humanReviewStatus is unsupported');
  }
  if (!Array.isArray(completion.predicates) || completion.predicates.length === 0) {
    throw new Error('case.completion.predicates must be a nonempty array');
  }
  const predicates = completion.predicates.map((value, index) => {
    const predicate = objectValue(value, `case.completion.predicates[${index}]`);
    return {
      id: stringValue(predicate.id, `case.completion.predicates[${index}].id`),
      condition: stringValue(predicate.condition, `case.completion.predicates[${index}].condition`),
      checkIds: stringArray(predicate.checkIds, `case.completion.predicates[${index}].checkIds`),
    };
  });

  const capture = objectValue(root.capture, 'case.capture');
  const clock = objectValue(capture.clock, 'case.capture.clock');
  if (clock.source !== 'monotonic')
    throw new Error('case.capture.clock.source must be "monotonic"');
  const sources = objectValue(capture.sources, 'case.capture.sources');
  const adapters = objectValue(capture.adapters, 'case.capture.adapters');
  const reviewers = objectValue(capture.reviewers, 'case.capture.reviewers');
  const reviewerStatus = stringValue(reviewers.status, 'case.capture.reviewers.status');
  if (!['pending', 'complete', 'not-applicable'].includes(reviewerStatus)) {
    throw new Error('case.capture.reviewers.status is unsupported');
  }

  const timeoutMs = numberValue(root.timeoutMs, 'case.timeoutMs', 1);
  const deadlineMs = numberValue(completion.deadlineMs, 'case.completion.deadlineMs', 1);
  if (!Number.isInteger(timeoutMs) || !Number.isInteger(deadlineMs)) {
    throw new Error('case.timeoutMs and case.completion.deadlineMs must be integers');
  }

  return {
    id: stringValue(root.id, 'case.id'),
    version: stringValue(root.version, 'case.version'),
    label: stringValue(root.label, 'case.label'),
    workflow: 'A',
    fixture: {
      path: validateRepoRelativePath(fixture.path, 'case.fixture.path'),
      variant: stringValue(fixture.variant, 'case.fixture.variant'),
      checksum,
      projectRef: stringValue(fixture.projectRef, 'case.fixture.projectRef'),
      semanticDate,
      timezone: stringValue(fixture.timezone, 'case.fixture.timezone'),
    },
    request: requestContext,
    timeoutMs,
    starting: {
      screen: stringValue(starting.screen, 'case.starting.screen'),
      state: stringValue(starting.state, 'case.starting.state'),
      seedViewProvenance: stringValue(
        starting.seedViewProvenance,
        'case.starting.seedViewProvenance',
      ),
      semanticDateStrategy: stringValue(
        starting.semanticDateStrategy,
        'case.starting.semanticDateStrategy',
      ),
      optionMeanings: optionMeaningMap(starting.optionMeanings, 'case.starting.optionMeanings'),
      preparation: {
        actions: stringArray(preparation.actions, 'case.starting.preparation.actions'),
        dismissedRequestRefs: stringArray(
          preparation.dismissedRequestRefs,
          'case.starting.preparation.dismissedRequestRefs',
        ),
        snapshotBoundary: stringValue(
          preparation.snapshotBoundary,
          'case.starting.preparation.snapshotBoundary',
        ),
        outsideTimedWindow: preparation.outsideTimedWindow,
      },
    },
    script: {
      t0: stringValue(script.t0, 'case.script.t0'),
      tEnd: stringValue(script.tEnd, 'case.script.tEnd'),
      steps,
      normalWaitMs: numberValue(script.normalWaitMs, 'case.script.normalWaitMs'),
      answerOpenPolicy: stringValue(script.answerOpenPolicy, 'case.script.answerOpenPolicy'),
      persistenceBoundary: stringValue(
        script.persistenceBoundary,
        'case.script.persistenceBoundary',
      ),
      undoPath: stringValue(script.undoPath, 'case.script.undoPath'),
      correctionPolicy: {
        maxAttempts: numberValue(
          correctionPolicy.maxAttempts,
          'case.script.correctionPolicy.maxAttempts',
        ),
        description: stringValue(
          correctionPolicy.description,
          'case.script.correctionPolicy.description',
        ),
      },
    },
    useful: {
      targetView: {
        kind: 'answer',
        linkedBy: stringValue(targetView.linkedBy, 'case.useful.targetView.linkedBy'),
        projectRef: stringValue(targetView.projectRef, 'case.useful.targetView.projectRef'),
      },
      milestone: stringValue(useful.milestone, 'case.useful.milestone'),
      checks: usefulChecks,
      renderCapture: {
        mode: renderMode as 'painted-browser' | 'persisted-rest' | 'none',
        painted: renderCapture.painted,
        evidence: stringValue(renderCapture.evidence, 'case.useful.renderCapture.evidence'),
        limitation: stringValue(renderCapture.limitation, 'case.useful.renderCapture.limitation'),
        viewport,
        headless: renderCapture.headless,
      },
    },
    fact_checks: factChecks,
    completion: {
      predicates,
      deadlineMs,
      maxCorrections: numberValue(completion.maxCorrections, 'case.completion.maxCorrections'),
      terminalFailureBehavior: stringValue(
        completion.terminalFailureBehavior,
        'case.completion.terminalFailureBehavior',
      ),
      humanReview: stringValue(completion.humanReview, 'case.completion.humanReview'),
      humanReviewStatus: humanReviewStatus as 'pending' | 'complete' | 'not-applicable',
      extraClaimAudit: stringValue(completion.extraClaimAudit, 'case.completion.extraClaimAudit'),
    },
    capture: {
      clock: {
        source: 'monotonic',
        implementation: stringValue(clock.implementation, 'case.capture.clock.implementation'),
        resolution: stringValue(clock.resolution, 'case.capture.clock.resolution'),
      },
      sources: {
        agentLog: stringValue(sources.agentLog, 'case.capture.sources.agentLog'),
        revisions: stringValue(sources.revisions, 'case.capture.sources.revisions'),
        viewSpec: stringValue(sources.viewSpec, 'case.capture.sources.viewSpec'),
        requestTrace: stringValue(sources.requestTrace, 'case.capture.sources.requestTrace'),
      },
      adapters: {
        toolCalls: stringValue(adapters.toolCalls, 'case.capture.adapters.toolCalls'),
        tokens: stringValue(adapters.tokens, 'case.capture.adapters.tokens'),
        cost: stringValue(adapters.cost, 'case.capture.adapters.cost'),
      },
      rawEvidenceLocations: stringArray(
        capture.rawEvidenceLocations,
        'case.capture.rawEvidenceLocations',
      ),
      reviewers: {
        requiredSlots: numberValue(
          reviewers.requiredSlots,
          'case.capture.reviewers.requiredSlots',
          2,
        ),
        status: reviewerStatus as 'pending' | 'complete' | 'not-applicable',
      },
      limitations: stringArray(capture.limitations, 'case.capture.limitations'),
    },
  };
}

/** Read and validate a UTF-8 JSON case file; relative paths resolve from the repo cwd. */
export function readCase(casePath: string): HarnessCase {
  const absolutePath = resolve(casePath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(absolutePath, 'utf8')) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read case file ${casePath}: ${detail}`, { cause: error });
  }
  try {
    return validateCase(parsed);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid case file ${casePath}: ${detail}`, { cause: error });
  }
}
