/**
 * @prismshift/parser — .bprelease XML → IR. Schema-version tolerant
 * (ARCHITECTURE §4).
 */
export const PACKAGE_NAME = '@prismshift/parser';

export { parseBpRelease } from './parse';
export type { ParseOptions, ParseProgress } from './chunked';
export type { ParseIssue, ParseResult } from './parse';
