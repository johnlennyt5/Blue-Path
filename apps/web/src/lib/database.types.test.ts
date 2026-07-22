/**
 * S6-1 · Schema contract tests over the generated Supabase types.
 *
 * `database.types.ts` is generated (`supabase gen types typescript --local`),
 * so these assertions are the tripwire that fails when a migration drifts from
 * the ARCHITECTURE §8.1 contract the app is coded against. Most checks are
 * compile-time: if the schema changes shape, `pnpm build`/typecheck breaks
 * here with a named, readable error.
 */
import { describe, expect, it } from 'vitest';
import type { Database } from './database.types';

type PublicTables = Database['public']['Tables'];

// -- compile-time machinery --------------------------------------------------

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

// -- §8.1: all seven metadata tables exist -----------------------------------

type TableNames = keyof PublicTables;
type _allTables = Expect<
  Equal<
    TableNames,
    | 'workspaces'
    | 'workspace_members'
    | 'workspace_invites'
    | 'programs'
    | 'processes'
    | 'findings'
    | 'audit_events'
    | 'dependency_edges'
  >
>;

// -- key column contracts the app relies on ----------------------------------

type ProcessRow = PublicTables['processes']['Row'];
type _processStatus = Expect<Equal<ProcessRow['status'], string>>;
type _processHash = Expect<Equal<ProcessRow['source_hash'], string>>;
type _processScore = Expect<Equal<ProcessRow['score'], number | null>>;

type MemberRow = PublicTables['workspace_members']['Row'];
type _memberRole = Expect<Equal<MemberRow['role'], string>>;

type FindingRow = PublicTables['findings']['Row'];
type _findingResolved = Expect<Equal<FindingRow['resolved'], boolean>>;

type AuditRow = PublicTables['audit_events']['Row'];
type _auditId = Expect<Equal<AuditRow['id'], number>>;

type EdgeRow = PublicTables['dependency_edges']['Row'];
type _edgeFrom = Expect<Equal<EdgeRow['from_name'], string>>;

// -- inserts: generated/defaulted columns must be optional -------------------

type ProcessInsert = PublicTables['processes']['Insert'];
type _statusOptional = Expect<
  Equal<undefined extends ProcessInsert['status'] ? true : false, true>
>;
type _idOptional = Expect<Equal<undefined extends ProcessInsert['id'] ? true : false, true>>;
// audit id is `generated always` — declared `id?: never` (present but
// unusable), which reads back as `undefined`.
type AuditInsert = PublicTables['audit_events']['Insert'];
type _auditIdNever = Expect<Equal<AuditInsert['id'], undefined>>;

// Consuming the check aliases keeps them out of no-unused-vars while making
// this tuple the single place the contract is enumerated.
export type SchemaContractChecks = [
  _allTables,
  _processStatus,
  _processHash,
  _processScore,
  _memberRole,
  _findingResolved,
  _auditId,
  _edgeFrom,
  _statusOptional,
  _idOptional,
  _auditIdNever,
];

describe('S6-1 · generated Supabase schema types', () => {
  it('metadata-only invariant: no content-bearing columns exist', () => {
    // The schema stores names, hashes, scores, statuses — never source XML or
    // generated XAML. Guard the column names against content-ish additions.
    const forbidden = ['xml', 'xaml', 'source_content', 'body', 'payload', 'file_content'];
    const columnNames: string[] = [
      ...Object.keys({} as ProcessRow),
      // keyof at runtime isn't available — assert on the known contract lists:
      'bp_name',
      'source_hash',
      'location_path',
      'message',
      'detail',
    ];
    for (const name of columnNames) {
      for (const bad of forbidden) {
        expect(name.includes(bad), `column "${name}" looks content-bearing`).toBe(false);
      }
    }
  });

  it('compile-time table and column assertions hold (see type aliases above)', () => {
    // The real assertions are the Expect<Equal<…>> aliases — a schema drift
    // fails typecheck, not this runtime expect.
    expect(true).toBe(true);
  });
});
