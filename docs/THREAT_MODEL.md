# PrismShift Threat Model & Security Review (S8-4)

Reviewed 2026-07-22 · covers the v1 architecture (Sprints 1–8).
Companion docs: `ARCHITECTURE.md` (invariants), `docs/INFOSEC_PACK.md` (data-flow answers for reviewers).

## 1. What we protect

| Asset | Where it lives | Sensitivity |
|---|---|---|
| Blue Prism XML (`.bprelease`) | Browser memory only, never persisted, never transmitted | **Highest** — contains business logic, credentials references, selectors, embedded values |
| Generated UiPath XAML / ZIPs / PDF reports | Browser memory, user-initiated downloads | High — derived from the above |
| Analysis metadata (names, scores, statuses, hashes) | Supabase (Workspace Mode only, opt-in) | Medium — names can be business-sensitive |
| AI digests (names/types/structure) | Transient: browser → llm-proxy → LLM provider | Medium — redaction-guaranteed subset |
| Auth sessions / JWTs | Browser localStorage (supabase-js) | High |
| API keys (Anthropic/OpenAI) | Edge Function secrets only | High |
| Audit trail | Supabase `audit_events` (immutable) | Medium |

## 2. Trust boundaries & data flows

```
[.bprelease file] → (browser: parse/analyze/convert — NO network)     Local Mode
                    ↓ opt-in only
[metadata sync] → Supabase REST (RLS) → Postgres                      Workspace Mode
[AI digest]     → llm-proxy Edge Fn → Anthropic/OpenAI                Opt-in, per click
[invites/purge] → Edge Fns (service key server-side)
```

Boundary 1: **file → browser.** Everything works with zero network (PWA-proven offline).
Boundary 2: **browser → Supabase.** Only metadata; enforced by `assertMetadataOnly` (runtime scan) + tests.
Boundary 3: **browser → LLM.** Only the redacted digest; enforced by `assertNoValuesSurvive` (runtime scan), the proxy's raw-XML blocker, and property tests.

## 3. Threats & mitigations (STRIDE-abbreviated)

| Threat | Vector | Mitigation | Status |
|---|---|---|---|
| Source XML exfiltration | Sync or AI path smuggling content | `assertMetadataOnly` + digest redaction + proxy XML blocker (server-side, audited) — three independent layers | ✅ tested (fuzz + live) |
| Data-item values reaching an LLM | Digest construction bug | Values never enter the digest; runtime tripwire refuses leaking digests; 4-sample fuzz property tests | ✅ tested |
| Cross-tenant data access | Workspace isolation failure | RLS on every table from migration #1; 42 pgTAP assertions incl. cross-workspace denial, run in CI | ✅ tested |
| Privilege escalation (member → admin) | Role-gated writes | RLS role checks + security-definer RPCs with explicit gates; UI mirrors but never substitutes | ✅ tested |
| Audit tampering | Rewrite/delete history | No UPDATE/DELETE policies or grants on `audit_events`; proven even for admins | ✅ tested |
| API key exposure | Client bundle / repo leak | Keys exist only as Edge Function secrets; `.env` gitignored; `.env.example` templates scrubbed; one near-miss caught pre-push (keys flagged for rotation) | ✅ + rotation advised |
| LLM cost abuse / DoS | Hammering the proxy | Per-workspace rate limit (30/h), 100 KB ceiling, membership gate — all before the upstream call; proven live (429 after exactly 30) | ✅ tested |
| XSS | Injected content from a malicious `.bprelease` | React auto-escaping everywhere (no `dangerouslySetInnerHTML` in the codebase); CSP: `script-src 'self'`, no inline scripts, `object-src 'none'` | ✅ CSP shipped |
| Clickjacking | Framing the app | `frame-ancestors` cannot be set via meta CSP — **hosting layer must send it as a header** (`frame-ancestors 'none'`) | ⚠️ deploy checklist |
| Supply chain | Malicious/vulnerable deps | `pnpm audit --prod` clean (fast-xml-parser upgraded 4→5 for GHSA-gh4j-gqv2-49f6; corpus suite proved parse-compat); lockfile committed; CI installs frozen | ✅ clean 2026-07-22 |
| Malicious XML (billion laughs / entity bombs) | Parser resource exhaustion | fast-xml-parser entity-expansion limit (observed firing at >1000 entities); 50 MB hard cap; worker try/catch keeps the app alive | ✅ observed live |
| Stale/orphaned sessions | Local db resets, token replay | Stale-session guard (errcode 28000); JWT expiry 1 h + refresh rotation (Supabase default) | ✅ |
| Invite abuse | Spamming invites / squatting | Admin-only invite RPC + email send; invites are per-workspace keyed by email (upsert, no duplicates); revocable | ✅ tested |

## 4. Deploy checklist (hosting layer)

- [ ] Send `frame-ancestors 'none'` (or explicit allow-list) as a response header — meta CSP cannot
- [ ] Send `Strict-Transport-Security` on the hosting domain
- [ ] Tighten `connect-src` to the exact Supabase project URL (replace the generic `https:` allowance)
- [ ] `supabase secrets set` for ANTHROPIC/OPENAI keys — never files, never CI variables echoed to logs
- [ ] Rotate any key that ever transited an insecure channel (two flagged during development)
- [ ] Supabase Auth: enable email rate limits; review `site_url`/redirect allow-list for the hosted domain

## 5. Accepted residual risks (v1)

1. **Names are metadata.** Process/data-item names may themselves be business-sensitive; Workspace Mode is opt-in and named-scoped per workspace — documented in the UI disclosure. Estates that consider names sensitive should stay in Local Mode.
2. **Custom AI endpoint is user-trusted.** If a user points the AI narrative at their own endpoint, the digest goes where they said — by design (still redacted).
3. **`style-src 'unsafe-inline'`.** React inline style attributes (graph node coloring) require it; script injection remains blocked (`script-src 'self'`). Revisit with hashed styles post-v1.
