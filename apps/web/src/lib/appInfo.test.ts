import { describe, expect, it } from 'vitest';
import { APP_NAME, DEFAULT_MODE, modeLabel } from './appInfo';

describe('appInfo', () => {
  it('names the app PrismShift', () => {
    expect(APP_NAME).toBe('PrismShift');
  });

  it('defaults to Local Mode (privacy-first invariant)', () => {
    expect(DEFAULT_MODE).toBe('local');
  });

  it('labels both operating modes', () => {
    expect(modeLabel('local')).toBe('Local Mode');
    expect(modeLabel('workspace')).toBe('Workspace Mode');
  });
});
