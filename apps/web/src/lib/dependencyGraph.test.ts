/**
 * S6-6 · Program dependency graph builder: node dedup, bipartite layout,
 * shared-hotspot detection, deterministic ordering.
 */
import { describe, expect, it } from 'vitest';
import { buildProgramGraph } from './dependencyGraph';

const EDGES = [
  { from_name: 'Invoice Dispatcher', from_type: 'process', to_name: 'Invoice Entry VBO', to_type: 'object' },
  { from_name: 'Invoice Performer', from_type: 'process', to_name: 'Invoice Entry VBO', to_type: 'object' },
  { from_name: 'Invoice Dispatcher', from_type: 'process', to_name: 'Invoices Queue', to_type: 'queue' },
  { from_name: 'Invoice Performer', from_type: 'process', to_name: 'Invoices Queue', to_type: 'queue' },
  { from_name: 'Invoice Performer', from_type: 'process', to_name: 'Solo VBO', to_type: 'object' },
];

describe('buildProgramGraph', () => {
  it('dedupes nodes and keeps every edge', () => {
    const graph = buildProgramGraph(EDGES);
    expect(graph.nodes).toHaveLength(5); // 2 processes + 3 targets
    expect(graph.edges).toHaveLength(5);
  });

  it('marks targets shared by 2+ processes as hotspots; solo targets are not', () => {
    const graph = buildProgramGraph(EDGES);
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    expect(byId.get('object:Invoice Entry VBO')?.hotspot).toBe(true);
    expect(byId.get('object:Invoice Entry VBO')?.sharedBy).toBe(2);
    expect(byId.get('queue:Invoices Queue')?.hotspot).toBe(true);
    expect(byId.get('object:Solo VBO')?.hotspot).toBe(false);
    expect(graph.hotspotCount).toBe(2);
  });

  it('lays out bipartite columns: processes left, targets right, sorted by name', () => {
    const graph = buildProgramGraph(EDGES);
    const processes = graph.nodes.filter((n) => n.type === 'process');
    const targets = graph.nodes.filter((n) => n.type !== 'process');
    expect(processes.every((n) => n.position.x === 0)).toBe(true);
    expect(targets.every((n) => n.position.x === 480)).toBe(true);
    expect(processes.map((n) => n.name)).toEqual(['Invoice Dispatcher', 'Invoice Performer']);
    expect(targets.map((n) => n.name)).toEqual(['Invoice Entry VBO', 'Invoices Queue', 'Solo VBO']);
  });

  it('is deterministic regardless of input order', () => {
    const shuffled = [...EDGES].reverse();
    expect(buildProgramGraph(shuffled).nodes).toEqual(buildProgramGraph(EDGES).nodes);
  });

  it('empty input → empty graph, no hotspots', () => {
    const graph = buildProgramGraph([]);
    expect(graph.nodes).toHaveLength(0);
    expect(graph.hotspotCount).toBe(0);
  });
});
