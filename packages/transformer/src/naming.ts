import type { BpDataType } from '@prismshift/ir';
import type { XamlType } from './xaml';

/** BP display names → valid VB identifiers ("Monthly Payment" → Monthly_Payment). */
export function sanitizeIdentifier(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const identifier = cleaned === '' ? 'Item' : cleaned;
  return /^[0-9]/.test(identifier) ? `_${identifier}` : identifier;
}

/** BP display names → workflow file names ("Calculate Payment" → Calculate_Payment.xaml). */
export function sanitizeFileName(name: string): string {
  return sanitizeIdentifier(name);
}

/** Hands out unique identifiers — sanitization can collide ("A B" vs "A_B"). */
export class IdentifierAllocator {
  private used = new Set<string>();

  claim(base: string): string {
    let name = base;
    let suffix = 2;
    while (this.used.has(name)) {
      name = `${base}_${suffix}`;
      suffix += 1;
    }
    this.used.add(name);
    return name;
  }
}

/** BP data types → UiPath types (ARCHITECTURE §7.1). */
export function bpTypeToXaml(type: BpDataType): XamlType {
  switch (type) {
    case 'text':
    case 'password':
    case 'time':
    case 'timespan':
      return 'String';
    case 'number':
      return 'Double';
    case 'flag':
      return 'Boolean';
    case 'date':
    case 'datetime':
      return 'DateTime';
    case 'collection':
      return 'DataTable';
    case 'image':
    case 'binary':
      return 'Object';
  }
}
