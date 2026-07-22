# Real-Export Validation Protocol (S8-6)

The corpus is hand-built. Before trusting PrismShift on a production estate,
run one **sanitized real export** through this protocol. It finds the gap
between our assumptions and your Blue Prism version's actual XML — and turns
each gap into a concrete parser fix.

## Step 0 — Sanitize (do this inside your environment)

1. In Blue Prism, export a *small but representative* release: 1–2 processes,
   one VBO with App Modeller elements, a queue if you use them.
2. Open the `.bprelease` in a text editor. Replace, if present:
   - `<initialvalue>` contents that hold real credentials/URLs/paths
   - environment-variable `<value>`s
   - anything in stage names that identifies customers
3. Keep the *structure* untouched — do not delete elements or attributes;
   sanitize values in place. Structure is what we're validating.

Nothing in this protocol requires the export to leave your machine: PrismShift
runs locally, and every check below is local.

## Step 1 — Intake & parse triage

Load the file in PrismShift (Local Mode). Record in a copy of the checklist:

- [ ] File loads (if not: note the intake error verbatim)
- [ ] Zero parse **errors** (red banner) — any error = a structural assumption gap
- [ ] Review parse **warnings** (amber) — each names the odd construct and its XML path
- [ ] Console (F12): `[PrismShift] parse complete: N processes, M objects…` matches
      what the release actually contains — a mismatch means silently dropped components

## Step 2 — Model fidelity spot-checks (against Blue Prism side-by-side)

Open each process; verify against BP Studio:

- [ ] **Structure tab**: page count and data-item count match
- [ ] **Flow tab**: pick the main page — every stage present, links flowing the
      right way, exception (Recover/Resume) paths shown
- [ ] **Summary tab**: applications, queues, inputs/outputs match reality
- [ ] Payload integrity: pick 3 calculation stages in BP; confirm their
      expressions appear (Conversion tab rows / punch list) — not blank

## Step 3 — Analysis sanity

- [ ] Findings point at real locations ("Show in flow" lands on the right stage)
- [ ] No absurd counts (hundreds of findings on a clean process = rule misfire —
      capture which rule)

## Step 4 — Conversion gate

- [ ] Download the UiPath project; open in **Studio Desktop** (Windows/VB, 2023.10+)
- [ ] Project loads with no "activity could not be loaded" / repair prompts
- [ ] `MIGRATION_REPORT.md` coverage % is plausible; punch list entries reference
      real stages; selector checklist lists your App Modeller elements
- [ ] Spot-check one page's XAML against the BP page it came from

## Step 5 — File the gaps (parser adapter checklist)

For every ❌ above, capture: your Blue Prism version, the XML fragment (a few
sanitized lines), what PrismShift did vs expected. Then:

| Gap type | Where the fix goes |
|---|---|
| Unknown stage `type=` | `packages/parser/src/parse.ts` stage mapping + a new corpus fragment |
| Attribute/element name drift (BP version differences) | parser accessors + corpus sample exported from that BP version |
| App Modeller attribute variants | `packages/transformer/src/selectors.ts` mode table |
| Expression function we don't map | `packages/transformer/src/bpExpression.ts` FUNCTIONS + table test |
| Activity fails to load in Studio | `packages/transformer/src/xaml.ts` — validate against the installed package DLL/template (see BL-017 method: official template XAML + assembly metadata, never guesses) |

**Rule: every real-export gap becomes a corpus fragment + answer-key entry in
the same PR as the fix** — the corpus grows toward reality one validated
export at a time.

## Sign-off

| Check | Result | Notes |
|---|---|---|
| Parse clean | ☐ | |
| Model fidelity | ☐ | |
| Analysis sane | ☐ | |
| Studio gate | ☐ | |
| Gaps filed | ☐ | |

Validated by: ____________  Date: ________  BP version: ________
