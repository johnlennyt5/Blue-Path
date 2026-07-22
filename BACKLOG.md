# PrismShift — Backlog

Deferred work with full context, so any future session (human or AI) can pick an
item up without archaeology. Each entry records **where it came from, why it was
deferred, exactly what is expected, and how we'll know it's done**. When a new
deferral happens during development, append it here in the same format.

Related: `PROJECT_PLAN.md` (sprint work + the original post-v1 list), `ARCHITECTURE.md` (constraints every item must respect — especially client-side processing and determinism).

---

## A. Product features (post-v1, from the original plan)

### BL-001 · Encrypted artifact storage
- **Origin:** ARCHITECTURE §1.1/§11 invariant; PROJECT_PLAN post-v1 list. The `workspaces.artifact_storage_enabled` flag exists in the Sprint-6 schema but the feature is flag-only.
- **Context:** Workspace Mode syncs metadata only. Some teams will want the raw `.bprelease`/generated XAML stored centrally for audit.
- **Expected behavior:** When a workspace admin enables the flag, artifacts are encrypted **client-side with AES-GCM before upload** (Web Crypto), keys generated and held by the workspace (never sent to Supabase); storage via Supabase Storage; download+decrypt round-trip in the browser. Key loss = artifact loss, stated explicitly in the UI.
- **Acceptance:** Network inspector shows only ciphertext leaving the browser; a pgTAP/RLS test proves cross-workspace isolation of artifact rows; decrypt round-trip test; admin-only toggle audited in `audit_events`.

### BL-002 · SSO (SAML/OIDC)
- **Origin:** ARCHITECTURE §8.4; post-v1 list.
- **Expected behavior:** Supabase enterprise SSO wired in with **zero schema changes** (the §8.4 design promise). Role mapping from IdP groups → `admin/editor/viewer` documented.
- **Acceptance:** Login via a test IdP (e.g. Okta dev) lands the user with correct RLS-scoped access; magic-link continues to work as fallback.

### BL-003 · CLI (`prismshift analyze *.bprelease`)
- **Origin:** Post-v1 list; the core packages were kept framework-free specifically to enable this. A precursor exists: `pnpm analyze <file>` (packages/rules/scripts/analyze.ts, added Sprint 2) — dev-only, tsx-run, not distributable.
- **Expected behavior:** A published CLI (npm bin) that runs parse → rules → summaries → optional convert on one or many files, with `--json` output for CI gates (e.g. "fail the pipeline if any process grades below C"), exit codes reflecting findings severity thresholds, and no network calls ever.
- **Acceptance:** Runs on Node 20+ from a packed tarball; JSON schema documented; corpus samples produce byte-identical output to the web app's analysis.

### BL-004 · Automation Anywhere source adapter
- **Origin:** Post-v1 list; IR was designed vendor-neutral for this.
- **Expected behavior:** A second parser package (`@prismshift/parser-aa`) emitting the same IR from AA exports. **No changes to rules/transformer/reports permitted** — that's the test of the IR abstraction. Corpus gains AA samples with answer keys in the existing schema.
- **Acceptance:** An AA sample passes the full pipeline (findings, summaries, conversion) with only the new parser package added.

### BL-005 · LLM-assisted code-stage translation
- **Origin:** Post-v1 list. Today, VB/C# code stages carry over verbatim into `ui:InvokeCode` flagged for review (S5-4); JScript is refused.
- **Expected behavior:** Opt-in (same disclosure gating as the S7 AI layer): send the code body — code only, after the S7-1 redaction rules — to the LLM for idiomatic .NET translation, returned as a *suggestion* diff the user accepts per stage; never auto-applied. JScript → VB.NET proposals included.
- **Acceptance:** Suggestion visible side-by-side with the original; accepting updates the emitted InvokeCode; declining keeps verbatim; everything logged in the migration report.

### BL-006 · Test-harness generation
- **Origin:** Post-v1 list.
- **Expected behavior:** From each BP process's startup params/outputs, generate UiPath Test Case stubs (arguments wired, assertion placeholders, one happy-path + one exception-path skeleton per process).
- **Acceptance:** Generated test cases open in Studio's Test Explorer without repair.

