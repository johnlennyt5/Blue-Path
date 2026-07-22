# PrismShift — Infosec Approval Pack

For security reviewers evaluating PrismShift for use with production Blue
Prism exports. This document answers **"where does my data go?"** completely.
Companions: `docs/THREAT_MODEL.md` (threats/mitigations), `ARCHITECTURE.md`.

## 1. The one-paragraph answer

In **Local Mode** (the default), your `.bprelease` file is read into browser
memory, parsed, analyzed, and converted **on your machine**; nothing is
transmitted anywhere, the app works with the network cable unplugged
(PWA-verified), and closing the tab destroys everything. In **Workspace Mode**
(explicit opt-in), only *derived metadata* — component names, quality scores,
statuses, SHA-256 hashes, dependency edges — syncs to your team's workspace;
the XML and generated XAML never leave the browser. The optional **AI
narrative** (off by default, per-click) sends only a redaction-guaranteed
digest of names/types/structure through an audited, rate-limited server proxy.

## 2. Data-flow diagram

```
                        ┌────────────────────────────────────────────┐
 .bprelease  ──drop──▶  │  BROWSER (all parsing/analysis/conversion) │
                        │  • XML → IR → findings → XAML/PDF/ZIP      │
                        │  • Web Worker, offline-capable (PWA)       │
                        └───────┬────────────────────┬───────────────┘
                                │ opt-in             │ opt-in, per click
                    metadata only▼                   ▼ redacted digest only
                  ┌──────────────────────┐   ┌─────────────────────────┐
                  │ Supabase (Postgres)  │   │ llm-proxy Edge Function │
                  │ • RLS on every table │   │ • auth+membership gate  │
                  │ • names/scores/hashes│   │ • raw-XML blocker       │
                  │ • immutable audit    │   │ • 100KB cap, 30/h limit │
                  └──────────────────────┘   │ • key held server-side  │
                                             └───────────┬─────────────┘
                                                         ▼
                                             Anthropic / OpenAI API
                                             (names/types/structure only)
```

## 3. What each channel carries — exhaustively

| Channel | Carries | Never carries | Enforced by |
|---|---|---|---|
| Local Mode | nothing (no network) | — | PWA offline test in the harness; CSP `connect-src` |
| Metadata sync | bp_name, source SHA-256, version, stage count, score, grade, status, effort estimate, finding summaries (rule id, severity, location *path*, message), dependency edges (names+types) | XML, XAML, expressions, data values, selectors | `assertMetadataOnly` runtime scan + tests proving the serialized corpus payload has zero content markers |
| AI digest | component/page/stage/data-item **names**, types, exposure flags, stage kinds, `[references]` extracted from expressions, app element names+modes, queue/credential names | data-item values, expression text, selector attribute values, descriptions, XML | `assertNoValuesSurvive` runtime tripwire; fuzz property tests (40 planted values × 4 corpora, zero survivors); proxy-side raw-XML blocker (server-enforced, attempts audited) |
| Auth | email, Supabase JWT | passwords (magic-link only) | Supabase Auth |

## 4. Tenant isolation

Row-Level Security on **every** table from the first migration (no policy = deny).
Access derives from `workspace_members`; role model admin/editor/viewer.
Proven by 42 pgTAP assertions run in CI: cross-workspace reads return zero rows,
non-members see nothing, viewers cannot write, membership management is
admin-only, and `audit_events` accepts no UPDATE or DELETE from anyone —
including workspace admins.

## 5. Secrets

LLM API keys exist solely as Edge Function secrets (`supabase secrets set` in
hosted environments). The browser bundle contains only the Supabase URL and the
anon (public-by-design) key; data protection rests on RLS, not key secrecy.

## 6. Auditability

Every consequential action writes to an immutable log: workspace/member
lifecycle, syncs (`process.analyzed`), status changes (DB-trigger enforced,
from→to→actor), AI requests (`ai.narrative` — event and byte count only, never
content), blocked exfiltration attempts (`ai.blocked` with the matched marker),
settings changes, and purges (`workspace.purged` with counts). Retention is
admin-configurable; the purge event itself always survives.

## 7. Verification pointers (for auditors who read code)

- Redaction: `packages/reports/src/redact.ts` (+ `redact.test.ts` property suite)
- Metadata-only sync: `apps/web/src/lib/sync.ts` (`assertMetadataOnly`)
- Egress point: `supabase/functions/llm-proxy/index.ts` (+ live abuse suite `apps/web/src/lib/llmProxy.integration.test.ts`)
- RLS: `supabase/migrations/…rls_policies.sql` (+ `supabase/tests/*.sql`)
- Offline claim: S8-2 harness (headless offline analyze+convert, screenshot-verified)
