# Corpus Guide — the test estate behind PrismShift

`packages/corpus` is the ground-truth test suite: four hand-built `.bprelease`
samples with **answer keys** that CI enforces bidirectionally — a missed
finding fails, and so does a false positive. Every parser, rule, and converter
change must survive the corpus.

## The samples

| Sample | Personality | What it exercises |
|---|---|---|
| `01-clean-and-simple` | A well-built loan calculator | Happy path: clean parse, A-grade, 100% conversion, business-rule throw |
| `02-realistic-mid-size` | Invoice dispatcher + performer + shared VBO | The realistic case: queues (REFramework), App Modeller selectors, VB code stage, credentials, cross-page exception flow, shared-object hotspots |
| `03-the-monolith` | One giant process, many sins | Rule catalog stress: hard-coded credentials, PII logging, missing exception handling, oversized pages, clone detection |
| `04-edge-cases` | Deliberately weird | Citrix/Region (image/OCR) targets, regex selectors, missing timeouts, JScript refusal, malformed-adjacent shapes |

## Answer keys (`*.answer-key.json`)

Per sample: expected findings (`ruleId` + location), `expectedSummaries`,
`sensitiveItems`, `strayStageCount`, selector `elementName`s. The
`diffFindings` harness compares actual vs expected **both directions**.

Also enforced corpus-wide: a payload-integrity invariant (every stage keeps
its expression/storeIn through parsing — this caught a real single-vs-multi
calculation parser bug), and byte-determinism of analysis output.

## Adding a sample

1. Author the `.bprelease` (hand-write or export from a dev Blue Prism).
2. Add `NN-name.answer-key.json` — start with expected findings you can defend.
3. `pnpm test` — the harness reports both missed and unexpected findings;
   iterate until the diff is empty.
4. If the new sample exposes a parser gap, fix the parser in the same PR —
   samples and code move together.

Synthetic scale testing (5–50 MB) lives separately in
`packages/parser/src/chunked.test.ts` (generator + CI budgets); the corpus
stays small, readable, and semantically loaded.
