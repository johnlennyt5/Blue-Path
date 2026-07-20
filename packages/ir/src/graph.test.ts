import { describe, expect, it } from 'vitest';
import { buildDependencyGraph, validateModel, walkStages } from './graph';
import { buildSampleModel } from './testing/fixtures';
import type { LoopEndStage, LoopStartStage, StageEdge } from './types';

describe('walkStages', () => {
  it('yields every stage across processes and objects', () => {
    const visits = [...walkStages(buildSampleModel())];
    // 6 (Main Page) + 5 (Handle Item) + 3 (Enter Invoice)
    expect(visits).toHaveLength(14);
  });

  it('tags each visit with its owner, owner type, and page', () => {
    const visits = [...walkStages(buildSampleModel())];

    const processVisits = visits.filter((v) => v.ownerType === 'process');
    const objectVisits = visits.filter((v) => v.ownerType === 'object');
    expect(processVisits).toHaveLength(11);
    expect(objectVisits).toHaveLength(3);

    for (const visit of processVisits) {
      expect(visit.owner.name).toBe('Invoice Loader');
      expect(['Main Page', 'Handle Item']).toContain(visit.page.name);
    }
    for (const visit of objectVisits) {
      expect(visit.owner.name).toBe('Invoice VBO');
      expect(visit.page.name).toBe('Enter Invoice');
    }
  });

  it('walks in deterministic order: processes first, pages and stages in model order', () => {
    const ids = [...walkStages(buildSampleModel())].map((v) => v.stage.id);
    expect(ids).toEqual([
      's1', 's2', 's3', 's4', 's5', 's6',
      'h1', 'h2', 'h3', 'h4', 'h5',
      'o1', 'o2', 'o3',
    ]);
  });
});

describe('buildDependencyGraph', () => {
  it('derives process→queue, process→object, and object→application edges', () => {
    const edges = buildDependencyGraph(buildSampleModel());
    expect(edges).toEqual([
      { fromType: 'process', fromName: 'Invoice Loader', toType: 'queue', toName: 'Invoices Queue' },
      { fromType: 'process', fromName: 'Invoice Loader', toType: 'object', toName: 'Invoice VBO' },
      { fromType: 'object', fromName: 'Invoice VBO', toType: 'application', toName: 'SAP GUI' },
    ]);
  });

  it('deduplicates repeated calls to the same object', () => {
    const model = buildSampleModel();
    const mainPage = model.processes[0]!.pages[0]!;
    mainPage.stages.push({
      id: 's7',
      kind: 'action',
      name: 'Enter Invoice Again',
      objectName: 'Invoice VBO',
      actionName: 'Enter Invoice',
      inputs: [],
      outputs: [],
      sourceRef: { path: '/process[1]/stage[7]' },
    });

    const edges = buildDependencyGraph(model);
    const objectEdges = edges.filter((e) => e.toType === 'object' && e.toName === 'Invoice VBO');
    expect(objectEdges).toHaveLength(1);
  });

  it('does not emit an object edge for queue-tagged actions', () => {
    const edges = buildDependencyGraph(buildSampleModel());
    const internalQueueObject = edges.find((e) => e.toName === 'Internal - Work Queues');
    expect(internalQueueObject).toBeUndefined();
  });
});

describe('validateModel', () => {
  it('returns no issues for a sound model', () => {
    expect(validateModel(buildSampleModel())).toEqual([]);
  });

  it('flags edges referencing unknown stage ids', () => {
    const model = buildSampleModel();
    const edge: StageEdge = { from: 's1', to: 'missing-stage', kind: 'flow' };
    model.processes[0]!.pages[0]!.edges.push(edge);

    const issues = validateModel(model);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain('missing-stage');
    expect(issues[0]!.location).toEqual({ processId: 'proc-invoice-loader', pageId: 'page-main' });
  });

  it('flags duplicate stage ids on a page', () => {
    const model = buildSampleModel();
    const page = model.processes[0]!.pages[0]!;
    page.stages.push({ ...page.stages[0]!, name: 'Duplicate Start' });

    const issues = validateModel(model);
    expect(issues.some((i) => i.message.includes('Duplicate stage id "s1"'))).toBe(true);
  });

  it('flags unmatched loop pairs', () => {
    const model = buildSampleModel();
    const page = model.processes[0]!.pages[0]!;
    const loopStart: LoopStartStage = {
      id: 'loop1',
      kind: 'loopStart',
      name: 'For Each Invoice',
      collectionName: 'Invoices',
      pairId: 'pair-1',
      sourceRef: { path: '/process[1]/stage[8]' },
    };
    page.stages.push(loopStart);

    const withoutEnd = validateModel(model);
    expect(withoutEnd.some((i) => i.message.includes('Loop pair "pair-1"'))).toBe(true);

    const loopEnd: LoopEndStage = {
      id: 'loop2',
      kind: 'loopEnd',
      name: 'End Loop',
      pairId: 'pair-1',
      sourceRef: { path: '/process[1]/stage[9]' },
    };
    page.stages.push(loopEnd);
    expect(validateModel(model)).toEqual([]);
  });

  it('flags subsheet references to unknown pages', () => {
    const model = buildSampleModel();
    const subsheetRef = model.processes[0]!.pages[0]!.stages.find((s) => s.kind === 'subsheetRef');
    if (subsheetRef?.kind !== 'subsheetRef') throw new Error('fixture missing subsheetRef');
    subsheetRef.targetPageId = 'page-that-does-not-exist';

    const issues = validateModel(model);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain('page-that-does-not-exist');
    expect(issues[0]!.location.stageId).toBe('s5');
  });
});
