/**
 * Recommendation engine (S3-5): maps every rule family's findings to
 * UiPath-practice recommendations with rationale citing the concrete
 * findings. Every finding is addressed by exactly one recommendation.
 */
import type { AutomationModel, Finding, FindingSeverity } from '@prismshift/ir';
import { SEVERITY_RANK } from '@prismshift/rules';

export interface Recommendation {
  /** Stable id, e.g. "REC-DISPATCHER-PERFORMER". */
  id: string;
  title: string;
  /** The UiPath best practice to apply. */
  practice: string;
  /** Why — cites the findings that triggered it. */
  rationale: string;
  /** Rule ids that fed this recommendation. */
  ruleIds: string[];
  /** Worst severity among the triggering findings — drives display color. */
  severity: FindingSeverity;
  /** Worst severity per triggering rule (badge coloring per rule id). */
  ruleSeverities: Record<string, FindingSeverity>;
  findingCount: number;
}

interface RecommendationTemplate {
  id: string;
  title: string;
  practice: string;
}

const TEMPLATES: Record<string, RecommendationTemplate> = {
  // SEC-001 and SEC-002 share one remediation: secrets belong in Credential
  // Manager — their findings merge into a single recommendation.
  'SEC-001': {
    id: 'REC-CREDENTIAL-MANAGER',
    title: 'Move secrets to Credential Manager',
    practice:
      'Store every credential in an Orchestrator credential asset and fetch it at runtime with GetCredential — never as hardcoded literals or plain-text parameters.',
  },
  'SEC-002': {
    id: 'REC-CREDENTIAL-MANAGER',
    title: 'Move secrets to Credential Manager',
    practice:
      'Store every credential in an Orchestrator credential asset and fetch it at runtime with GetCredential — never as hardcoded literals or plain-text parameters.',
  },
  'SEC-003': {
    id: 'REC-MASK-PII-LOGS',
    title: 'Keep PII out of logs',
    practice:
      'Log masked or tokenized references instead of raw PII; in UiPath keep sensitive values out of Log Message activities and set robot log retention accordingly.',
  },
  'SEC-004': {
    id: 'REC-EXTERNALIZE-CONFIG',
    title: 'Externalize environment values',
    practice:
      'Move URLs, paths, and server names into Orchestrator assets (or a config file) so environments can change without editing workflows.',
  },
  'CMP-001': {
    id: 'REC-ENCRYPT-QUEUES',
    title: 'Encrypt queues carrying PII',
    practice:
      'Enable encryption on queues holding personal data, or tokenize/strip PII fields before queuing; in UiPath prefer encrypted queue data or encrypted Storage Buckets.',
  },
  'CMP-002': {
    id: 'REC-DOCUMENT-PROCESSES',
    title: 'Document processes and objects',
    practice:
      'Add descriptions before migrating — reviewers and auditors need them, and PrismShift summaries and AI narratives improve with them.',
  },
  'REL-001': {
    id: 'REC-REFRAMEWORK-EXCEPTIONS',
    title: 'Adopt REFramework exception handling',
    practice:
      "Wrap transaction work in REFramework's Try/Catch with SetTransactionStatus so every failure is caught, logged, and retried by policy instead of killing the run.",
  },
  'REL-002': {
    id: 'REC-BOUNDED-RETRIES',
    title: 'Bound retry loops',
    practice:
      'Replace unguarded cycles with RetryScope or REFramework retry settings (MaxRetryNumber) so a permanent failure exhausts retries instead of looping forever.',
  },
  'REL-003': {
    id: 'REC-TIMEOUTS',
    title: 'Give every wait a timeout',
    practice:
      'Set explicit Timeout properties on UI activities and handle the timeout path — hung waits become diagnosable failures instead of stuck robots.',
  },
  'REL-004': {
    id: 'REC-STABLE-SELECTORS',
    title: 'Re-spy index-matched elements',
    practice:
      'Rebuild selectors on stable attributes (AutomationId, name, id) before migration — index-based UiPath selectors break on any UI reordering and will be flagged low-confidence in conversion.',
  },
  'MNT-001': {
    id: 'REC-DELETE-DEAD-LOGIC',
    title: 'Remove dead logic before migrating',
    practice:
      'Delete unreachable stages and orphaned pages in Blue Prism first — converting dead logic costs review time and confuses the migrated project.',
  },
  'MNT-002': {
    id: 'REC-PRUNE-DATA',
    title: 'Prune unused data items',
    practice:
      'Remove unused data items so converted workflow arguments/variables map one-to-one to real data flow.',
  },
  'MNT-003': {
    id: 'REC-SHARED-LIBRARY',
    title: 'Consolidate duplicate objects into a library',
    practice:
      'Merge near-duplicate objects into one implementation and migrate it as a single UiPath library project consumed as a dependency by every process. PrismShift can export any object as a publishable library: object view → "⬇ Library project", or bundle with "shared objects as libraries".',
  },
  'MNT-004': {
    id: 'REC-DISPATCHER-PERFORMER',
    title: 'Split the monolith into dispatcher/performer',
    practice:
      'Break the process into a queue-driven pair: a small dispatcher that loads work items and an REFramework performer that processes them one transaction at a time.',
  },
};

