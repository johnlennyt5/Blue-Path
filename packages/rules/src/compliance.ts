/**
 * Compliance rules CMP-001…CMP-002 (ARCHITECTURE §5.1).
 */
import { defineRule, makeFinding } from './engine';
import type { Rule } from './engine';
import { SENSITIVE_NAME, baseIdentifier, eachOwner, identifierRefs, locationOf, walkStages } from './helpers';

// ---------------------------------------------------------------------------
// CMP-001 — PII queued without encryption
// ---------------------------------------------------------------------------

const cmp001 = defineRule(
  {
    id: 'CMP-001',
    title: 'PII on unencrypted queue',
    severity: 'high',
    category: 'compliance',
    description:
      'Queue item data includes PII-named fields while the target work queue is not encrypted.',
  },
  (model) => {
    const findings = [];
    const queuesByName = new Map(model.workQueues.map((q) => [q.name, q]));

    for (const visit of walkStages(model)) {
      const stage = visit.stage;
      if (stage.kind !== 'action' || stage.queueName === undefined) continue;
      if (!/add/i.test(stage.actionName)) continue;

      const queue = queuesByName.get(stage.queueName);
      if (queue?.encrypted === true) continue;

      const dataInput = stage.inputs.find((i) => i.paramName === 'Data');
      if (!dataInput) continue;

      const owner = visit.owner;
      const sensitiveFields: string[] = [];
      for (const ref of identifierRefs(dataInput.expression.raw)) {
        const item = owner.dataItems.find((d) => d.name === baseIdentifier(ref));
        for (const field of item?.fields ?? []) {
          if (SENSITIVE_NAME.test(field.name)) sensitiveFields.push(field.name);
        }
      }

      if (sensitiveFields.length > 0) {
        findings.push(
          makeFinding(
            cmp001.meta,
            locationOf(visit),
            `Stage "${stage.name}" queues PII field(s) ${[...new Set(sensitiveFields)].join(', ')} to unencrypted queue "${stage.queueName}".`,
            'Enable queue encryption or tokenize/strip the PII fields before queuing; in UiPath store PII in encrypted Storage Buckets or encrypted queue item data.',
            0.85,
          ),
        );
      }
    }
    return findings;
  },
);

// ---------------------------------------------------------------------------
// CMP-002 — missing documentation
// ---------------------------------------------------------------------------

const cmp002 = defineRule(
  {
    id: 'CMP-002',
    title: 'Missing documentation',
    severity: 'info',
    category: 'compliance',
    description: 'A process or object has no description/narrative.',
  },
  (model) => {
    const findings = [];
    for (const { owner, ownerType } of eachOwner(model)) {
      if (owner.description === undefined || owner.description.trim() === '') {
        findings.push(
          makeFinding(
            cmp002.meta,
            ownerType === 'process' ? { processId: owner.id } : { objectId: owner.id },
            `${ownerType === 'process' ? 'Process' : 'Object'} "${owner.name}" has no description.`,
            'Document intent before migrating — reviewers and auditors need it, and PrismShift summaries improve with it.',
            1,
          ),
        );
      }
    }
    return findings;
  },
);

export const CMP_RULES: Rule[] = [cmp001, cmp002];
