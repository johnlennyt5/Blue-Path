import { useEffect, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react';
import { buildProgramGraph, type ProgramEdgeRow } from '../lib/dependencyGraph';

/**
 * Program dependency graph (S6-6): processes → shared objects/queues from the
 * synced edges. Hotspots (targets shared by 2+ processes) get the amber
 * treatment — they're the coordination points of the migration.
 */

const TYPE_COLORS: Record<string, { border: string; badge: string }> = {
  process: { border: '#38bdf8', badge: 'process' },
  object: { border: '#a78bfa', badge: 'VBO' },
  queue: { border: '#fbbf24', badge: 'queue' },
};

// No duration: animated fits ride on d3 transitions, which some browser
// environments (extensions patching timers) silently kill — the promise then
// never resolves and the viewport never moves. Instant fit is bulletproof.
const FIT_OPTIONS = { padding: 0.15 };

export function DependencyGraph({ rows }: { rows: ProgramEdgeRow[] }) {
  const graph = useMemo(() => buildProgramGraph(rows), [rows]);
  const [instance, setInstance] = useState<ReactFlowInstance | null>(null);

  const builtNodes: Node[] = useMemo(
    () =>
      graph.nodes.map((n) => ({
        id: n.id,
        position: n.position,
        sourcePosition: 'right',
        targetPosition: 'left',
        data: {
          label: `${n.name}${n.hotspot ? `  ·  shared ×${n.sharedBy}` : ''}`,
        },
        style: {
          background: '#0f172a',
          color: '#e2e8f0',
          fontSize: 12,
          borderRadius: 10,
          padding: '8px 12px',
          border: n.hotspot
            ? '2px solid #fbbf24'
            : `1px solid ${TYPE_COLORS[n.type]?.border ?? '#475569'}`,
          boxShadow: n.hotspot ? '0 0 12px rgba(251, 191, 36, 0.35)' : undefined,
        },
      })) as Node[],
    [graph],
  );

  const builtEdges: Edge[] = useMemo(
    () =>
      graph.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#64748b' },
        style: { stroke: '#64748b' },
      })),
    [graph],
  );

  // React Flow v12 processes queued fitView calls through the node-change
  // pipeline — with plain `nodes` props and no onNodesChange, that queue can
  // dead-end and fitView never applies. Managed state keeps the pipeline
  // flowing (measurements included), which is what the fit button relies on.
  const [nodes, setNodes, onNodesChange] = useNodesState(builtNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(builtEdges);
  useEffect(() => setNodes(builtNodes), [builtNodes, setNodes]);
  useEffect(() => setEdges(builtEdges), [builtEdges, setEdges]);

  // The panel mounts before nodes are measured, so the declarative fitView
  // fires too early — re-fit once the instance exists and whenever the node
  // set changes (also what the Controls fit button relies on).
  useEffect(() => {
    if (instance === null) return;
    const raf = requestAnimationFrame(() => {
      void instance.fitView(FIT_OPTIONS);
    });
    return () => cancelAnimationFrame(raf);
  }, [instance, graph]);

  if (rows.length === 0) return null;

  return (
    <div className="mt-5">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Dependency graph
        {graph.hotspotCount > 0 && (
          <span className="ml-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs normal-case text-amber-300">
            {graph.hotspotCount} shared hotspot{graph.hotspotCount === 1 ? '' : 's'}
          </span>
        )}
      </h4>
      <div className="h-[340px] rounded-xl border border-slate-800 bg-slate-950">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onInit={setInstance}
          nodesDraggable={false}
          nodesConnectable={false}
          fitView
          fitViewOptions={FIT_OPTIONS}
          proOptions={{ hideAttribution: true }}
          minZoom={0.2}
          colorMode="dark"
        >
          <Background gap={24} />
          <Controls
            showInteractive={false}
            fitViewOptions={FIT_OPTIONS}
            onFitView={() => {
              void instance?.fitView(FIT_OPTIONS);
            }}
          />
        </ReactFlow>
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm border" style={{ borderColor: '#38bdf8' }} />
          process
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm border" style={{ borderColor: '#a78bfa' }} />
          object (VBO)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm border" style={{ borderColor: '#fbbf24' }} />
          queue
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-sm border-2"
            style={{ borderColor: '#fbbf24', boxShadow: '0 0 6px rgba(251,191,36,0.5)' }}
          />
          shared hotspot (2+ processes) — coordinate changes here
        </span>
      </div>
    </div>
  );
}
