# PrismShift — Project Plan: Epics, Sprints & Stories

**Team assumption:** 1–2 developers · 2-week sprints · Points: 1 = ~half day, 2 = ~1 day, 3 = 2–3 days, 5 = ~1 week, 8 = split-me-if-possible.

---

## Epic Map

| Epic | Goal | Sprints |
|---|---|---|
| **E1 — Foundation & Corpus** | Monorepo, CI, synthetic test corpus with answer keys | S1 |
| **E2 — Parser & IR** | `.bprelease` → IR, version-tolerant, worker-hosted | S1–S2 |
| **E3 — Analysis Engine** | Rules engine, 14-rule catalog, scoring | S2–S3 |
| **E4 — Summary & Docs** | Deterministic summaries; data-sensitivity flags | S3 |
| **E5 — Transformation** | IR → UiPath project ZIP, migration report | S4–S5 |
| **E6 — Selectors & Expressions** | App Modeller → selectors; expression translation | S5 |
| **E7 — Workspace Mode (Supabase)** | Auth, schema, RLS, tracker dashboard, audit log | S6 |
| **E8 — AI Layer & Reports** | Edge Function LLM proxy, redaction, audit PDF | S7 |
| **E9 — Hardening & Release** | Performance, a11y, security review, docs | S7–S8 |

---

## Sprint 1 — "It Parses" (E1, E2)

**Sprint goal:** drop a synthetic `.bprelease` into a running web app and see its parsed process tree.

| ID | Story | AC (abridged) | Pts |
|---|---|---|---|
| S1-1 | As a dev, I have a pnpm/Turborepo monorepo with TS strict, ESLint, Vitest, CI (lint+test+build) | `pnpm test` green in CI; packages scaffolded per ARCHITECTURE §2 | 3 |
| S1-2 | As a dev, I have IR types + graph utilities | Types compile per §3; `walkStages`, `buildDependencyGraph` unit-tested | 3 |
| S1-3 | As a dev, I have corpus sample #1 "Clean & Simple" with answer key | Valid BP 6.x-schema XML; answer-key.json lists parse stats + zero expected findings | 3 |
| S1-4 | As a dev, I have corpus sample #2 "Realistic Mid-Size" with planted issues + answer key | Queue-driven dispatcher/performer; 3 planted issues documented in key | 3 |
| S1-5 | As a user, I can drag a `.bprelease` file into the web app | Vite app with drop zone; file read client-side; rejects non-XML gracefully | 2 |
| S1-6 | As a user, I see the parsed process tree (processes → pages → stages) | Parser handles samples 1–2 with zero errors; tree view renders; warnings surfaced | 5 |
| S1-7 | As a dev, parsing runs in a Web Worker | UI thread never blocks > 100 ms during parse | 2 |

**Definition of done for the sprint:** corpus samples parse to IR matching answer-key stats in CI.

---

## Sprint 2 — "It Judges" (E2, E3)

**Sprint goal:** findings with locations and a per-process grade, validated against answer keys.

| ID | Story | AC | Pts |
|---|---|---|---|
| S2-1 | Corpus sample #3 "The Monolith" (200+ stages, all planted issue types) + key | Every v1 rule has ≥ 1 planted trigger in the corpus overall | 5 |
| S2-2 | Corpus sample #4 "Edge Cases" (nested subsheets, alt app modes, odd-but-legal XML) + key | Parser emits warnings not errors; GenericStage fallback covered | 3 |
| S2-3 | Rules engine core: registration, ruleset config, runner, Finding schema | Pure functions; runner returns findings + timing; unit-tested | 3 |
| S2-4 | Security rules SEC-001…004 | Catch all planted security issues; zero false positives on sample #1 | 5 |
| S2-5 | Reliability rules REL-001…004 | Same standard | 3 |
| S2-6 | Maintainability + compliance rules MNT-001…004, CMP-001…002 | Same standard; near-duplicate detection tested on Monolith's 3 clones | 5 |
| S2-7 | Scoring + letter grades | Matches §5.2 math; snapshot-tested per corpus file | 1 |

