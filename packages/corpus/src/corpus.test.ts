import { XMLParser } from 'fast-xml-parser';
import { describe, expect, it } from 'vitest';
import { SAMPLES, loadSample } from './index';
import type { ExpectedObjectStats, ExpectedProcessStats } from './types';

/**
 * Structural self-validation of every registered sample: the XML must be
 * well-formed, follow the .bprelease schema, and agree with its answer key's
 * raw counts. (Semantic validation against the IR happens in the parser's
 * test suite from S1-6 on.)
 */

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (tagName) =>
    [
      'process',
      'object',
      'work-queue',
      'environment-variable',
      'stage',
      'subsheet',
      'element',
    ].includes(tagName),
});

type Xml = Record<string, unknown>;

const asArray = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

/** Shared raw-structure checks for a process or object definition. */
function checkDefinition(
  wrapper: Xml,
  stats: ExpectedProcessStats | ExpectedObjectStats,
  bpVersion: string,
  plantsMissingNarrative: boolean,
): Xml {
  expect(wrapper['@_name']).toBe(stats.name);

  const definitions = asArray(wrapper['process']);
  expect(definitions, `inner <process> definition for ${stats.name}`).toHaveLength(1);
  const definition = definitions[0] as Xml;

  expect(definition['@_bpversion']).toBe(bpVersion);
  // Corpus processes/objects always document themselves unless the sample
  // deliberately plants CMP-002 (missing documentation).
  if (!plantsMissingNarrative) {
    expect(String(definition['@_narrative'] ?? '')).not.toBe('');
  }

  const subsheets = asArray(definition['subsheet']);
  expect(subsheets.map((s) => (s as Xml)['name'])).toEqual(stats.pages);

  const stages = asArray(definition['stage']);
  expect(stages, `stage count for ${stats.name}`).toHaveLength(stats.stageCount);

  const dataItemStages = stages.filter((s) =>
    ['Data', 'Collection'].includes(String((s as Xml)['@_type'])),
  );
  expect(dataItemStages, `data item count for ${stats.name}`).toHaveLength(stats.dataItemCount);

  // Every stage sits on a declared page, except the documented strays
  const subsheetIds = new Set(subsheets.map((s) => (s as Xml)['@_subsheetid']));
  const strays = stages.filter((s) => !subsheetIds.has((s as Xml)['subsheetid']));
  expect(strays, `stray-page stages for ${stats.name}`).toHaveLength(stats.strayStageCount ?? 0);

  return definition;
}

describe.each(SAMPLES)('corpus sample $id', (sampleRef) => {
  it('loads with a consistent answer key', async () => {
    const { ref, xml, answerKey } = await loadSample(sampleRef.id);
    expect(ref.id).toBe(sampleRef.id);
    expect(answerKey.id).toBe(sampleRef.id);
    expect(xml.length).toBeGreaterThan(0);

    // stageKinds must account for every stage exactly once
    for (const stats of [...answerKey.expectedParse.processes, ...answerKey.expectedParse.objects]) {
      const kindSum = Object.values(stats.stageKinds).reduce((a, b) => a + b, 0);
      expect(kindSum, `stageKinds sum for ${stats.name}`).toBe(stats.stageCount);
    }

    // Every expected finding names exactly one owner, and that owner exists
    const processNames = new Set(answerKey.expectedParse.processes.map((p) => p.name));
    const objectNames = new Set(answerKey.expectedParse.objects.map((o) => o.name));
    for (const finding of answerKey.expectedFindings) {
      const owners = [finding.processName, finding.objectName].filter(Boolean);
      expect(owners, `finding ${finding.ruleId} must name exactly one owner`).toHaveLength(1);
      if (finding.processName) expect(processNames).toContain(finding.processName);
      if (finding.objectName) expect(objectNames).toContain(finding.objectName);
    }
  });

  it('is well-formed .bprelease XML matching the answer key raw counts', async () => {
    const { xml, answerKey } = await loadSample(sampleRef.id);
    const doc: unknown = parser.parse(xml);

    const release = (doc as Xml)['bpr:release'] as Xml | undefined;
    expect(release, 'root <bpr:release> element').toBeDefined();

    const contents = release?.['bpr:contents'] as Xml | undefined;
    expect(contents, '<bpr:contents> element').toBeDefined();

    const { counts, bpVersion } = answerKey.expectedParse;
    const processes = asArray(contents?.['process']);
    const objects = asArray(contents?.['object']);
    expect(processes).toHaveLength(counts.processes);
    expect(objects).toHaveLength(counts.objects);
    expect(asArray(contents?.['work-queue'])).toHaveLength(counts.workQueues);
    expect(asArray(contents?.['environment-variable'])).toHaveLength(counts.environmentVars);

    const plantsCmp002 = (name: string) =>
      answerKey.expectedFindings.some(
        (f) => f.ruleId === 'CMP-002' && (f.processName === name || f.objectName === name),
      );

    for (const [i, stats] of answerKey.expectedParse.processes.entries()) {
      checkDefinition(processes[i] as Xml, stats, bpVersion, plantsCmp002(stats.name));
    }

    for (const [i, stats] of answerKey.expectedParse.objects.entries()) {
      const definition = checkDefinition(objects[i] as Xml, stats, bpVersion, plantsCmp002(stats.name));

      const appdef = definition['appdef'] as Xml | undefined;
      expect(appdef, `appdef for ${stats.name}`).toBeDefined();
      if (stats.applicationName !== undefined) {
        expect((appdef?.['application'] as Xml | undefined)?.['@_name']).toBe(
          stats.applicationName,
        );
      }
      if (stats.appElementCount !== undefined) {
        expect(asArray(appdef?.['element'])).toHaveLength(stats.appElementCount);
      }
    }
  });

  it('resolves every stage link to an existing stage', async () => {
    const { xml } = await loadSample(sampleRef.id);
    const doc = parser.parse(xml) as Xml;
    const release = doc['bpr:release'] as Xml;
    const contents = release['bpr:contents'] as Xml;

    for (const wrapper of [...asArray(contents['process']), ...asArray(contents['object'])]) {
      const definition = asArray((wrapper as Xml)['process'])[0] as Xml;
      const stages = asArray(definition['stage']) as Xml[];
      const stageIds = new Set(stages.map((s) => s['@_stageid']));

      const linkTags = ['onsuccess', 'ontrue', 'onfalse', 'ontimeout'];
      for (const stage of stages) {
        for (const tag of linkTags) {
          const target = stage[tag];
          if (typeof target === 'string' && target !== '') {
            expect(stageIds, `${tag} link from stage "${String(stage['@_name'])}"`).toContain(
              target,
            );
          }
        }
        // Wait choices carry their own links
        const choices = (stage['choices'] as Xml | undefined)?.['choice'];
        for (const choice of asArray(choices)) {
          const target = (choice as Xml)['onsuccess'];
          if (typeof target === 'string' && target !== '') {
            expect(stageIds).toContain(target);
          }
        }
      }
    }
  });
});

describe('loadSample', () => {
  it('rejects unknown sample ids with the known list', async () => {
    await expect(loadSample('99-does-not-exist')).rejects.toThrow(/01-clean-and-simple/);
  });
});
