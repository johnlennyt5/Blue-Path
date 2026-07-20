# PrismShift — Architecture Specification

**Version:** 1.0 · **Status:** Draft for build · **Stack:** TypeScript / React / Supabase

---

## 1. System Overview

PrismShift is a privacy-first web platform that converts Blue Prism release exports into analyzed, documented, and (largely) transformed UiPath projects. The defining architectural constraint is that **pipeline content is processed client-side**; the Supabase backend exists to support team workflow (auth, migration tracking, audit history) using **metadata only**.

```
┌─────────────────────────── BROWSER (client-side) ───────────────────────────┐
│                                                                             │
│  .bprelease ──▶ Parser ──▶ IR (graph) ──▶ Rules Engine ──▶ Findings         │
│                              │                                │             │
│                              ├──▶ Summary Generator ──▶ Docs  │             │
│                              │                                ▼             │
│                              └──▶ Transformer ──▶ XAML ──▶ ZIP Export       │
│                                                        └─▶ Audit PDF       │
│                                                                             │
└───────────────┬─────────────────────────────────────────────┬───────────────┘
                │ (Workspace Mode: metadata only)             │ (opt-in toggle)
                ▼                                             ▼
        ┌──────────────┐                              ┌──────────────────┐
        │   SUPABASE   │                              │  Edge Function   │
        │ Auth · PG/RLS│                              │  llm-proxy ──▶ AI │
        │ (metadata)   │                              │  (Anthropic API) │
        └──────────────┘                              └──────────────────┘
```

### 1.1 Operating Modes

| | Local Mode (default) | Workspace Mode (opt-in) |
|---|---|---|
| Auth | None required | Supabase Auth (email/SSO) |
| Pipeline content | Browser memory only | Browser memory only (unchanged) |
| Persisted server-side | Nothing | Metadata: process names, hashes, scores, findings, statuses, effort estimates |
| Team dashboard | Single-session, in-memory | Full multi-user tracker + history |
| AI documentation | Off unless toggled | Off unless toggled; routed via Edge Function |

**Invariant:** no code path uploads raw `.bprelease` XML or generated XAML to Supabase unless the workspace admin enables the separate *Encrypted Artifact Storage* feature flag (client-side AES-GCM encryption before upload; keys never leave the workspace).

---

## 2. Monorepo & Package Architecture

pnpm workspaces + Turborepo. Core logic is isolated in framework-free TypeScript packages so it runs identically in the browser, in Node (CLI later), and in Vitest.

| Package | Responsibility | Key exports |
|---|---|---|
| `@prismshift/ir` | Intermediate Representation types, graph utilities, traversal, validation | `AutomationModel`, `ProcessNode`, `walkStages()`, `buildDependencyGraph()` |
| `@prismshift/parser` | `.bprelease` XML → IR. Schema-version tolerant (BP 6.x / 7.x) | `parseBpRelease(xml: string): ParseResult` |
| `@prismshift/rules` | Vulnerability/quality rules engine. Each rule = pure function over IR | `runRules(model, ruleset): Finding[]`, `scoreProcess()` |
| `@prismshift/transformer` | IR → UiPath XAML + project.json + REFramework scaffolding | `transform(model, opts): UiPathProject` |
| `@prismshift/reports` | Audit report generation (HTML → PDF via browser print pipeline), migration report | `buildAuditReport()`, `buildMigrationReport()` |
| `@prismshift/corpus` | Synthetic `.bprelease` samples + JSON answer keys; corpus test harness | sample files, `expectFindings()` helper |
| `apps/web` | React UI, Supabase client, state, exports | — |

Dependency direction is strictly one-way: `web → reports → transformer → rules → parser → ir`. `ir` depends on nothing.

---

## 3. Intermediate Representation (IR)

The IR is a normalized graph model decoupled from both vendors. All analysis and transformation operate on it exclusively.

