/**
 * BL-007 · Orchestrator API integration: create the queues/assets the
 * manifests describe, straight from the CLI (browsers can't — CORS).
 *
 * Contract: optional and credentialed per run — the token comes from the
 * command line/environment, lives in memory for the duration of the call,
 * and is never stored or logged. Dry-run previews; live runs report per
 * item and NEVER abort the batch on individual failures.
 */
import type { AutomationModel } from '@prismshift/ir';

export interface OrchestratorConfig {
  /** e.g. https://cloud.uipath.com/myorg/mytenant/orchestrator_ */
  baseUrl: string;
  /** Folder (Organization Unit) id the items are created in. */
  folderId: string;
  /** Bearer token (PAT or OAuth) — memory-only, never persisted. */
  token: string;
}

export type PlanItemKind = 'queue' | 'asset-text' | 'asset-integer' | 'asset-bool' | 'asset-credential';

export interface PlanItem {
  kind: PlanItemKind;
  name: string;
  detail: string;
}

export interface ApplyResult {
  item: PlanItem;
  status: 'created' | 'exists' | 'failed';
  message?: string;
}

/** What a release needs in Orchestrator — the manifests as actionable items. */
export function planFromModel(model: AutomationModel): PlanItem[] {
  const items: PlanItem[] = [];
  for (const queue of model.workQueues) {
    items.push({
      kind: 'queue',
      name: queue.name,
      detail: `queue${queue.keyField !== undefined ? ` · unique ref from "${queue.keyField}"` : ''}${
        queue.maxAttempts !== undefined ? ` · ${queue.maxAttempts} retries` : ''
      }`,
    });
  }
  for (const envVar of model.environmentVars) {
    const kind: PlanItemKind =
      envVar.dataType === 'number'
        ? 'asset-integer'
        : envVar.dataType === 'flag'
          ? 'asset-bool'
          : 'asset-text';
    items.push({
      kind,
      name: envVar.name,
      detail: `${kind.replace('asset-', '')} asset${envVar.value !== undefined ? ' (value from export)' : ''}`,
    });
  }
  for (const credential of model.credentialsRefs) {
    items.push({
      kind: 'asset-credential',
      name: credential.name,
      detail: 'credential asset (created with CHANGE-ME placeholder — set the real secret in Orchestrator)',
    });
  }
  return items;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

function headers(config: OrchestratorConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${config.token}`,
    'X-UIPATH-OrganizationUnitId': config.folderId,
    'Content-Type': 'application/json',
  };
}

async function exists(
  config: OrchestratorConfig,
  fetchImpl: FetchLike,
  entity: 'QueueDefinitions' | 'Assets',
  name: string,
): Promise<boolean> {
  const url = `${config.baseUrl}/odata/${entity}?$filter=Name eq '${name.replace(/'/g, "''")}'&$top=1`;
  const response = await fetchImpl(url, { headers: headers(config) });
  if (!response.ok) throw new Error(`lookup failed (${response.status})`);
  const body = (await response.json()) as { value?: unknown[] };
  return (body.value ?? []).length > 0;
}

function bodyFor(item: PlanItem, model: AutomationModel): Record<string, unknown> {
  if (item.kind === 'queue') {
    const queue = model.workQueues.find((q) => q.name === item.name);
    return {
      Name: item.name,
      Description: 'Created by PrismShift from the Blue Prism release manifest.',
      AcceptAutomaticallyRetry: true,
      MaxNumberOfRetries: queue?.maxAttempts ?? 1,
      EnforceUniqueReference: queue?.keyField !== undefined,
    };
  }
  const envVar = model.environmentVars.find((v) => v.name === item.name);
  const base = {
    Name: item.name,
    Description: 'Created by PrismShift from the Blue Prism release manifest.',
    ValueScope: 'Global',
  };
  switch (item.kind) {
    case 'asset-integer':
      return { ...base, ValueType: 'Integer', IntValue: Number(envVar?.value ?? 0) || 0 };
    case 'asset-bool':
      return { ...base, ValueType: 'Bool', BoolValue: envVar?.value === 'True' || envVar?.value === 'true' };
    case 'asset-credential':
      return {
        ...base,
        ValueType: 'Credential',
        CredentialUsername: 'CHANGE-ME',
        CredentialPassword: 'CHANGE-ME',
      };
    default:
      return { ...base, ValueType: 'Text', StringValue: envVar?.value ?? '' };
  }
}

/**
 * Create every planned item. Individual failures are captured and the batch
 * continues — the report tells you exactly what happened per item.
 */
export async function applyPlan(
  config: OrchestratorConfig,
  model: AutomationModel,
  items: PlanItem[],
  fetchImpl: FetchLike = fetch,
): Promise<ApplyResult[]> {
  const results: ApplyResult[] = [];
  for (const item of items) {
    const entity = item.kind === 'queue' ? 'QueueDefinitions' : 'Assets';
    try {
      if (await exists(config, fetchImpl, entity, item.name)) {
        results.push({ item, status: 'exists', message: 'already present — skipped' });
        continue;
      }
      const response = await fetchImpl(`${config.baseUrl}/odata/${entity}`, {
        method: 'POST',
        headers: headers(config),
        body: JSON.stringify(bodyFor(item, model)),
      });
      if (!response.ok) {
        const text = await response.text();
        results.push({
          item,
          status: 'failed',
          message: `HTTP ${response.status}: ${text.slice(0, 160)}`,
        });
        continue;
      }
      results.push({ item, status: 'created' });
    } catch (error) {
      results.push({
        item,
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}
