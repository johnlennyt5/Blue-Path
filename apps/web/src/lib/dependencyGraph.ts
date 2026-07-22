/**
 * Program-level dependency graph (S6-6): pure layout over the synced
 * dependency_edges rows. Bipartite view — processes on the left, the objects
 * and queues they touch on the right. A target referenced by 2+ distinct
 * processes is a shared-asset hotspot (change it and you change them all).
 */

export interface ProgramEdgeRow {
  from_name: string;
  from_type: string;
  to_name: string;
  to_type: string;
}

export interface GraphNode {
  id: string;
  name: string;
  type: string;
  /** Distinct processes referencing this target (0 for process nodes). */
  sharedBy: number;
  hotspot: boolean;
  position: { x: number; y: number };
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  toType: string;
}

export interface ProgramGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  hotspotCount: number;
}

const nodeId = (type: string, name: string): string => `${type}:${name}`;

const COLUMN_X = { left: 0, right: 480 };
const ROW_HEIGHT = 90;

export function buildProgramGraph(rows: ProgramEdgeRow[]): ProgramGraph {
  const processes = new Map<string, string>(); // id → name
  const targets = new Map<string, { name: string; type: string; referrers: Set<string> }>();

  for (const row of rows) {
    const fromId = nodeId(row.from_type, row.from_name);
    processes.set(fromId, row.from_name);
    const toId = nodeId(row.to_type, row.to_name);
    const target = targets.get(toId) ?? {
      name: row.to_name,
      type: row.to_type,
      referrers: new Set<string>(),
    };
    target.referrers.add(fromId);
    targets.set(toId, target);
  }

  const sortedProcesses = [...processes.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const sortedTargets = [...targets.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));

  const nodes: GraphNode[] = [
    ...sortedProcesses.map(([id, name], i) => ({
      id,
      name,
      type: 'process',
      sharedBy: 0,
      hotspot: false,
      position: { x: COLUMN_X.left, y: i * ROW_HEIGHT },
    })),
    ...sortedTargets.map(([id, target], i) => ({
      id,
      name: target.name,
      type: target.type,
      sharedBy: target.referrers.size,
      hotspot: target.referrers.size >= 2,
      position: { x: COLUMN_X.right, y: i * ROW_HEIGHT },
    })),
  ];

  const edges: GraphEdge[] = rows.map((row) => ({
    id: `${nodeId(row.from_type, row.from_name)}→${nodeId(row.to_type, row.to_name)}`,
    source: nodeId(row.from_type, row.from_name),
    target: nodeId(row.to_type, row.to_name),
    toType: row.to_type,
  }));

  return {
    nodes,
    edges,
    hotspotCount: nodes.filter((n) => n.hotspot).length,
  };
}