/** Human location for a finding, resolved against the model. */
function findingSpot(model: AutomationModel, finding: Finding): string {
  const owner =
    model.processes.find((p) => p.id === finding.location.processId) ??
    model.objects.find((o) => o.id === finding.location.objectId);
  if (!owner) return 'unknown location';
  const page = owner.pages.find((p) => p.id === finding.location.pageId);
  const stage = page?.stages.find((s) => s.id === finding.location.stageId);
  if (stage) return `"${stage.name}" (${page!.name})`;
  if (page) return `page "${page.name}"`;
  if (finding.location.elementId !== undefined && 'appModel' in owner) {
    const element = owner.appModel?.elements.find((e) => e.id === finding.location.elementId);
    if (element) return `element "${element.name}"`;
  }
  return owner.name;
}

/**
 * Recommendations for one process/object (or the whole model when ownerId is
 * omitted). Ordered by the severity of what triggered them.
 */
export function buildRecommendations(
  model: AutomationModel,
  findings: Finding[],
  ownerId?: string,
): Recommendation[] {
  const scoped = findings.filter(
    (f) =>
      ownerId === undefined ||
      f.location.processId === ownerId ||
      f.location.objectId === ownerId,
  );

  const byTemplate = new Map<string, { template: RecommendationTemplate; findings: Finding[] }>();
  for (const finding of scoped) {
    const template = TEMPLATES[finding.ruleId];
    if (!template) continue;
    const entry = byTemplate.get(template.id) ?? { template, findings: [] };
    entry.findings.push(finding);
    byTemplate.set(template.id, entry);
  }

  const bySeverityRank = (rank: number): FindingSeverity =>
    (Object.entries(SEVERITY_RANK).find(([, r]) => r === rank)?.[0] ?? 'info') as FindingSeverity;

  const recommendations = [...byTemplate.values()].map(({ template, findings: hits }) => {
    const spots = hits.slice(0, 3).map((f) => findingSpot(model, f));
    const more = hits.length > 3 ? ` and ${hits.length - 3} more` : '';
    const worstRank = Math.min(...hits.map((f) => SEVERITY_RANK[f.severity]));

    const ruleSeverities: Record<string, FindingSeverity> = {};
    for (const hit of hits) {
      const current = ruleSeverities[hit.ruleId];
      if (current === undefined || SEVERITY_RANK[hit.severity] < SEVERITY_RANK[current]) {
        ruleSeverities[hit.ruleId] = hit.severity;
      }
    }

    return {
      ...template,
      rationale: `Addresses ${hits.length} finding${hits.length === 1 ? '' : 's'}: ${spots.join(', ')}${more}.`,
      ruleIds: [...new Set(hits.map((f) => f.ruleId))].sort(),
      severity: bySeverityRank(worstRank),
      ruleSeverities,
      findingCount: hits.length,
      worstRank,
    };
  });

  recommendations.sort((a, b) => a.worstRank - b.worstRank || a.id.localeCompare(b.id));
  return recommendations.map(({ worstRank: _worstRank, ...rec }) => rec);
}

/** How many of the owner's findings are covered by some recommendation. */
export function recommendationCoverage(
  findings: Finding[],
  ownerId?: string,
): { covered: number; total: number } {
  const scoped = findings.filter(
    (f) =>
      ownerId === undefined ||
      f.location.processId === ownerId ||
      f.location.objectId === ownerId,
  );
  return {
    covered: scoped.filter((f) => TEMPLATES[f.ruleId] !== undefined).length,
    total: scoped.length,
  };
}