---

## Sprint 3 — "It Explains" (E3, E4)

**Sprint goal:** a reviewer can open a process and understand it without reading XML.

| ID | Story | AC | Pts |
|---|---|---|---|
| S3-1 | Vulnerabilities tab: findings list with severity filters, deep-link to stage in flow view | Click finding → stage highlighted in rendered React Flow graph | 5 |
| S3-2 | Stage flow visualization per page | Directed graph incl. exception edges; readable on Monolith (virtualized) | 5 |
| S3-3 | Deterministic summary generator | Apps touched, queues, I/O, exception strategy, step outline — asserted against corpus keys | 5 |
| S3-4 | Data-sensitivity flagging in summaries | SSN/account patterns in names flagged; appears in Summary tab | 2 |
| S3-5 | Improvements tab: recommendation engine v1 | MNT/REL findings mapped to UiPath-practice recommendations with rationale | 3 |

---

## Sprint 4 — "It Converts (Part 1)" (E5)

**Sprint goal:** download a ZIP that opens in UiPath Studio for the Clean & Simple sample.

| ID | Story | AC | Pts |
|---|---|---|---|
| S4-1 | XAML template layer (typed emitters for Sequence, Assign, If, ForEach, TryCatch, InvokeWorkflow) | Emitted XAML schema-valid; snapshot tests | 5 |
| S4-2 | project.json + folder layout emitter (plain + REFramework threshold logic) | Studio 2023.10 opens output without repair prompts (manual gate) | 3 |
| S4-3 | Core stage mapping: calc/multi-calc/decision/choice/loop/data/collection/subsheet | Corpus #1 converts 100%; mapping unit tests | 5 |
| S4-4 | Variables/arguments mapping incl. scoping + `in_`/`out_` conventions | Types mapped (BP text/number/flag/date/collection → String/Double/Boolean/DateTime/DataTable) | 3 |
| S4-5 | ZIP export (JSZip) client-side | One click → valid archive; nothing sent over network | 2 |

---

## Sprint 5 — "It Converts (Part 2)" (E5, E6)

**Sprint goal:** honest conversion of the messy stuff — queues, exceptions, selectors, expressions — with a migration report.

| ID | Story | AC | Pts |
|---|---|---|---|
| S5-1 | Expression translator (BP expression AST → VB.NET) | 200+ table-driven cases; untranslatable expressions flagged, never silently wrong | 5 |
| S5-2 | Queue + credential + env-var mapping, Assets/Queues manifests | Corpus #2 dispatcher/performer converts to REFramework with queue activities | 5 |
| S5-3 | Exception model: Recover/Resume → TryCatch + REFramework status conventions | Exception paths in corpus #2 preserved semantically | 5 |
| S5-4 | Selector generation per app mode + confidence + validation checklist | HTML/Win32/UIA best-effort; Citrix/Region flagged image/OCR; all listed in report | 5 |
| S5-5 | MIGRATION_REPORT.md generator | Coverage %, punch list with sourceRefs, selector checklist, effort estimate | 3 |
| S5-6 | Conversion tab: BP stage ↔ UiPath activity side-by-side with confidence badges | Reviewer can walk every mapping | 3 |

---

## Sprint 6 — "Team Mode" (E7)

**Sprint goal:** authenticated workspace with migration tracker; metadata-only sync proven.

