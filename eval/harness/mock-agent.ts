import { readFileSync } from 'node:fs';

// Synthetic transcript records are stdout: shellRunner supplies its real header/footer.
const emit = (record: Record<string, unknown>) =>
  console.log(`PHAROS_EVAL:${JSON.stringify({ version: 1, ...record })}`);
const mode = process.env.PHAROS_EVAL_MOCK ?? 'success';
const url = process.env.PHAROS_URL!;
const projectId = process.env.PHAROS_PROJECT_IDS!;
const requestId = process.env.PHAROS_REQUEST_IDS!;
const refs = JSON.parse(readFileSync(process.env.PHAROS_EVAL_REFS!, 'utf8')) as Record<
  string,
  string
>;
if (mode === 'timeout') await new Promise((resolve) => setTimeout(resolve, 600_000));
if (mode === 'agent_refusal') {
  emit({ type: 'diagnostic', classification: 'agent_refusal', message: 'Synthetic refusal' });
} else {
  const body =
    mode === 'query_error'
      ? {
          message: 'Synthetic rejected query',
          operations: [
            {
              op: 'create',
              type: 'view',
              data: {
                projectId,
                name: 'Invalid',
                spec: {
                  component: 'DataTable',
                  query: { type: 'unknown-entity' },
                  columns: [{ field: 'title' }],
                },
              },
            },
          ],
        }
      : {
          message: 'Synthetic harness answer',
          operations: [
            {
              op: 'create',
              type: 'view',
              ref: 'answer',
              data: {
                projectId,
                name: 'Synthetic risk answer',
                kind: 'answer',
                question: "What's blocked or at risk right now?",
                spec: {
                  component: 'Board',
                  widgets: [
                    {
                      id: 'risks',
                      node: {
                        component: 'DataTable',
                        title: 'At-risk tasks',
                        query: {
                          type: 'task',
                          where: {
                            id: (mode === 'wrong_facts'
                              ? ['cd_foundation_schema']
                              : [
                                  'cd_explicit_block',
                                  'cd_overdue_docs',
                                  'cd_integration',
                                  'cd_later_smoke',
                                ]
                            ).map((ref) => refs[ref]),
                          },
                        },
                        columns: [{ field: 'title' }, { field: 'status' }],
                      },
                    },
                  ],
                },
              },
            },
            {
              op: 'update',
              type: 'request',
              id: requestId,
              data: { status: 'answered', answerViewId: '$answer' },
            },
          ],
        };
  const response = await fetch(`${url}/api/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-pharos-author': 'agent:evaluation-mock' },
    body: JSON.stringify(body),
  });
  emit({
    type: 'tool_attempt',
    invocation_id: 'mock-1',
    call_id: 'apply-1',
    dispatch_attempt: 1,
    tool_name: 'apply',
    server: 'pharos',
    outcome: response.ok ? 'success' : 'error',
  });
  console.log(await response.text());
  if (!response.ok)
    emit({ type: 'diagnostic', classification: 'query_error', message: 'Mock apply rejected' });
}
emit({
  type: 'model_usage',
  request_id: 'mock-request-1',
  final: true,
  input_uncached: 100,
  cache_read_input: 20,
  cache_write_input: 10,
  output: 40,
  actual_cost_usd: 0.001,
  model_id: 'synthetic/mock-v1',
  provider: 'synthetic',
});
emit({
  type: 'capture_end',
  tool_attempts_complete: true,
  model_usage_complete: true,
  billing_complete: true,
});