### BL-007 · Orchestrator API integration
- **Origin:** Post-v1 list. Today `QueuesManifest.json`/`AssetsManifest.json` (S5-2) are hand-off documents.
- **Expected behavior:** Optional, credentialed (user-supplied token, never stored) calls to Orchestrator's API to create the queues/assets from the manifests, with a dry-run preview and per-item success/failure report. Must remain optional — Local Mode never requires it.
- **Acceptance:** Dry-run lists intended creations; live run against a test Orchestrator creates them; failures reported per item without aborting the batch.

---

## B. Items raised during Sprints 1–5 (conversation-sourced)

### BL-008 · UiPath **Library** project export for objects
- **Origin:** 2026-07-21, Sprint-5 user review ("why does Invoice Entry VBO have no zip?").
- **Context/current behavior:** Objects are not standalone projects; their workflows are **copied** into every calling process's ZIP under `Objects\<Object>\`. Correct and self-contained, but N processes sharing a VBO get N copies — divergence risk after manual edits, and it ignores UiPath's proper reuse mechanism.
- **Expected behavior:** Optional per-object export as a UiPath **Library** project (`designOptions.outputType: "Library"`, publishable as NuGet); processes then reference the library as a dependency in `project.json` instead of carrying copies, and their `InvokeWorkflowFile` calls become library-activity invocations. A toggle chooses copy-mode (default, zero-infrastructure) vs library-mode (requires a feed/Orchestrator to host the package). MNT-003's "consolidate clones into a library" recommendation should link to this.
- **Acceptance:** Library project opens in Studio and publishes; a consuming process restores it from a local feed and runs; both modes covered by tests; migration report states which mode was used and why.

