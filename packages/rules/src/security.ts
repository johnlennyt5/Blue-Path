/**
 * Security rules SEC-001…SEC-004 (ARCHITECTURE §5.1).
 *
 * Detection is deliberately keyword-gated where names are available — the
 * corpus enforces zero false positives, so heuristics prefer precision.
 */
import { defineRule, makeFinding } from './engine';
import type { Rule } from './engine';
import {
  SENSITIVE_NAME,
  dataItemStages,
  eachOwner,
  identifierRefs,
  inputBindings,
  locationOf,
  ownerLocation,
  walkStages,
  wholeLiteral,
} from './helpers';

const CREDENTIAL_NAME = /passw(or)?d|\bpwd\b|secret|api[\s_-]?key|\btoken\b|credential/i;

/** Looks like an actual secret value: 8+ chars mixing letters with non-letters. */
function credentialStrength(value: string): boolean {
  return value.length >= 8 && /[A-Za-z]/.test(value) && /[^A-Za-z\s]/.test(value);
}

const SSN_DIGITS = /\b\d{3}-\d{2}-\d{4}\b/;

const UNC_PATH = /^\\\\[\w$.-]+\\/;
const URL_VALUE = /^https?:\/\//i;
const INTERNAL_HOST = /^[\w-]+\.(corp|local|internal|lan)\b/i;

const looksLikeEnvironmentValue = (value: string): boolean =>
  UNC_PATH.test(value) || URL_VALUE.test(value) || INTERNAL_HOST.test(value);

// ---------------------------------------------------------------------------
// SEC-001 — credential-like literal in a data item initial value or expression
// ---------------------------------------------------------------------------

const sec001 = defineRule(
  {
    id: 'SEC-001',
    title: 'Hardcoded credential literal',
    severity: 'critical',
    category: 'security',
    description:
      'A data item initial value or expression contains a literal that looks like a credential (credential-named target with a strong literal value).',
  },
  (model) => {
    const findings = [];

    for (const visit of walkStages(model)) {
      for (const { paramName, raw } of inputBindings(visit.stage)) {
        const literal = wholeLiteral(raw);
        if (literal !== null && CREDENTIAL_NAME.test(paramName) && credentialStrength(literal)) {
          findings.push(
            makeFinding(
              sec001.meta,
              locationOf(visit),
              `Input "${paramName}" on stage "${visit.stage.name}" is the hardcoded literal ${JSON.stringify(literal)}.`,
              'Store the secret in Credential Manager (UiPath: Orchestrator credential asset + GetCredential) instead of embedding it in the process.',
              0.9,
            ),
          );
        }
      }

      const stage = visit.stage;
      if (stage.kind === 'calculation') {
        const literal = wholeLiteral(stage.expression.raw);
        if (literal !== null && CREDENTIAL_NAME.test(stage.storeIn) && credentialStrength(literal)) {
          findings.push(
            makeFinding(
              sec001.meta,
              locationOf(visit),
              `Calculation "${stage.name}" assigns the hardcoded literal ${JSON.stringify(literal)} to "${stage.storeIn}".`,
              'Store the secret in Credential Manager (UiPath: Orchestrator credential asset + GetCredential).',
              0.9,
            ),
          );
        }
      }
    }

    for (const { owner, ownerType } of eachOwner(model)) {
      const stageIndex = dataItemStages(owner);
      for (const item of owner.dataItems) {
        const value = item.initialValue ?? '';
        if (value !== '' && CREDENTIAL_NAME.test(item.name) && credentialStrength(value)) {
          const at = stageIndex.get(item.id);
          findings.push(
            makeFinding(
              sec001.meta,
              { ...ownerLocation(owner, ownerType), ...at },
              `Data item "${item.name}" has a hardcoded credential-like initial value.`,
              'Remove the literal and read the secret from Credential Manager at runtime.',
              0.9,
            ),
          );
        }
      }
    }

    return findings;
  },
);

// ---------------------------------------------------------------------------
// SEC-002 — password passed as a plain text startup parameter
// ---------------------------------------------------------------------------

