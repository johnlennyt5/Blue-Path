import { describe, expect, it } from 'vitest';
import type { AutomationModel, Page, Stage, StageEdge } from '@prismshift/ir';
import { runRules } from './engine';
import { REL_RULES } from './reliability';

const ref = { path: '/test' };

const stage = (id: string, kind: 'action' | 'anchor' | 'decision' | 'recover' | 'start'): Stage => {
  switch (kind) {
    case 'action':
      return { id, kind, name: id, objectName: 'VBO', actionName: 'Do', inputs: [], outputs: [], sourceRef: ref };
    case 'decision':
      return { id, kind, name: id, expression: { raw: '[X]' }, sourceRef: ref };
    default:
      return { id, kind, name: id, sourceRef: ref };
  }
};

function modelWithPage(stages: Stage[], edges: StageEdge[]): AutomationModel {
  const page: Page = { id: 'page-1', name: 'Main Page', stages, edges, sourceRef: ref };
  return {
    meta: { packageName: 'T', bpVersion: '6', sourceHash: 'a'.repeat(64) },
    processes: [
      {
        id: 'proc-1',
        name: 'P',
        pages: [page],
        dataItems: [],
        startupParams: [],
        outputs: [],
        sourceRef: ref,
      },
    ],
    objects: [],
    workQueues: [],
    environmentVars: [],
    credentialsRefs: [],
    dependencies: [],
  };
}

const findingsFor = (model: AutomationModel, ruleId: string) =>
  runRules(model, REL_RULES).findings.filter((f) => f.ruleId === ruleId);

describe('REL-002 cycle detection', () => {
  it('flags an unguarded two-stage cycle at its earliest stage', () => {
    const model = modelWithPage(
      [stage('a', 'action'), stage('b', 'anchor'), stage('r', 'recover')],
      [
        { from: 'a', to: 'b', kind: 'flow' },
        { from: 'b', to: 'a', kind: 'flow' },
      ],
    );
    const findings = findingsFor(model, 'REL-002');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.location.stageId).toBe('a');
  });

  it('flags a self-loop', () => {
    const model = modelWithPage(
      [stage('a', 'action'), stage('r', 'recover')],
      [{ from: 'a', to: 'a', kind: 'flow' }],
    );
    expect(findingsFor(model, 'REL-002')).toHaveLength(1);
  });

  it('does not flag a cycle containing a decision guard', () => {
    const model = modelWithPage(
      [stage('a', 'action'), stage('d', 'decision'), stage('r', 'recover')],
      [
        { from: 'a', to: 'd', kind: 'flow' },
        { from: 'd', to: 'a', kind: 'true' },
      ],
    );
    expect(findingsFor(model, 'REL-002')).toEqual([]);
  });

  it('does not flag acyclic flow', () => {
    const model = modelWithPage(
      [stage('a', 'action'), stage('b', 'anchor'), stage('r', 'recover')],
      [{ from: 'a', to: 'b', kind: 'flow' }],
    );
    expect(findingsFor(model, 'REL-002')).toEqual([]);
  });
});

describe('REL-001 recovery coverage', () => {
  it('flags risky work with no recover stage anywhere', () => {
    const model = modelWithPage([stage('a', 'action')], []);
    const findings = findingsFor(model, 'REL-001');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.location).toEqual({ processId: 'proc-1' });
  });

  it('stays silent when a recover stage exists', () => {
    const model = modelWithPage([stage('a', 'action'), stage('r', 'recover')], []);
    expect(findingsFor(model, 'REL-001')).toEqual([]);
  });

  it('stays silent for pure-calculation processes', () => {
    const model = modelWithPage([stage('s', 'start')], []);
    expect(findingsFor(model, 'REL-001')).toEqual([]);
  });
});
