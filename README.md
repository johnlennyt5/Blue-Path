# PrismShift

**Enterprise Blue Prism → UiPath Migration Platform**

PrismShift is a web-based tool that ingests Blue Prism release exports (`.bprelease`), analyzes them for risk and quality issues, generates plain-English process documentation, and produces a best-effort UiPath project conversion with a full audit trail — all designed for regulated enterprise environments (banking/financial services).

---

## What It Does

| Module | Output |
|---|---|
| **Summarize** | Plain-English documentation of what each Blue Prism process does: applications touched, inputs/outputs, queue interactions, exception paths, data sensitivity flags |
| **Analyze** | Vulnerability & risk report: hardcoded credentials, missing exception handling, brittle selectors, PII-in-logs, dead logic, infinite loop risk — each process receives a letter-grade quality score |
| **Improve** | Actionable recommendations mapped to UiPath best practices (REFramework restructuring, queue triggers, shared libraries, Orchestrator assets) |
| **Transform** | Downloadable UiPath project (project.json + XAML, REFramework layout) with a per-process migration report: what converted cleanly, what is approximate, what needs manual work |
| **Track** | Migration program dashboard: per-process status (Analyzed → Converted → Validated → Deployed), effort estimates, dependency graph |

## Core Design Principle: Privacy-First

Blue Prism exports contain confidential business logic, internal system names, and credential references. PrismShift is architected so that **all parsing, analysis, and transformation run client-side in the browser**. Pipeline content never touches a server by default.

Two operating modes:

- **Local Mode (default):** Zero network calls with pipeline data. Everything happens in-browser; exports download directly to the user's machine. Suitable for evaluation before infosec approval.
- **Workspace Mode (opt-in):** Supabase backend stores *metadata only* (process names, scores, findings, migration status) to power the team dashboard and audit history. Raw `.bprelease` content and generated XAML are never persisted server-side unless an admin explicitly enables encrypted artifact storage.

The optional AI documentation layer is gated behind an explicit toggle with a clear "data leaves your machine" disclosure, and supports pointing at an internally-approved endpoint.

## Tech Stack

- **Language:** TypeScript end-to-end (strict mode)
- **Frontend:** React 18 + Vite, Tailwind CSS, Zustand (state), React Flow (dependency/stage graphs)
- **Parsing/Analysis Core:** Pure TypeScript packages (`@prismshift/parser`, `@prismshift/ir`, `@prismshift/rules`, `@prismshift/transformer`) — framework-free, runs in browser or Node
- **Backend:** Supabase — Postgres (metadata, RLS-enforced multi-tenancy), Auth (SSO-ready), Edge Functions (optional LLM proxy), Storage (opt-in encrypted artifacts)
- **Testing:** Vitest + answer-key validation corpus of synthetic `.bprelease` files
- **Packaging:** pnpm monorepo (Turborepo)

## Repository Layout

```
prismshift/
├── apps/
│   └── web/                  # React app (Vite)
├── packages/
│   ├── parser/               # .bprelease XML → IR
│   ├── ir/                   # Intermediate Representation types + graph utils
│   ├── rules/                # Vulnerability & quality rules engine
│   ├── transformer/          # IR → UiPath XAML + project.json
│   ├── reports/              # Audit report / PDF generation
│   └── corpus/               # Synthetic .bprelease test files + answer keys
├── supabase/
│   ├── migrations/           # SQL schema
│   └── functions/            # Edge Functions (llm-proxy)
├── ARCHITECTURE.md
├── PROJECT_PLAN.md
└── README.md
```

## Quick Start (Development)

```bash
# Prerequisites: Node 20+, pnpm 9+, Supabase CLI (optional, Workspace Mode only)

pnpm install
pnpm dev              # starts the web app in Local Mode at http://localhost:5173

# Run the core test suite (parser/rules validated against the answer-key corpus)
pnpm test

# Workspace Mode (optional)
supabase start        # local Supabase stack
supabase db reset     # apply migrations
cp apps/web/.env.example apps/web/.env.local   # add local Supabase URL + anon key
```

Drag any file from `packages/corpus/samples/` into the app to see the full pipeline run.

## Status & Roadmap

See [PROJECT_PLAN.md](./PROJECT_PLAN.md) for epics, sprint plan, and user stories. See [ARCHITECTURE.md](./ARCHITECTURE.md) for the complete technical specification.

## Disclaimer

PrismShift produces *assisted* conversions, not guaranteed ones. Target automation rate is 70–85% with a clear punch list of manual work per process. Generated selectors cannot be validated without the live target applications and are always flagged for human review. Before processing production exports from an employer environment, obtain the appropriate information-security approval.
