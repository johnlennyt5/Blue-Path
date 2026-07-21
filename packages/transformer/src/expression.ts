/**
 * Minimal expression bridging for the core mapping tier (S4-3): rewrites
 * `[Data Item]` references to their VB identifiers. The full BP-expression →
 * VB.NET translator (function map, operator fidelity, 200+ cases) is S5-1 —
 * anything this pass is unsure about is surfaced as an issue, never silently
 * dropped.
 */
import { sanitizeIdentifier } from './naming';

export interface TranslatedExpression {
  vb: string;
  /** Human-readable concerns; non-empty means "needs review" (punch list). */
  issues: string[];
}

export function translateExpression(
  raw: string,
  identifierFor: (itemName: string) => string | undefined,
): TranslatedExpression {
  const issues: string[] = [];

  const vb = raw.replace(/\[([^\]]+)\]/g, (_match, refRaw: string) => {
    const ref = refRaw.trim();
    const dot = ref.indexOf('.');

    if (dot === -1) {
      const known = identifierFor(ref);
      if (known !== undefined) return known;
      issues.push(`Unknown data item reference [${ref}]`);
      return sanitizeIdentifier(ref);
    }

    // Collection field access ([Coll.Field]) — row-context semantics are an
    // S5-1 concern; emit a visible best-effort and flag it.
    const base = ref.slice(0, dot);
    const field = ref.slice(dot + 1);
    const baseId = identifierFor(base) ?? sanitizeIdentifier(base);
    issues.push(`Collection field reference [${ref}] needs row-context review (S5-1)`);
    return `${baseId}("${field}")`;
  });

  return { vb, issues };
}
