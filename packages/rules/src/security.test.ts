import { describe, expect, it } from 'vitest';
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