```typescript
// @prismshift/ir — abbreviated
export interface AutomationModel {
  meta: ReleaseMeta;                 // bpVersion, exportDate, packageName, sourceHash
  processes: ProcessNode[];
  objects: BusinessObjectNode[];     // VBOs
  workQueues: WorkQueueDef[];
  environmentVars: EnvVarDef[];
  credentialsRefs: CredentialRef[];
  dependencies: DependencyEdge[];    // process→object, object→app, process→queue
}

export interface ProcessNode {
  id: string;
  name: string;
  pages: Page[];                     // main page + subsheets
  dataItems: DataItem[];
  startupParams: Param[];
  outputs: Param[];
}

export interface Page {
  id: string;
  name: string;
  stages: Stage[];
  edges: StageEdge[];                // directed control flow, incl. exception links
}

export type Stage =
  | ActionStage | CalculationStage | MultiCalcStage | DecisionStage
  | ChoiceStage | LoopStartStage | LoopEndStage | DataStage
  | CollectionStage | ExceptionStage | RecoverStage | ResumeStage
  | SubSheetRefStage | ReadStage | WriteStage | NavigateStage
  | WaitStage | AlertStage | NoteStage | StartStage | EndStage
  | CodeStage | AnchorStage;

export interface AppElement {                    // from Application Modeller
  id: string; name: string;
  mode: 'Win32' | 'HTML' | 'Java' | 'UIA' | 'SAP' | 'Citrix' | 'Region';
  attributes: ElementAttr[];                     // incl. match type (exact/index/dynamic)
}

export interface Finding {
  ruleId: string;                                // e.g. "SEC-001"
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: 'security' | 'reliability' | 'maintainability' | 'compliance' | 'performance';
  location: IrLocation;                          // processId/pageId/stageId path
  message: string;
  remediation: string;                           // UiPath-oriented fix guidance
  confidence: number;                            // 0–1
}
```

Design notes:
- Every IR node carries a `sourceRef` (XPath-like pointer into the original XML) so the UI can show side-by-side provenance and reports can cite exact locations.
- Expressions are stored both raw (BP expression text) and parsed (AST) to power both rules (e.g., detecting password literals) and expression translation.
- `ParseResult` separates `model`, `warnings[]` (tolerated oddities), and `errors[]` (unparseable sections) — the parser must never throw on malformed-but-salvageable input.

---

## 4. Parser (`@prismshift/parser`)

- **Input:** raw XML string (browser `File.text()`); handles `.bprelease` (release packages, multiple processes/objects) and single-process `.xml` exports.
- **XML engine:** `fast-xml-parser` (works in browser and Node, no DOM dependency).
- **Version tolerance:** schema adapters keyed off the release header (`<bpr:release>` namespace/version). Unknown stage types degrade to a `GenericStage` with raw payload preserved, warning emitted — *never* dropped silently.
- **Determinism:** identical input yields identical IR (stable IDs derived from BP GUIDs); `sourceHash` = SHA-256 of input for audit/dedup.
- **Performance target:** 5 MB export parsed to IR in < 2 s on a mid-range laptop; parsing runs in a Web Worker to keep the UI responsive.

---

## 5. Rules Engine (`@prismshift/rules`)

A rule is a pure function `(model: AutomationModel) => Finding[]` registered with metadata. The engine runs an enabled ruleset and aggregates findings + scores.

### 5.1 Initial Rule Catalog (v1)

