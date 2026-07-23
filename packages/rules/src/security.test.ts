import { describe, expect, it } from 'vitest';
import { loadSample } from '@prismshift/corpus';
import { parseBpRelease } from '@prismshift/parser';
import { ALL_RULES, runRules } from './index';
import { identifierRefs, wholeLiteral } from './helpers';

describe('expression helpers', () => {
  it('extracts identifier references incl. collection fields', () => {
    expect(identifierRefs('"SSN " & [Customer SSN] & [Records.Account Number]')).toEqual([
      'Customer SSN',
      'Records.Account Number',
    ]);
    expect(identifierRefs('"no refs here"')).toEqual([]);
  });

  it('recognizes whole string literals only', () => {
    expect(wholeLiteral('"Invoices Queue"')).toBe('Invoices Queue');
    expect(wholeLiteral('  "padded"  ')).toBe('padded');
    expect(wholeLiteral('[Queue Name]')).toBeNull();
    expect(wholeLiteral('"a" & "b"')).toBeNull();
    expect(wholeLiteral('')).toBeNull();
  });
});

describe('BL-019 · SEC-004 message rendering', () => {
  it('UNC paths render with single backslashes, not JSON-escaped doubles', async () => {
    const { xml } = await loadSample('03-the-monolith');
    const { model } = await parseBpRelease(xml);
    const { findings } = runRules(model, ALL_RULES);
    const uncFinding = findings.find(
      (f) => f.ruleId === 'SEC-004' && f.message.includes('fs01'),
    );
    expect(uncFinding).toBeDefined();
    expect(uncFinding!.message).toContain('\\\\fs01\\exports');
    expect(uncFinding!.message).not.toContain('\\\\\\\\fs01');
  });
});
