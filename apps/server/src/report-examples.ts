import type { ReportDoc } from '@pharos/schema';

/**
 * Worked report documents the owner's bar is measured against (pharos://examples/reports): two
 * made-up reports written to the pattern of the reports the owner accepted, each with why it
 * works, and the weak versions next to the strong ones. Weaker models copy a concrete example
 * far better than they follow rules. Made-up data only: the repository is public. Tested to pass
 * the reader checks (views/reader-checks.ts).
 */

/** A status report with asks: what changed, where it stands, what needs the reader. */
export const STATUS_EXAMPLE = {
  summary: 'The shop app is ready for its first 50 testers; one choice and one key wait on you.',
  blocks: [
    {
      kind: 'block',
      id: 'lead',
      node: {
        component: 'Text',
        content:
          '# The shop app is ready for 50 testers\n\n**3 of 4 launch checks pass** · **0 crashes** in 120 test orders · **2 things need you** (about 7 min). The one failing check is the refund email, fixed and waiting for your look. (Sources: the launch checks and test orders in this project.)',
      },
    },
    {
      kind: 'figure',
      id: 'checkout',
      layout: 'pair',
      items: [
        {
          src: 'shots/checkout-before.png',
          alt: 'Checkout on a phone: the pay button hidden under the keyboard',
          caption: '**Before.** The pay button sat under the keyboard.',
        },
        {
          src: 'shots/checkout-after.png',
          alt: 'Checkout on a phone: the pay button above the keyboard',
          caption: '**After.** It stays above the keyboard.',
        },
      ],
    },
    {
      kind: 'sheet',
      id: 'testers',
      title: 'Invite the first 50 testers?',
      time: '2 min',
      tags: ['ask'],
      decisions: ['dec_example_testers'],
      related: ['dec_example_scope'],
      blocks: [
        {
          kind: 'block',
          id: 'testers-why',
          node: {
            component: 'Text',
            content:
              '**What.** Send the invite to the 50 people on the waiting list.\n\n**Why now.** Every launch check but the refund email passes, and that one has a fix ready.',
          },
        },
        {
          kind: 'block',
          id: 'testers-ask',
          node: { component: 'DecisionBlock', decision: 'dec_example_testers' },
        },
      ],
    },
    {
      kind: 'sheet',
      id: 'key',
      title: 'Paste the payment key',
      time: '5 min',
      tags: ['gate'],
      blocks: [
        {
          kind: 'steps',
          id: 'key-steps',
          items: [
            {
              text: 'Open the payment dashboard → Developers → API keys.',
              expect: 'A test key starting with "sk_test".',
            },
            { text: 'Paste it when asked.', command: '! shop-cli secrets set PAYMENT_KEY' },
          ],
        },
      ],
    },
    {
      kind: 'details',
      id: 'how',
      summary: 'How the checks were run',
      blocks: [
        {
          kind: 'block',
          id: 'how-t',
          node: {
            component: 'Text',
            content:
              '120 test orders on two phones and one laptop, each check run twice. The refund email check failed on the first run only.',
          },
        },
      ],
    },
    {
      kind: 'block',
      id: 'honest',
      node: {
        component: 'Callout',
        tone: 'info',
        body: "**Not checked yet:** real cards (test mode only) and orders from outside the country. A tester's first real order is the next proof.",
      },
    },
  ],
} as const;

/** An explanation: one finding, shown, sourced and bounded. */
export const FINDING_EXAMPLE = {
  summary: 'Most returns come from one size chart, not from quality.',
  blocks: [
    {
      kind: 'block',
      id: 'lead',
      node: {
        component: 'Text',
        content:
          '# Most returns are about size, not quality\n\n**64%** of 180 returns say "too small" or "too big" · **9%** mention quality · **one chart** (jackets) explains half of the size returns. (Source: the return notes in this project, July to September.)',
      },
    },
    {
      kind: 'block',
      id: 'reasons',
      node: {
        component: 'DataTable',
        title: 'Why people returned things',
        query: { type: 'record', where: { recordType: 'return' } },
        columns: [{ field: 'fields.reason' }, { field: 'fields.item' }],
      },
    },
    {
      kind: 'block',
      id: 'next',
      node: {
        component: 'Text',
        content:
          '## Fixing the jacket chart would cut returns by about a third\n\nThe jacket chart lists chest size only; most "too small" notes mention the shoulders.',
      },
    },
    {
      kind: 'block',
      id: 'by-item',
      node: {
        component: 'CountChart',
        title: 'Jackets bring half of the size returns',
        query: { type: 'record', where: { recordType: 'return', 'fields.reason': 'size' } },
        by: 'fields.item',
      },
    },
    {
      kind: 'block',
      id: 'honest',
      node: {
        component: 'Callout',
        tone: 'info',
        body: "**What this doesn't show:** returns without a note (about a quarter) and anything before July. If notes are biased toward size, quality could matter more than it looks.",
      },
    },
  ],
} as const;

export const EXAMPLE_DOCS: ReportDoc[] = [
  STATUS_EXAMPLE as unknown as ReportDoc,
  FINDING_EXAMPLE as unknown as ReportDoc,
];

const json = (v: unknown) => JSON.stringify(v, null, 2);

export const REPORT_EXAMPLES = `# Report examples: the bar, shown

Two made-up reports written to the pattern of the reports the owner accepted. Copy their shape,
not their words. Every report is checked by view_preview ("Reader check: …" warnings); these pass.

## Weak and strong, side by side

| Weak (owners rejected these) | Strong |
|---|---|
| "## Summary" (a topic) | "## Fixing the jacket chart would cut returns by about a third" (a claim) |
| A lead that lists what the agents did ("Updated tasks, reconciled records, ran checks…") | The claim and 3–5 numbers about the subject ("**3 of 4 launch checks pass** · **0 crashes**…") |
| One 900-character paragraph | One or two sentences, then a table, a figure or a details block |
| "## Done since last report" with every answered item repeated | Nothing: answered sheets fold by themselves; a new sheet links what it follows up on with \`related\` |
| A diagram whose connector lines run through its labels | Lines between boxes, or around them; check the drawing at 390 px |
| Links to \`http://localhost:4300/projects/…\` | Links to \`/projects/…\` (they work wherever Pharos is hosted) |
| A sheet asking "Mark this done" with no other way to answer | A decision with options (one tap), or a task (the reader can also say won't do, later, or reply) |
| No word on what is unknown | An honesty box: what this doesn't show, and what would change the conclusion |

## 1 · A status report with asks

Why it works: the headline is the state ("ready for 50 testers"); the numbers say why; a before
and after shows the change instead of describing it; each ask is a sheet with its time, the
decision it asks, and \`related\` pointing at the earlier decision it builds on; a gate (a secret)
is steps the reader runs, never something done on their behalf; the method hides in details; the
honesty box says what isn't proven.

\`\`\`json
${json(STATUS_EXAMPLE)}
\`\`\`

## 2 · An explanation of one finding

Why it works: one claim, its numbers with their source, the evidence as a table the reader can
scan, a second heading that is itself a claim (what to do and what it would change), and the
limits.

\`\`\`json
${json(FINDING_EXAMPLE)}
\`\`\`
`;
