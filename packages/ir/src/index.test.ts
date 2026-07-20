import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index';

describe('@prismshift/ir scaffold', () => {
  it('exports its package name', () => {
    expect(PACKAGE_NAME).toBe('@prismshift/ir');
  });
});
