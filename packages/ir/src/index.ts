/**
 * @prismshift/ir — Intermediate Representation types, graph utilities,
 * traversal, and validation. Depends on nothing (ARCHITECTURE §2–3).
 */
export const PACKAGE_NAME = '@prismshift/ir';

export type * from './types';
export { walkStages, buildDependencyGraph, validateModel } from './graph';
export type { StageVisit, ValidationIssue } from './graph';
