import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index';

describe('@prismshift/corpus scaffold', () => {
  it('exports its package name', () => {
    expect(PACKAGE_NAME).toBe('@prismshift/corpus');
  });
});