const sec002 = defineRule(
  {
    id: 'SEC-002',
    title: 'Plaintext password parameter',
    severity: 'high',
    category: 'security',
    description:
      'A process startup parameter is password-named but typed as plain text instead of being retrieved from Credential Manager.',
  },
  (model) => {
    const findings = [];
    for (const process of model.processes) {
      const offending = process.startupParams.filter(
        (p) => p.direction === 'in' && CREDENTIAL_NAME.test(p.name) && p.dataType !== 'password',
      );
      if (offending.length > 0) {
        findings.push(
          makeFinding(
            sec002.meta,
            { processId: process.id },
            `Startup parameter(s) ${offending.map((p) => `"${p.name}"`).join(', ')} carry secrets as plain text.`,
            'Drop the parameter and fetch the secret inside the process via Credential Manager (UiPath: GetCredential against an Orchestrator credential asset).',
            0.9,
          ),
        );
      }
    }
    return findings;
  },
);

// ---------------------------------------------------------------------------
// SEC-003 — sensitive data written to a log/note stage
// ---------------------------------------------------------------------------

const sec003 = defineRule(
  {
    id: 'SEC-003',
    title: 'Sensitive data in logs',
    severity: 'high',
    category: 'security',
    description:
      'An alert/log or note stage carries SSN / account / card data, exposing PII in session logs.',
  },
  (model) => {
    const findings = [];
    for (const visit of walkStages(model)) {
      const stage = visit.stage;
      let matched: string[] = [];

      if (stage.kind === 'alert') {
        matched = identifierRefs(stage.message.raw).filter((name) => SENSITIVE_NAME.test(name));
        if (matched.length === 0 && SSN_DIGITS.test(stage.message.raw)) matched = ['SSN literal'];
      } else if (stage.kind === 'note') {
        if (SSN_DIGITS.test(stage.text)) matched = ['SSN literal'];
      }

      if (matched.length > 0) {
        findings.push(
          makeFinding(
            sec003.meta,
            locationOf(visit),
            `Stage "${stage.name}" writes sensitive data (${[...new Set(matched)].join(', ')}) to the log.`,
            'Log a masked or tokenized reference instead; in UiPath keep PII out of Log Message activities and robot logs.',
            0.85,
          ),
        );
      }
    }
    return findings;
  },
);

// ---------------------------------------------------------------------------
// SEC-004 — hardcoded environment value
// ---------------------------------------------------------------------------

const sec004 = defineRule(
  {
    id: 'SEC-004',
    title: 'Hardcoded environment value',
    severity: 'medium',
    category: 'security',
    description:
      'A URL, UNC path, or internal server name is hardcoded where an environment variable / asset should be used.',
  },
  (model) => {
    const findings = [];

    for (const { owner, ownerType } of eachOwner(model)) {
      const stageIndex = dataItemStages(owner);
      for (const item of owner.dataItems) {
        const value = item.initialValue ?? '';
        if (value !== '' && looksLikeEnvironmentValue(value)) {
          const at = stageIndex.get(item.id);
          findings.push(
            makeFinding(
              sec004.meta,
              { ...ownerLocation(owner, ownerType), ...at },
              `Data item "${item.name}" hardcodes the environment value ${JSON.stringify(value)}.`,
              'Move the value to a Blue Prism environment variable today and an Orchestrator asset after migration; reference it instead of embedding it.',
              0.85,
            ),
          );
        }
      }
    }

    for (const visit of walkStages(model)) {
      for (const { paramName, raw } of inputBindings(visit.stage)) {
        const literal = wholeLiteral(raw);
        if (literal !== null && looksLikeEnvironmentValue(literal)) {
          findings.push(
            makeFinding(
              sec004.meta,
              locationOf(visit),
              `Input "${paramName}" on stage "${visit.stage.name}" hardcodes the environment value ${JSON.stringify(literal)}.`,
              'Reference an environment variable / Orchestrator asset instead of the literal.',
              0.85,
            ),
          );
        }
      }
    }

    return findings;
  },
);

export const SEC_RULES: Rule[] = [sec001, sec002, sec003, sec004];
