import { ReportDoc } from '@pharos/schema';
import { describe, expect, it } from 'vitest';
import { EXAMPLE_DOCS, REPORT_EXAMPLES } from './report-examples.js';
import { readerChecks } from './views/reader-checks.js';

describe('report examples (pharos://examples/reports)', () => {
  it('are valid documents that pass every reader check', () => {
    for (const doc of EXAMPLE_DOCS) {
      expect(() => ReportDoc.parse(doc)).not.toThrow();
      expect(readerChecks(doc)).toEqual([]);
    }
  });

  it('show weak and strong side by side, and never a local link in an example', () => {
    expect(REPORT_EXAMPLES).toContain('| Weak');
    for (const doc of EXAMPLE_DOCS)
      expect(JSON.stringify(doc)).not.toMatch(/localhost|127\.0\.0\.1/);
  });
});