### BL-009 · Studio Web / cross-platform target
- **Origin:** 2026-07-21, the "Invalid file type" incident — user tried loading XAML into Studio Web/Maestro (cloud.uipath.com), which cannot open Windows XAML projects.
- **Context/current behavior:** Output targets Studio **Desktop** 2023.10+ (Windows/.NET 6, VB) per ARCHITECTURE §7.3 — correct for banking estates; the export note in the UI now says so.
- **Expected behavior (if demanded):** A second target profile emitting **cross-platform** projects (`targetFramework: "Portable"`, C# expressions, modern UIAutomation activity set with unified Target/descriptors). This is a *large* fork of the emitter layer: the expression translator would need a C# emitter and every activity shape differs. Do not start without a user with a concrete cloud-only requirement.
- **Acceptance:** A converted sample opens in Studio Web; expression translation passes a C#-emitter clone of the S5-1 table; both profiles selectable at export.

### BL-010 · Maestro/BPMN orchestration layer — *explicitly not planned*
- **Origin:** 2026-07-21 user question ("I thought UiPath ran on BPMN files").
- **Decision:** BPMN in UiPath is Maestro's *orchestration* layer; robot logic remains XAML. BP processes map to XAML processes. Generating Maestro BPMN that orchestrates our generated processes is a possible future product on top — record interest here if it recurs; not scoped further.

### BL-011 · Alert stage conversion
- **Origin:** Sprint 5; converter currently emits a TODO comment + punch entry for `alert` stages; the Conversion tab labels them "— (alert stage pending)". Corpus: the Monolith's "Log Customer Detail".
- **Expected behavior:** `alert` → `ui:LogMessage` (Level Info) with the translated message expression — plus a guard: if the message triggered SEC-003 (PII to logs), the emitted activity should carry a comment noting the finding so nobody ships PII logging by accident.
- **Acceptance:** Monolith alert converts; punch entry disappears; SEC-003-flagged alerts carry the warning comment; coverage on Monolith rises accordingly.

### BL-012 · Queue item data → DataTable auto-mapping (SpecificContent)
- **Origin:** S5-2. BP's "Get Next Item" outputs a Data collection; UiPath exposes `TransactionItem.SpecificContent` (dictionary). Currently: comment + punch entry, variable left unset.
- **Expected behavior:** When the output collection's fields are known (collection definition present), emit assigns building the row from `SpecificContent("<field>")` per field (typed via CDbl/CDate per field type), or — cleaner — rewrite downstream `[Coll.Field]` references directly to `TransactionItem.SpecificContent("Field")` and skip the DataTable entirely, punch-noting the rewrite.
- **Acceptance:** Performer converts with no SpecificContent punch entry; downstream field reads compile in Studio; behavior covered by tests on sample #2.

### BL-013 · Cross-page TransactionItem passing
- **Origin:** S5-2. Pages that Mark Completed/Exception without their own GetTransactionItem reference a local (Nothing) `TransactionItem`; flagged "pass it into this page or restructure".
- **Expected behavior:** Detect the pattern and automatically add an `io_TransactionItem` (QueueItem) argument to the callee page + bind it at every call site — same two-pass signature mechanism as S4-4.
- **Acceptance:** Performer's Process Item page receives the item; flag disappears; caller/callee signature tests extended.

### BL-014 · Polling-loop → REFramework restructuring
- **Origin:** S4-3/S5-6. BP performer loops (Get Next → process → loop back via Anchor) are detected as cycles and marked **manual** — correctly, but the restructuring is mechanical in the common case.
- **Expected behavior:** Recognize the specific shape [GetNext → guard-decision(empty?) → work → MarkStatus → back-edge] and, instead of a cycle warning, emit the work as the REFramework `Process` body with the loop handled by the framework's transaction loop. Anything deviating from the exact shape stays manual.
- **Acceptance:** Performer main page converts without the cycle punch entry, its work living in Process.xaml; a deliberately-deviant cycle still flags manual; Studio-openable.

### BL-015 · Expression translator gaps
- **Origin:** S5-1/S5-3 deliberate flags. Current: `DateDiff` supports only `"d"`; `DateAdd` unknown intervals flagged; `ExceptionStage()` refused; multi-condition waits convert first condition only (S5-4); regex attribute matches approximated (S5-4 selectors).
- **Expected behavior:** Extend per real-export demand (S8-6 protocol will reveal frequency): DateDiff w/m/h/n/s via TimeSpan components; wait stages with N conditions → N ElementExists + Or-combined If; keep the flag-don't-guess contract for anything else.
- **Acceptance:** Each added mapping lands with table-driven cases in `bpExpression.test.ts` (or wait cases in selectors tests); flags removed only where a mapping now exists.

### BL-016 · REFramework Config.xlsx
- **Origin:** S4-2 honesty note — binary artifacts aren't emitted; InitAllSettings is a commented scaffold.
- **Expected behavior:** Either generate a real `Data/Config.xlsx` (SheetJS — weigh the dependency against Local Mode bundle size) seeded from AssetsManifest entries, or emit `Config.json` + an InitAllSettings that reads it natively, documented in the migration report. Decide when Sprint-8 packaging is measured.
- **Acceptance:** Fresh REFramework export runs InitAllSettings in Studio without manual file creation.

### BL-017 · Studio-shape fidelity backstop (queue/UI activity XAML) — ✅ done (2026-07-21, Sprint 5 gate)
- **Origin:** S5 sprint-end risk note: `SetTransactionStatus`, `Target` descriptors, `InvokeCode` attribute shapes were written from knowledge, validated well-formed but **pending the user's Studio Desktop gate on the performer ZIP**.
- **Expected behavior:** If the gate reports repair prompts/unloadable activities, capture the exact Studio-emitted XAML for each failing activity and correct the emitters; add the corrected shapes to snapshot tests. This entry closes when the performer gate passes clean.
- **Acceptance:** Performer project opens in Studio Desktop with zero repair prompts; snapshots updated to the proven shapes.
- **Update (2026-07-21):** Gate ran and failed exactly as this entry anticipated; all root causes found empirically on the user's machine (official REFramework 25.10 template + activity DLL scans) and fixed:
  1. `ui:GetTransactionItem QueueName=…` → **`ui:GetQueueItem`** with the queue name in the **`QueueType`** attribute (UiPath's real property name — verified in the official template) and `TransactionItem` as a plain attribute.
  2. `ui:ElementExists` → **`ui:UiElementExists`** (the classic activity was renamed; confirmed present in UiPath.UiAutomation.Activities DLL, `ElementExists` absent).
  3. Converter bug: page variables were snapshotted **before** the recovery chain emitted, so `TransactionItem` added by Mark Exception was never declared (BC30451). Variables now collected after all chains emit.
  4. Option Strict (BC30512): invoke in-argument bindings and TypeInto `Text` now coerce Object/`Rows(0)(…)` expressions to the target type (`CStr`/`CDbl`/`CInt`/`CBool`/`CDate`); pure same-type identifier refs and literals stay unwrapped.
  5. InvokeCode arguments now carry real identifier types instead of blanket `Object` (fixes Object→DataTable on out-args).
  6. project.json dependencies bumped from 23.10 pins to Studio 26 stable defaults (`UiPath.System.Activities [26.6.1]`, `UiPath.UIAutomation.Activities [26.10.0]`, studioVersion 26.0.197.0) so validation matches the installed activity set.
  Still open until the user re-runs the Studio gate clean. → Closed same day, see round 2.
- **Update (2026-07-21, round 2):** Dispatcher gate then failed on `Could not find member 'QueueName' in AddQueueItem`. Parsed the .NET metadata of `UiPath.System.Activities.dll` (dnfile) — `UiPath.Core.Activities.AddQueueItem` properties are `Reference, QueueType, ItemInformation, ItemInformationCollection, Priority, DeferDate, DueDate, …`: **no QueueName; the queue name lives in `QueueType`, same as GetQueueItem** (true in both 23.10.2 and 26.6.1 — string scans mislead here; metadata is authoritative). Emitter fixed. Same metadata dump confirmed our GetQueueItem and SetTransactionStatus attribute sets are all real members. Lesson recorded: for activity shapes, trust (1) official template XAML, (2) assembly metadata property lists — never string presence.

### BL-021 · Invite emails (send the magic link to the invitee directly) — ✅ done (2026-07-22, same day)
- **Origin:** 2026-07-22, S6-3/S6-4 user testing — "shouldn't add member send a magic link to that email, allowing them to confirm and be added?"
- **Context/current behavior:** Adding an unknown email stores a **pending invite** (`workspace_invites`); the invitee joins automatically on their own first sign-in (`claim_workspace_invites()` runs post-auth). Works, but the invitee isn't notified — the admin must tell them out-of-band to go sign in.
- **Expected behavior:** An Edge Function (`invite-member`) holding the service-role key calls GoTrue's `auth.admin.inviteUserByEmail` (or `generate_link` type=invite + send), so the invitee receives an email with a sign-in link directly; clicking it lands them signed-in with memberships already claimed. Function must verify the caller is an admin of the workspace (JWT → private.workspace_role) before sending; audit `member.invite_emailed`. Locally the email lands in Mailpit.
- **Acceptance:** Admin invites an address with no account → that inbox receives a working sign-in link → clicking it lands the user in the workspace with the invited role; non-admin callers rejected; pgTAP/function tests cover the role check.
- **Done (2026-07-22):** `supabase/functions/invite-member/index.ts` (Deno, service key server-side only): verifies caller JWT → checks admin membership → `auth.admin.inviteUserByEmail` → audits `member.invite_emailed`. Declared in config.toml (`[functions.invite-member]` — v2 CLI serves only declared functions). Required new migration `20260722050000_service_role_grants.sql`: with no-auto-expose, **even service_role has zero implicit table grants** (RLS bypass ≠ grant bypass) + default privileges for future tables. Store tries the email after recording the invite; falls back to the sign-in-yourself message if delivery fails. E2E-verified: function 200 `{ok:true}`, "You've been invited" email in Mailpit; non-admin gets 403.

---

## C. Polish / S8 candidates (cosmetic, batched for the hardening sprint)

- **BL-018 · Flow-view edge label overlap** (S3-2): "on exception" labels can overlap node text at some zooms (seen next to Resume). Candidate fixes: label offset along edge path, or hide labels below a zoom threshold.
- **BL-019 · SEC-004 message escaping** (Sprint-2 review): UNC paths display as `\\\\fs01\\…` because messages JSON-stringify the value; render raw path in UI/report contexts.
- **BL-020 · Release-level view**: landing page could show release-wide aggregates (worst grade, total findings by severity, estate effort sum from migration reports) above the owner cards. Raised implicitly by the "download all" review (2026-07-21); pairs naturally with S6's program dashboard — check overlap before building.

---

*Maintenance rule: when deferring anything in future sessions, append it here with Origin (date + trigger), Context/current behavior, Expected behavior (specific enough to implement cold), and Acceptance. Never delete entries — mark them `✅ done (date, story)` when delivered.*
