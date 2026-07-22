/**
 * Orchestrator setup manifests (S5-2, ARCHITECTURE §7.3): everything the
 * target environment must provide before the converted processes run —
 * work queues, assets (from BP environment variables), and credentials.
 * Emitted alongside the project so infosec/ops can review the full surface.
 */
import type { AutomationModel } from '@prismshift/ir';
import type { ProjectFile } from './project';

interface QueueManifestEntry {
  name: string;
  keyField?: string;
  maxAttempts?: number;
  encrypted?: boolean;
  source: 'work-queue-definition' | 'referenced-by-process';
}

interface AssetManifestEntry {
  name: string;
  /** Orchestrator asset type. */
  type: 'Text' | 'Integer' | 'Boolean' | 'Credential';
  value?: string;
  description?: string;
  source: 'environment-variable' | 'credential-reference';
}

function queueEntries(model: AutomationModel): QueueManifestEntry[] {
  const entries = new Map<string, QueueManifestEntry>();

  for (const queue of model.workQueues) {
    entries.set(queue.name, {
      name: queue.name,
      ...(queue.keyField !== undefined ? { keyField: queue.keyField } : {}),
      ...(queue.maxAttempts !== undefined ? { maxAttempts: queue.maxAttempts } : {}),
      ...(queue.encrypted !== undefined ? { encrypted: queue.encrypted } : {}),
      source: 'work-queue-definition',
    });
  }

  // Queues referenced by actions but not declared in the release
  for (const process of model.processes) {
    for (const page of process.pages) {
      for (const stage of page.stages) {
        if (stage.kind === 'action' && stage.queueName !== undefined) {
          if (!entries.has(stage.queueName)) {
            entries.set(stage.queueName, {
              name: stage.queueName,
              source: 'referenced-by-process',
            });
          }
        }
      }
    }
  }

  return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function assetEntries(model: AutomationModel): AssetManifestEntry[] {
  const typeFor = (bp: string): AssetManifestEntry['type'] => {
    if (bp === 'number') return 'Integer';
    if (bp === 'flag') return 'Boolean';
    return 'Text';
  };

  const assets: AssetManifestEntry[] = model.environmentVars.map((envVar) => ({
    name: envVar.name,
    type: typeFor(envVar.dataType),
    ...(envVar.value !== undefined ? { value: envVar.value } : {}),
    ...(envVar.description !== undefined ? { description: envVar.description } : {}),
    source: 'environment-variable' as const,
  }));

  for (const credential of model.credentialsRefs) {
    assets.push({
      name: credential.name,
      type: 'Credential',
      description: 'Blue Prism credential — create as an Orchestrator credential asset.',
      source: 'credential-reference',
    });
  }

  return assets.sort((a, b) => a.name.localeCompare(b.name));
}

/** AssetsManifest.json + QueuesManifest.json for the release. */
export function buildManifests(model: AutomationModel): ProjectFile[] {
  return [
    {
      path: 'AssetsManifest.json',
      content: `${JSON.stringify(assetEntries(model), null, 2)}\n`,
    },
    {
      path: 'QueuesManifest.json',
      content: `${JSON.stringify(queueEntries(model), null, 2)}\n`,
    },
  ];
}
