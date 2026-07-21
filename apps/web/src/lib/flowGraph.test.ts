import { describe, expect, it } from 'vitest';
import type { Page } from '@prismshift/ir';
import { buildFlowGraph } from './flowGraph';

const ref = { path: '/t' };

const page: Page = {
  id: 'p1',
  name: 'Main Page',
  stages: [
    { id: 's1', kind: 'start', name: 'Start', sourceRef: ref, position: { x: 15, y: -100 } },
    {
      id: 's2',
      kind: 'decision',
      name: 'Ok?',
      expression: { raw: '[X]' },
      sourceRef: ref,
      position: { x: 15, y: 0 },
    },
    { id: 's3', kind: 'end', name: 'End', sourceRef: ref, position: { x: 15, y: 100 } },
    // no position → fallback side column
    { id: 'd1', kind: 'data', name: 'X', dataItemId: 'd1', sourceRef: ref },
  ],
  edges: [
    { from: 's1', to: 's2', kind: 'flow' },
    { from: 's2', to: 's3', kind: 'true' },
    { from: 's2', to: 's1', kind: 'false' },
    { from: 's1', to: 's3', kind: 'choice', label: 'Time Out' },
    { from: 's2', to: 's3', kind: 'exception' },
  ],
  sourceRef: ref,
};

describe('buildFlowGraph', () => {
  it('maps stages to positioned nodes with kind data', () => {
    const { nodes } = buildFlowGraph(page);
    expect(nodes).toHaveLength(4);
    const start = nodes.find((n) => n.id === 's1')!;
    expect(start.data).toMatchObject({ label: 'Start', kind: 'start', highlighted: false });
    expect(start.position.x).toBeCloseTo(15 * 1.9);
    expect(start.position.y).toBeCloseTo(-100 * 1.6);
  });

  it('stacks position-less stages in a side column', () => {
    const { nodes } = buildFlowGraph(page);
    const dataNode = nodes.find((n) => n.id === 'd1')!;
    expect(dataNode.position.x).toBe(-320);
  });

  it('flags exactly the highlighted stage', () => {
    const { nodes } = buildFlowGraph(page, 's2');
    expect(nodes.filter((n) => n.data.highlighted).map((n) => n.id)).toEqual(['s2']);
  });

  it('labels true/false edges and preserves explicit labels', () => {
    const { edges } = buildFlowGraph(page);
    expect(edges.find((e) => e.className === 'ps-edge-true')?.label).toBe('True');
    expect(edges.find((e) => e.className === 'ps-edge-false')?.label).toBe('False');
    expect(edges.find((e) => e.className === 'ps-edge-choice')?.label).toBe('Time Out');
    expect(edges.find((e) => e.className === 'ps-edge-flow')?.label).toBeUndefined();
  });

  it('animates exception edges', () => {
    const { edges } = buildFlowGraph(page);
    const exception = edges.find((e) => e.className === 'ps-edge-exception')!;
    expect(exception.animated).toBe(true);
    expect(edges.filter((e) => e.animated)).toHaveLength(1);
  });

  it('gives every edge a direction arrowhead matching its color', () => {
    const { edges } = buildFlowGraph(page);
    for (const edge of edges) {
      expect(edge.markerEnd.type).toBe('arrowclosed');
    }
    expect(edges.find((e) => e.className === 'ps-edge-true')?.markerEnd.color).toBe('#34d399');
  });
});

describe('inferred exception edges', () => {
  const recoveryPage: Page = {
    id: 'p2',
    name: 'Work Page',
    stages: [
      { id: 's1', kind: 'start', name: 'Start', sourceRef: ref },
      {
        id: 'a1',
        kind: 'action',
        name: 'Do Work',
        objectName: 'VBO',
        actionName: 'Work',
        inputs: [],
        outputs: [],
        sourceRef: ref,
      },
      {
        id: 'c1',
        kind: 'calculation',
        name: 'Calc',
        expression: { raw: '[X]' },
        storeIn: 'X',
        sourceRef: ref,
      },
      { id: 'r1', kind: 'recover', name: 'Recover', sourceRef: ref },
      { id: 'e1', kind: 'end', name: 'End', sourceRef: ref },
    ],
    edges: [],
    sourceRef: ref,
  };

  it('draws labeled inferred edges from risky stages to the recover stage', () => {
    const { edges } = buildFlowGraph(recoveryPage);
    const inferred = edges.filter((e) => e.inferred);
    expect(inferred).toHaveLength(1);
    expect(inferred[0]).toMatchObject({
      source: 'a1',
      target: 'r1',
      label: 'on exception',
      animated: true,
    });
    expect(inferred[0]!.className).toContain('ps-edge-inferred');
  });

  it('never infers from calm stages (start, calc, end, recover itself)', () => {
    const { edges } = buildFlowGraph(recoveryPage);
    const sources = edges.filter((e) => e.inferred).map((e) => e.source);
    expect(sources).not.toContain('s1');
    expect(sources).not.toContain('c1');
    expect(sources).not.toContain('r1');
    expect(sources).not.toContain('e1');
  });

  it('infers nothing on pages without a recover stage', () => {
    const { edges } = buildFlowGraph(page);
    expect(edges.filter((e) => e.inferred)).toHaveLength(0);
  });

  it('can be disabled via options', () => {
    const { edges } = buildFlowGraph(recoveryPage, undefined, { inferExceptionEdges: false });
    expect(edges.filter((e) => e.inferred)).toHaveLength(0);
  });
});
