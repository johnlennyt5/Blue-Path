# @prismshift/cli

Blue Prism analysis & conversion for terminals and CI pipelines. Runs the
exact same pipeline as the PrismShift web app — parse → 14-rule analysis →
scoring — with **no network calls, ever**.

```
prismshift analyze estate.bprelease --fail-below C
prismshift analyze exports/*.bprelease --json > report.json
prismshift analyze estate.bprelease --convert ./uipath-out
```

## Exit codes

| Code | Meaning |
|---|---|
| 0 | analysis passed all gates |
| 1 | a gate failed (`--fail-below`, `--max-critical`) |
| 2 | parse errors in at least one input |
| 3 | usage error / unreadable file |

## JSON schema (`--json`, schemaVersion 1)

```jsonc
{
  "tool": "prismshift",
  "schemaVersion": 1,
  "files": [
    {
      "file": "estate.bprelease",
      "packageName": "…",
      "bpVersion": "6.10.1.12345",
      "parseErrors": [],            // non-empty → exit 2
      "parseWarnings": 0,
      "components": [
        {
          "name": "Invoice Dispatcher",
          "role": "process",        // or "object"
          "score": 74,              // 0–100
          "grade": "C",             // A–F
          "stageCount": 10,
          "purpose": "…",           // deterministic summary line
          "findings": [
            { "ruleId": "SEC-001", "severity": "critical", "category": "security", "message": "…" }
          ]
        }
      ],
      "totals": {
        "findings": 3,
        "bySeverity": { "critical": 1, "high": 1, "medium": 1 },
        "worstGrade": "C",
        "averageScore": 90
      }
    }
  ]
}
```

`--convert <dir>` additionally writes one UiPath Studio Desktop project folder
per process (same output as the web app's ZIP: workflows, project.json,
Objects/, manifests, MIGRATION_REPORT.md).

## CI example (GitHub Actions)

```yaml
- run: npx prismshift analyze exports/*.bprelease --fail-below C --max-critical 0
```
