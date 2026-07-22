# PrismShift User Guide

PrismShift analyzes, documents, and converts Blue Prism estates to UiPath —
**entirely in your browser**. This guide covers both modes and every screen.

## 1. Quick start (Local Mode — the default)

1. Open PrismShift. The green badge says **"Local Mode — data stays in your browser"** — that's literal: no file content ever leaves the tab.
2. **Drop a `.bprelease` file** (or a single-process `.xml`) onto the drop zone, or click it / press Enter to browse. Up to 50 MB; large files show live parse progress.
3. You land on the **estate view**: one card per process/object with a quality grade (A–F), score, and finding count.

Works fully offline after the first visit (it's a PWA) — analyze and convert on a plane.

## 2. The analysis view (click any card)

| Tab | What it shows |
|---|---|
| **Summary** | Deterministic documentation: what it does, applications touched, queues, inputs/outputs, exception strategy, step-by-step outline per page. Optional **AI narrative** at the bottom (see §5). |
| **Vulnerabilities** | Findings from the 14-rule catalog (security/reliability/maintainability/compliance), each with severity, location, and "Show in flow" deep link. Severity filters included. |
| **Improvements** | A recommendation for every finding, color-matched to the vulnerability it addresses. |
| **Conversion** | One row per Blue Prism stage: the exact UiPath outcome, status (converted / review / manual), and confidence. The honest picture of what migration takes. |
| **Flow** | The stage graph per page — decisions, loops, exception paths (color-coded, direction arrows). Keyboard: arrow keys switch tabs; the fit button re-centers. |
| **Structure** | Pages, data items, and raw counts. |

## 3. Converting to UiPath

- **Per process:** "⬇ Download UiPath project" — a ZIP that opens in **UiPath Studio Desktop 2023.10+ (Windows, VB)**. Studio Web/Maestro cannot open XAML projects.
- **Whole estate:** "⬇ Download all UiPath projects" — one folder per process, each self-contained (its VBO workflows ship inside as `Objects\…`).
- Every ZIP includes `MIGRATION_REPORT.md`: conversion coverage, the punch list of remaining manual work, the **mandatory selector validation checklist**, and an effort estimate.
- Queue-driven processes get the full **REFramework** layout, wired to the right queue; `AssetsManifest.json`/`QueuesManifest.json` list what to create in Orchestrator.
- **⬇ Audit report (PDF):** rollup + per-component findings + sign-off block, generated locally.

## 4. Workspace Mode (team collaboration, opt-in)

Click **Workspace ▾** in the header. The badge flips to violet: *"metadata syncs, content stays local."* Only names, scores, statuses, and hashes sync — never XML or XAML.

- **Sign in** with an email magic link.
- **Create a workspace**; invite teammates by email (they get a sign-in link; roles: admin / editor / viewer).
- **Sync analysis** pushes the loaded release's metadata into a named program. Re-syncing the same release updates in place.
- The **Migration Tracker** appears below: effort/score rollups, per-process status you can advance (analyzed → converted → validating → validated → deployed / blocked), filters, the shared-hotspot **dependency graph**, and the audit trail (every status change records who/when/what).
- **Settings** (admins): audit retention in days, and **Purge workspace data** (hard delete, always audited).

Roles: viewers see everything, change nothing. Editors sync and update statuses. Admins manage members, settings, and purge.

## 5. AI narrative (opt-in, off by default)

At the bottom of any Summary tab. Enabling shows a disclosure of exactly what would be sent: a **redacted digest** — names, types, structure; never XML, expression text, data values, or selectors. Generate via:
- **Workspace proxy** — the server holds the LLM key; requests are rate-limited, size-capped, and audited (event only, no content), or
- **Custom endpoint** — your own LLM service receives the digest.

Output is badged AI-generated; verify before relying on it.

## 6. Limits & honesty

- 50 MB maximum export size (split larger releases in Blue Prism).
- Generated selectors **cannot be validated without the live applications** — the checklist in every migration report is mandatory work.
- Conversion is assisted, not magic: the punch list *is* the product. Anything PrismShift couldn't convert safely is flagged, never silently guessed.