| ID | Severity | Check |
|---|---|---|
| SEC-001 | critical | Credential-like literal in data item initial value or expression (entropy + keyword heuristics) |
| SEC-002 | high | Password/secret passed as plain text input parameter instead of Credential Manager |
| SEC-003 | high | Sensitive data pattern (SSN, account #, card #) written to log/note/flat file stage |
| SEC-004 | medium | Hardcoded environment value (URL, UNC path, server name) that should be an asset/config |
| REL-001 | high | Page or action path with no exception/recover stage coverage |
| REL-002 | high | Loop with no counter guard or wait-timeout (infinite loop risk) |
| REL-003 | medium | Wait stage with zero/absent timeout |
| REL-004 | medium | App element matched by index/position rather than stable attributes (brittle selector) |
| MNT-001 | medium | Unreachable stages / orphaned pages (dead logic) |
| MNT-002 | low | Unused data items |
| MNT-003 | medium | Near-duplicate objects (normalized-structure similarity > 0.85) |
| MNT-004 | medium | Monolith: process > 150 stages or page > 60 stages → recommend dispatcher/performer split |
| CMP-001 | high | Queue item data contains flagged PII fields without tagging/encryption note |
| CMP-002 | info | Missing process description/documentation fields |

### 5.2 Scoring

Per-process score = 100 − Σ severity weights (critical 25, high 10, medium 4, low 1), floor 0, mapped to letter grades (A ≥ 90 … F < 50). Grade + finding counts are the only analysis outputs synced in Workspace Mode.

---

## 6. Summary Generator

Deterministic first, AI-enhanced optionally:

1. **Deterministic pass (always):** walks the IR to produce structured facts — applications touched (from Application Modeller), queues used, inputs/outputs, exception strategy, page-by-page step outline, data-sensitivity flags.
2. **AI pass (opt-in):** structured facts + stage graph digest are sent to the LLM (via Edge Function in Workspace Mode, or user-supplied endpoint) to produce the narrative business description. Raw XML is never sent — only the digest, and the digest redacts data-item *values*, sending names/types only.

---

## 7. Transformer (`@prismshift/transformer`)

### 7.1 Mapping Table (deterministic tier)

| Blue Prism | UiPath output |
|---|---|
| Process | REFramework-structured project (or single Sequence for simple processes — threshold configurable) |
| Page / subsheet | Invoked workflow file (`.xaml`) |
| Calculation / Multi-calc | `Assign` / `MultipleAssign` |
| Decision | `If` (Sequence) / `FlowDecision` (Flowchart) |
| Choice | `Switch` / `FlowSwitch` |
| Loop (collection) | `ForEachRow` / `ForEach` |
| Data item | Variable (scoped) or Argument (startup params ↔ `in_`, outputs ↔ `out_`) |
| Collection | `DataTable` |
| Work queue ops | Orchestrator Queue activities (`AddQueueItem`, `GetTransactionItem`, `SetTransactionStatus`) |
| Environment variable | Orchestrator Asset (asset manifest emitted) |
| Credential | `GetCredential` asset reference (manifest entry, flagged for setup) |
| Exception / Recover / Resume | `Try Catch` + REFramework `SetTransactionStatus` conventions |
| Read / Write / Navigate stage | `GetText` / `TypeInto` / `Click` etc. + generated selector (**always flagged**) |
| Code stage (C#/VB) | `InvokeCode` with translated body where possible; else flagged verbatim block |
| BP expression language | VB.NET expression translation via expression AST (function map: `Len→`.Length`, `InStr`, `Left/Right/Mid`, date fns, `&` concat, etc.) |

### 7.2 Selector Generation

Application Modeller elements → best-effort UiPath selectors per mode (HTML mode → `webctrl` attributes; Win32/UIA → `wnd`/`ctrl`; Citrix/Region → flagged as image/OCR candidates with no auto-selector). Every generated selector carries `confidence` and appears in the migration report's **mandatory validation list**. Index-based matches inherit a REL-004 finding and a low-confidence flag.

### 7.3 Outputs

A ZIP containing: `project.json`, `Main.xaml`, per-page workflows, REFramework scaffold (when applied), `AssetsManifest.json`, `QueuesManifest.json`, and `MIGRATION_REPORT.md` per process (converted %, approximations, manual-work punch list with sourceRef citations, selector validation checklist, effort estimate).

Generated XAML must open cleanly in UiPath Studio 2023.10+ (Windows, .NET 6 target). XAML is emitted via typed template modules — no string concatenation of raw XML fragments outside the template layer.

---

## 8. Supabase Backend

### 8.1 Schema (metadata only)

```sql
-- workspaces & membership
create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  artifact_storage_enabled boolean not null default false,
  created_at timestamptz not null default now()
);

create table workspace_members (
  workspace_id uuid references workspaces on delete cascade,
  user_id uuid references auth.users on delete cascade,
  role text not null check (role in ('admin','editor','viewer')),
  primary key (workspace_id, user_id)
);

-- a migration program (e.g., "Retail Ops BP Estate")
create table programs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  name text not null,
  created_by uuid not null references auth.users,
  created_at timestamptz not null default now()
);

-- one row per BP process analyzed (no content, metadata only)
create table processes (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references programs on delete cascade,
  bp_name text not null,
  source_hash text not null,           -- SHA-256 of source XML (dedup/audit)
  bp_version text,
  stage_count int,
  score int,
  grade text,
  status text not null default 'analyzed'
    check (status in ('analyzed','converted','validating','validated','deployed','blocked')),
  effort_hours_est numeric,
  updated_at timestamptz not null default now(),
  unique (program_id, source_hash)
);

-- findings summary (rule id + location path + message; no source content)
create table findings (
  id uuid primary key default gen_random_uuid(),
  process_id uuid not null references processes on delete cascade,
  rule_id text not null,
  severity text not null,
  category text not null,
  location_path text not null,
  message text not null,
  resolved boolean not null default false,
  resolved_by uuid references auth.users,
  resolved_at timestamptz
);

-- immutable audit log
create table audit_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references workspaces on delete cascade,
  actor uuid references auth.users,
  event text not null,                 -- 'process.analyzed','process.converted','export.downloaded',...
  subject_type text, subject_id uuid,
  detail jsonb,
  at timestamptz not null default now()
);

