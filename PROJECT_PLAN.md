# PrismShift — Project Plan: Epics, Sprints & Stories

**Team assumption:** 1–2 developers · 2-week sprints · Points: 1 = ~half day, 2 = ~1 day, 3 = 2–3 days, 5 = ~1 week, 8 = split-me-if-possible.

---

## Progress

**Legend:** ✅ done · 🔄 in progress · ⬜ not started — updated as each story completes.

| Sprint | Status | Stories |
|---|---|---|
| S1 — "It Parses" | ✅ complete | 7/7 done |
| S2 — "It Judges" | ✅ complete | 7/7 done |
| S3 — "It Explains" | ✅ complete | 5/5 done |
| S4 — "It Converts (Part 1)" | ⬜ | 0/5 |
| S5 — "It Converts (Part 2)" | ⬜ | 0/6 |
| S6 — "Team Mode" | ⬜ | 0/7 |
| S7 — "AI & Audit" | ⬜ | 0/5 |
| S8 — "Ship It" | ⬜ | 0/6 |

### Completed log

- **2026-07-20 — S3-5 follow-up (user review)** Recommendation engine extended to all 14 rules: SEC-001+SEC-002 merge into one Credential Manager recommendation; SEC-003 → mask PII in logs; SEC-004 → externalize config; CMP-001 → encrypt queues; CMP-002 → document. Every finding is now addressed by exactly one recommendation (`recommendationCoverage` proves it — "addressing all N findings" line in the tab). Recommendations and their rule badges wear the same severity colors as the Vulnerabilities tab, ordered by worst triggering severity.
- **2026-07-20 — S3-4/S3-5** Sensitivity flags + Improvements tab — **Sprint 3 complete.** S3-4: `sensitivity` on every summary (SSN/account/card name patterns on items AND collection fields, plus password-typed items; single SENSITIVE_NAME definition shared from @prismshift/rules); `sensitiveItems` ground truth in all answer keys; rose PII/password badges in the Summary tab. S3-5: `buildRecommendations()` maps MNT/REL findings to 8 UiPath-practice recommendation templates (REFramework exceptions, RetryScope bounds, timeouts, stable selectors, dead-logic removal, data pruning, shared libraries, dispatcher/performer split) with rationale citing concrete stages, ordered by triggering severity; Improvements tab with empty state. 149 tests green.
- **2026-07-20 — S3-3** Deterministic summary generator (`@prismshift/reports`): `summarizeProcess`/`summarizeObject` walk the IR to produce applications touched (resolved via called objects' App Modeller), objects called, queues used (dynamic queue names surfaced as "(dynamic)"), startup I/O, exception strategy (recovery pages + deliberate throws), and a page-by-page step outline via `stepSentence` (one deterministic sentence per flow-stage kind). Answer keys extended with `expectedSummaries` for all 4 samples (Monolith's emitted by the generator); 10 corpus-asserted tests incl. determinism. Web: Summary tab (now the default landing tab per §9 tab order) with description, fact chips, exception strategy, and collapsible step outlines. Also this story (from user review): directional arrowheads on all flow edges, color-matched per edge kind.
- **2026-07-20 — S3-2** Flow visualization polish: inferred "on exception" edges (BP keeps recovery links implicit — the viz draws dashed, labeled, toggleable edges from risky stages to the page's Recover stage; presentation-layer only, never persisted to the IR so rules stay unaffected), smoothstep edge routing with a color-coded palette (flow/true/false/choice/exception CSS), minimap with kind-colored nodes, `onlyRenderVisibleElements` virtualization for the Monolith's 100-stage page, edge/node legend, and a corpus-generator layout fix (data items in a side column). **Fixed a real render bug**: custom nodes lacked React Flow `<Handle>`s so no edges drew at all — caught by screenshot verification, not by unit tests. 4 new inferred-edge unit tests; verified in-browser on samples #2 and #3.
- **2026-07-20 — S3-1** Vulnerabilities tab + flow deep-links: session store now runs the full rule catalog after parse; landing shows graded owner cards (grade/score/finding counts); per-owner detail view with Vulnerabilities · Flow · Structure tabs. Findings list with severity filter chips (counts), location breadcrumbs, remediation, and "Show in flow →" deep-links that open the React Flow stage graph (@xyflow/react, BP diagram coordinates, kind-colored nodes, labeled True/False/choice edges, animated exception edges) with the target stage ring-highlighted and auto-centered. Pure `buildFlowGraph` unit-tested; 7 jsdom integration tests (drop → grade card → findings → filter toggle → deep-link); verified in a real browser via CDP on the Monolith (100-stage page renders, exactly 1 highlighted node) with screenshots.

- **2026-07-20 — S2-7** Scoring + letter grades: §5.2 weights (critical 25 / high 10 / medium 4 / low 1 / info 0), floor 0, bands A≥90 … F<50; `scoreFindings`/`scoreProcess`/`scoreObject`. Golden per-corpus-file scores locked in tests: Loan Calculator 100/A · Dispatcher 74/C · Performer 100/A · Monolith **34/F** · VBO clones 96/A · Edge Gauntlet 100/A. **Sprint 2 complete** — 104 tests green monorepo-wide.
- **2026-07-20 — S2-6** Maintainability + compliance rules: MNT-001 reachability (Start+Recover entry points; data/note/generic exempt) + orphaned-page detection (process-scope; object pages are external actions), MNT-002 unused-data-items via a full reference collector (Start/End/Code stages upgraded in IR+parser to carry param↔data-item bindings so page-parameter usage counts), MNT-003 near-duplicate objects via multiset-Jaccard structural similarity (>0.85; canonical-first so 3 clones → 2 findings), MNT-004 monolith thresholds, CMP-001 PII-fields-to-unencrypted-queue, CMP-002 missing narratives. **The corpus harness caught a real parser bug** (single-Calculation stages lost expression/storeIn because 'calculation' is array-parsed for multi-calc) — fixed + new corpus-wide payload-integrity invariant test. Full 14-rule catalog: 16/16 planted findings caught, zero false positives on all samples.
- **2026-07-20 — S2-5** Reliability rules REL-001…004: process-level recovery-coverage check (risky-work gated), SCC-based unguarded-cycle detection (decision/choice/loop/wait count as guards; finding at earliest stage of the cycle; guarded performer cycle stays silent), wait-without-timeout, index-matched App Modeller elements (IrLocation gained optional elementId; harness resolves element names). 7 targeted cycle/coverage unit tests + corpus sweep now enforcing 8 rules — first-run clean on all samples.
- **2026-07-20 — S2-4** Security rules SEC-001…004: keyword-gated + strength-checked credential-literal detection (bindings, calcs, data-item initial values), plaintext password startup params, sensitive-refs-into-log/alert detection (identifier names + SSN digit pattern), hardcoded environment values (UNC/URL/internal hostnames — release-level env vars correctly exempt). Shared IR-walking helpers (`helpers.ts`) + `diffFindings()` answer-key harness in @prismshift/corpus enforcing both directions (missed OR unexpected fails). All 4 samples: exact catches, zero false positives, first run.
- **2026-07-20 — S2-3** Rules engine core (`@prismshift/rules`): `defineRule` (id-format validated) + `buildRuleset` (unique ids, frozen), `makeFinding` (meta-consistent, confidence clamped), `runRules(model, rules, config)` — per-rule timing, disabled-rules filter, severity overrides, crash isolation (a throwing rule is reported in `errors`, never aborts the run), deterministic finding order (severity → ruleId → location → insertion). 12 unit tests incl. purity-over-frozen-model and determinism.
- **2026-07-20 — S2-2** Corpus sample #4 "Edge Cases": first sample expecting warnings > 0 (exactly 7, zero errors, zero findings). Nested subsheets (Main → Level One → Level Two), ChoiceStart/ChoiceEnd routing, unknown stage types ProcessInfo/SubSheetInfo → GenericStage with payload preserved, stray subsheetid attached to first page, ghost page reference left unresolved (parser now drops the dangling id, keeping validateModel clean), unknown data type → text, variable queue name, empty collectioninfo, plain-text code body, all six alt App Modeller modes + unknown "Mainframe" → Win32. Answer-key schema gained strayStageCount; corpus structural checks count strays instead of failing on them.
- **2026-07-20 — S2-1** Corpus sample #3 "The Monolith": generated deterministically by `packages/corpus/scripts/generate-monolith.mjs` (script + output both committed; stats in the answer key are machine-computed so they can never drift). 201-stage "Customer Account Reconciliation" process (4 pages incl. an orphaned one, unguarded retry cycle, unreachable island, PII queue write, hardcoded UNC path, plaintext password param, empty narrative) + 3 near-duplicate "Ledger Terminal VBO" clones (one with an index-matched element). 13 planted findings — with sample #2, all 14 v1 rules now have ≥1 trigger. Parser handles all 264 stages with zero errors/warnings; corpus + parser answer-key tests extended (CMP-002-aware narrative checks, elementName finding locations).

- **2026-07-20 — S1-1** Monorepo foundation: pnpm/Turborepo workspace, TS strict, ESLint 9, Vitest, GitHub Actions CI; all 6 packages + web app scaffolded with the one-way dependency chain enforced; verified end-to-end on Windows PowerShell.
- **2026-07-20 — S1-2** IR types + graph utilities: full ARCHITECTURE §3 type model (AutomationModel, 24-kind Stage union, expressions raw+AST, App Modeller, findings), `walkStages()`, `buildDependencyGraph()`, `validateModel()`; 12 unit tests incl. dedup, loop-pair, and dangling-edge cases.
- **2026-07-20 — S1-3** Corpus sample #1 "Clean & Simple": hand-authored BP 6.x-schema `.bprelease` (Loan Payment Calculator — 2 pages, 19 stages, validation + business-exception path with Recover/Resume, zero planted issues) + typed `answer-key.json` schema, sample registry, `loadSample()` loader, and structural self-validation tests (well-formedness, raw counts vs key, stage/page integrity).
- **2026-07-20 — S1-7** Web Worker parsing: Comlink-wrapped parser worker (`parser.worker.ts`) via Vite module workers; `parseReleaseXml()` client with main-thread fallback where Workers don't exist (tests); verified in a real browser via CDP — console shows "parser worker started" before "parse complete". **Sprint 1 complete.** Also this sprint (unplanned): intake diagnostics — `[PrismShift]` console log trail across drop→read→parse, visible build stamp (stale-cache detector), window-level drop guard, FileReader fallback, no-silent-failure error surfacing, and editor-drag detection with on-page guidance (dragging from VS Code/Cursor sends links, not files) + 6 React integration tests (jsdom).
- **2026-07-20 — S1-6** Parser + tree view: `parseBpRelease()` (async, SHA-256 sourceHash via crypto.subtle) maps all 24 corpus stage types to the IR — stages/edges (flow/true/false/choice incl. wait choices + Time Out), data items with exposure, collections with fields, loop pairing, queue-action tagging, App Modeller (modes, match types), work queues, env vars; single-process `.xml` root supported; GenericStage + warning for unknown types; errors never thrown. Dependency graph auto-populated via `buildDependencyGraph`. 12 answer-key-driven tests (both samples: zero errors/warnings, exact kind tallies, determinism, planted-issue raw material preserved, resilience cases). Web: session store parses on intake; ProcessTree renders processes/objects → pages → stages with kind badges, error/warning panels, and release summary line.
- **2026-07-20 — S1-5** Drop zone: drag-and-drop + click-to-browse intake reading files entirely client-side (`File.text()`); pure `fileIntake` module (extension/size/binary/content sniffing, 50 MB §12 ceiling, friendly rejection reasons — 11 unit tests) wired through a Zustand session store; loaded-file card with reset; privacy note and error alerts in the UI.
- **2026-07-20 — S1-4** Corpus sample #2 "Realistic Mid-Size": queue-driven estate (Invoice Dispatcher → Invoices Queue → Invoice Performer → Invoice Entry VBO with 4-element HTML App Modeller; 44 stages total incl. loop, code, write/navigate/wait, guarded queue cycle). Exactly 3 planted issues documented in the key: SEC-001 (password literal "ArchiveP@ss2024!" as action input), REL-003 (empty wait timeout), MNT-002 (unused "Temp Counter"). Answer-key schema extended with object stats + object-located findings; corpus tests now also verify appdef element counts and that every stage link (onsuccess/ontrue/onfalse/ontimeout/choice) resolves.

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

| ID | Status | Story | AC (abridged) | Pts |
|---|---|---|---|---|
| S1-1 | ✅ 2026-07-20 | As a dev, I have a pnpm/Turborepo monorepo with TS strict, ESLint, Vitest, CI (lint+test+build) | `pnpm test` green in CI; packages scaffolded per ARCHITECTURE §2 | 3 |
| S1-2 | ✅ 2026-07-20 | As a dev, I have IR types + graph utilities | Types compile per §3; `walkStages`, `buildDependencyGraph` unit-tested | 3 |
| S1-3 | ✅ 2026-07-20 | As a dev, I have corpus sample #1 "Clean & Simple" with answer key | Valid BP 6.x-schema XML; answer-key.json lists parse stats + zero expected findings | 3 |
| S1-4 | ✅ 2026-07-20 | As a dev, I have corpus sample #2 "Realistic Mid-Size" with planted issues + answer key | Queue-driven dispatcher/performer; 3 planted issues documented in key | 3 |
| S1-5 | ✅ 2026-07-20 | As a user, I can drag a `.bprelease` file into the web app | Vite app with drop zone; file read client-side; rejects non-XML gracefully | 2 |
| S1-6 | ✅ 2026-07-20 | As a user, I see the parsed process tree (processes → pages → stages) | Parser handles samples 1–2 with zero errors; tree view renders; warnings surfaced | 5 |
| S1-7 | ✅ 2026-07-20 | As a dev, parsing runs in a Web Worker | UI thread never blocks > 100 ms during parse | 2 |

**Definition of done for the sprint:** corpus samples parse to IR matching answer-key stats in CI.

---

## Sprint 2 — "It Judges" (E2, E3)

**Sprint goal:** findings with locations and a per-process grade, validated against answer keys.

| ID | Story | AC | Pts |
|---|---|---|---|
| S2-1 | ✅ 2026-07-20 · Corpus sample #3 "The Monolith" (200+ stages, all planted issue types) + key | Every v1 rule has ≥ 1 planted trigger in the corpus overall | 5 |
| S2-2 | ✅ 2026-07-20 · Corpus sample #4 "Edge Cases" (nested subsheets, alt app modes, odd-but-legal XML) + key | Parser emits warnings not errors; GenericStage fallback covered | 3 |
| S2-3 | ✅ 2026-07-20 · Rules engine core: registration, ruleset config, runner, Finding schema | Pure functions; runner returns findings + timing; unit-tested | 3 |
| S2-4 | ✅ 2026-07-20 · Security rules SEC-001…004 | Catch all planted security issues; zero false positives on sample #1 | 5 |
| S2-5 | ✅ 2026-07-20 · Reliability rules REL-001…004 | Same standard | 3 |
| S2-6 | ✅ 2026-07-20 · Maintainability + compliance rules MNT-001…004, CMP-001…002 | Same standard; near-duplicate detection tested on Monolith's 3 clones | 5 |
| S2-7 | ✅ 2026-07-20 · Scoring + letter grades | Matches §5.2 math; snapshot-tested per corpus file | 1 |

---

## Sprint 3 — "It Explains" (E3, E4)

**Sprint goal:** a reviewer can open a process and understand it without reading XML.

| ID | Story | AC | Pts |
|---|---|---|---|
| S3-1 | ✅ 2026-07-20 · Vulnerabilities tab: findings list with severity filters, deep-link to stage in flow view | Click finding → stage highlighted in rendered React Flow graph | 5 |
| S3-2 | ✅ 2026-07-20 · Stage flow visualization per page | Directed graph incl. exception edges; readable on Monolith (virtualized) | 5 |
| S3-3 | ✅ 2026-07-20 · Deterministic summary generator | Apps touched, queues, I/O, exception strategy, step outline — asserted against corpus keys | 5 |
| S3-4 | ✅ 2026-07-20 · Data-sensitivity flagging in summaries | SSN/account patterns in names flagged; appears in Summary tab | 2 |
| S3-5 | ✅ 2026-07-20 · Improvements tab: recommendation engine v1 | MNT/REL findings mapped to UiPath-practice recommendations with rationale | 3 |

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