| ID | Story | AC | Pts |
|---|---|---|---|
| S6-1 | Supabase project + migrations for full schema (§8.1) + seed | `supabase db reset` clean; types generated via `supabase gen types typescript` | 3 |
| S6-2 | RLS policies + pgTAP isolation tests | Cross-workspace access provably denied in CI | 3 |
| S6-3 | Auth (magic link), workspace creation, member roles | Role gates enforced in UI and by RLS | 3 |
| S6-4 | Metadata sync: push analysis results (process rows + findings) — content never sent | Network inspector shows no XML/XAML payloads; unique(source_hash) dedup works | 3 |
| S6-5 | Migration tracker dashboard: statuses, grades, effort rollup, filters | Status transitions logged to audit_events | 5 |
| S6-6 | Dependency graph view (program-level) from synced edges | React Flow graph; shared-object hotspots highlighted | 3 |
| S6-7 | Privacy mode badge + settings page | Mode always visible; artifact-storage flag admin-only (flag only, feature deferred) | 2 |

---

## Sprint 7 — "AI & Audit" (E8, E9 start)

**Sprint goal:** optional AI narratives behind a controlled egress point; audit-grade reporting.

| ID | Story | AC | Pts |
|---|---|---|---|
| S7-1 | Redaction module (digest builder: names/types only, values stripped) + test suite | Property tests: no data-item value survives redaction | 3 |
| S7-2 | `llm-proxy` Edge Function: key injection, rate limits, size ceiling, raw-XML blocker, audit event | Client holds no API key; abuse cases tested | 5 |
| S7-3 | AI narrative in Summary tab behind explicit toggle + disclosure; custom endpoint option | Toggle off by default; disclosure copy reviewed | 3 |
| S7-4 | Audit report export (per process + program rollup) as PDF | Findings, scores, conversion coverage, sign-off block; generated client-side | 5 |
| S7-5 | `purge-workspace` Edge Function + retention setting | Admin-only; audited | 2 |

---

## Sprint 8 — "Ship It" (E9)

**Sprint goal:** performance, accessibility, security posture, and docs good enough to put in front of an enterprise reviewer.

| ID | Story | AC | Pts |
|---|---|---|---|
| S8-1 | Performance: streamed parse for 50 MB, memory guard, budget test in CI | §12 targets met | 5 |
| S8-2 | PWA/offline for Local Mode | Full analyze/convert cycle offline after first load | 3 |
| S8-3 | Accessibility pass (WCAG 2.1 AA on dashboard + reports) | Axe CI clean; keyboard nav on tabs/tables | 3 |
| S8-4 | Security review: CSP, dependency audit, threat-model doc | Checklist complete; findings fixed or ticketed | 3 |
| S8-5 | Docs: user guide, infosec approval pack (architecture + data-flow diagrams), corpus guide | A reviewer can answer "where does my data go?" from the pack alone | 3 |
| S8-6 | Real-export validation protocol | Written procedure for diffing a sanitized real `.bprelease` against corpus assumptions; parser adapter checklist | 2 |

---

## Backlog (Post-v1)

- Encrypted artifact storage (client-side AES-GCM, workspace-held keys)
- SSO (SAML/OIDC) via Supabase enterprise auth
- CLI (`prismshift analyze *.bprelease`) reusing core packages for CI-style batch runs
- Automation Anywhere source adapter (second front-end to the IR)
- LLM-assisted code-stage translation (C#/VB bodies)
- Test-harness generation (stub UiPath test cases from BP I/O definitions)
- UiPath Orchestrator API integration (auto-create queues/assets from manifests)

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Synthetic corpus diverges from real BP export quirks | Parser fails on first real file | S8-6 validation protocol; version-adapter design isolates fixes to parser layer |
| XAML compat drift across Studio versions | Output won't open | Pin target (2023.10+/.NET 6); manual Studio gate each conversion sprint |
| Selector quality expectations | Trust damage | Confidence badges + mandatory validation checklist; never claim verified selectors |
| Scope creep into "100% conversion" | Endless Sprint 5 | Non-goals doc (§13); punch-list framing is the product, not a limitation |
| Supabase metadata accidentally includes content | Privacy invariant broken | Single sync module with schema-typed payloads; network-inspection test in S6-4 |