create table dependency_edges (
  program_id uuid not null references programs on delete cascade,
  from_name text not null, from_type text not null,
  to_name text not null,   to_type text not null,
  primary key (program_id, from_name, from_type, to_name, to_type)
);
```

### 8.2 Row-Level Security

RLS enabled on every table. Access derives from `workspace_members`:

```sql
alter table processes enable row level security;

create policy processes_select on processes for select using (
  exists (
    select 1 from programs p
    join workspace_members m on m.workspace_id = p.workspace_id
    where p.id = processes.program_id and m.user_id = auth.uid()
  )
);
-- insert/update policies additionally require role in ('admin','editor');
-- audit_events: insert-only for members, no update/delete policies (immutability).
```

### 8.3 Edge Functions

- **`llm-proxy`** (Deno/TypeScript): accepts the redacted digest, injects the server-held Anthropic API key, enforces per-workspace rate limits and a payload-size ceiling, strips/blocks any payload containing raw XML markers, logs an audit event (event only, not content). This keeps API keys out of the client and gives infosec a single controllable egress point.
- **`purge-workspace`**: admin-invoked hard delete honoring retention policy.

### 8.4 Auth

Supabase Auth with email magic-link for v1; the schema and UI assume SSO (SAML/OIDC via Supabase's enterprise SSO) can be enabled later without changes. JWT claims → `auth.uid()` → RLS. Roles: `admin` (workspace settings, purge, artifact-storage flag), `editor` (create programs, sync analyses, update statuses), `viewer` (dashboard read-only).

---

## 9. Frontend (apps/web)

- **Stack:** React 18, Vite, TypeScript strict, Tailwind, Zustand for session state, TanStack Query for Supabase reads, React Flow for stage/dependency graphs, JSZip for exports.
- **Routes:** `/` (drop zone + local session), `/process/:id` with tabs **Summary · Vulnerabilities · Improvements · Conversion · Source**, `/dashboard` (Workspace Mode tracker), `/graph` (dependency visualization), `/settings`.
- **Workers:** parsing, rules, and transformation each run in Web Workers (Comlink) — the main thread only renders.
- **Key UX contracts:** every finding deep-links to the stage in a rendered flow view; conversion tab shows BP stage ↔ generated activity side-by-side with confidence badges; all exports (ZIP, PDF) generated client-side via browser APIs.
- **Privacy indicator:** persistent header badge showing current mode (Local / Workspace / AI-enabled) so screenshots in approval docs are self-explanatory.

---

## 10. Testing Strategy

1. **Corpus tests (the backbone):** each synthetic `.bprelease` in `@prismshift/corpus` ships with `answer-key.json` (expected parse stats, expected findings with rule IDs + locations, expected conversion coverage %). CI fails on any missed finding *or* any false positive.
2. **Unit tests:** expression translator (table-driven, 200+ cases), selector generator per app mode, scoring math.
3. **Round-trip smoke:** generated project.json/XAML validated against JSON schema + XAML well-formedness; a periodic manual gate opens outputs in UiPath Studio.
4. **RLS tests:** Supabase local stack + pgTAP asserting cross-workspace isolation.
5. **Performance budget test:** 5 MB corpus file must parse+analyze under budget in CI (Node approximation).

## 11. Security & Compliance Posture

- Client-side processing invariant (§1.1); CSP locked to self + Supabase + (when enabled) the AI endpoint; no third-party analytics in v1.
- Supabase: RLS everywhere, immutable audit log, least-privilege service keys confined to Edge Functions, artifact storage off by default and client-encrypted when on.
- Redaction guarantee for AI digests (names/types only, never values) enforced in one auditable module (`packages/reports/src/redact.ts`) with its own test suite.
- Dependency hygiene: pnpm lockfile, `pnpm audit` in CI, Renovate.

## 12. Non-Functional Requirements

| Concern | Target |
|---|---|
| Parse+analyze 5 MB export | < 5 s end-to-end, UI responsive throughout |
| Max supported export size | 50 MB (streamed parse, worker memory guard) |
| Browser support | Evergreen Chrome/Edge/Firefox; no IE |
| Accessibility | WCAG 2.1 AA for dashboard + reports |
| Uptime dependency | Local Mode fully functional offline after first load (PWA-cached) |

## 13. Explicit Non-Goals (v1)

- No guaranteed 100% conversion; no live-application selector validation.
- No Automation Anywhere / Power Automate sources (IR is designed to allow this later).
- No server-side parsing, ever, as a "performance option."
- No editing of Blue Prism files (read-only source).
