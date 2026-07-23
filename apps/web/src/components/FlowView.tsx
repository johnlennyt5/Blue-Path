import { useEffect, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import type { NodeProps, ReactFlowInstance } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { BusinessObjectNode, ProcessNode } from '@prismshift/ir';
import { buildFlowGraph } from '../lib/flowGraph';
import type { FlowEdge, FlowNode } from '../lib/flowGraph';
import { useSession } from '../store/session';

const KIND_NODE_STYLES: Record<string, string> = {
  start: 'border-emerald-500/60 bg-emerald-500/10 text-emerald-200',
  end: 'border-emerald-500/60 bg-emerald-500/10 text-emerald-200',
  action: 'border-sky-500/60 bg-sky-500/10 text-sky-200',
  subsheetRef: 'border-sky-500/60 bg-sky-500/15 text-sky-200',
  decision: 'border-amber-500/60 bg-amber-500/10 text-amber-200',
  choice: 'border-amber-500/60 bg-amber-500/10 text-amber-200',
  exception: 'border-rose-500/60 bg-rose-500/10 text-rose-200',
  recover: 'border-rose-500/60 bg-rose-500/10 text-rose-200',
  resume: 'border-rose-500/60 bg-rose-500/10 text-rose-200',
  code: 'border-violet-500/60 bg-violet-500/10 text-violet-200',
  data: 'border-slate-600 bg-slate-800/60 text-slate-300',
  collection: 'border-slate-600 bg-slate-800/60 text-slate-300',
};

/** Minimap swatch per kind — keeps the overview scannable on huge pages. */
const KIND_MINIMAP_COLORS: Record<string, string> = {
  start: '#059669',
  end: '#059669',
  action: '#0284c7',
  subsheetRef: '#0284c7',
  decision: '#d97706',
  choice: '#d97706',
  exception: '#e11d48',
  recover: '#e11d48',
  resume: '#e11d48',
  code: '#7c3aed',
};

/** Invisible but present — edges need handles to attach to. */
const HANDLE_CLASS = '!h-0.5 !w-0.5 !min-h-0 !min-w-0 !border-0 !bg-transparent';

function StageNode({ data }: NodeProps) {
  const d = data as FlowNode['data'];
  return (
    <div
      className={`rounded-md border px-3 py-1.5 text-xs ${KIND_NODE_STYLES[d.kind] ?? 'border-slate-600 bg-slate-800 text-slate-200'} ${
        d.highlighted ? 'ring-4 ring-sky-400 ring-offset-2 ring-offset-slate-950' : ''
      }`}
    >
      <Handle type="target" position={Position.Top} className={HANDLE_CLASS} />
      <div className="font-mono text-[9px] uppercase tracking-wide opacity-60">{d.kind}</div>
      <div className="max-w-44 truncate">{d.label}</div>
      <Handle type="source" position={Position.Bottom} className={HANDLE_CLASS} />
    </div>
  );
}

const nodeTypes = { stage: StageNode };

const LEGEND: { swatch: string; label: string }[] = [
  { swatch: 'bg-emerald-500', label: 'start / end' },
  { swatch: 'bg-sky-500', label: 'action / page ref' },
  { swatch: 'bg-amber-500', label: 'decision / choice' },
  { swatch: 'bg-rose-500', label: 'exception path' },
  { swatch: 'bg-violet-500', label: 'code' },
  { swatch: 'bg-slate-500', label: 'data' },
];

/** Stage flow graph for one page of a process/object, with deep-link highlight. */
export function FlowView({ owner }: { owner: ProcessNode | BusinessObjectNode }) {
  const selection = useSession((s) => s.selection);
  const setFlowPage = useSession((s) => s.setFlowPage);
  const [instance, setInstance] = useState<ReactFlowInstance<FlowNode, FlowEdge> | null>(null);
  const [showInferred, setShowInferred] = useState(true);

  const page = owner.pages.find((p) => p.id === selection?.pageId) ?? owner.pages[0];
  const highlightStageId = selection?.highlightStageId;

  const graph = useMemo(
    () =>
      page
        ? buildFlowGraph(page, highlightStageId, { inferExceptionEdges: showInferred })
        : { nodes: [], edges: [] },
    [page, highlightStageId, showInferred],
  );

  // Managed state keeps React Flow's node-change pipeline flowing — with
  // plain props and no onNodesChange, queued fitView calls can dead-end
  // (found via the S6-6 graph's dead fit button; same latent bug here).
  const [nodes, setNodes, onNodesChange] = useNodesState(graph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(graph.edges);
  useEffect(() => setNodes(graph.nodes), [graph.nodes, setNodes]);
  useEffect(() => setEdges(graph.edges), [graph.edges, setEdges]);

  // BL-018: below this zoom, edge labels are unreadable smears over node
  // text — hide them entirely and let the color/arrow language carry.
  const [labelsVisible, setLabelsVisible] = useState(true);
  useEffect(() => {
    if (!labelsVisible) {
      setEdges((current) => current.map((e) => ({ ...e, label: undefined })));
    } else {
      setEdges(graph.edges);
    }
  }, [labelsVisible, graph.edges, setEdges]);

  // Center the highlighted stage (deep-link target) once the canvas is live.
  // No duration: animated fits ride on d3 transitions, which some browser
  // environments silently kill.
  useEffect(() => {
    if (!instance) return;
    if (highlightStageId) {
      void instance.fitView({ nodes: [{ id: highlightStageId }], maxZoom: 1.2 });
    } else {
      void instance.fitView({ maxZoom: 1 });
    }
  }, [instance, highlightStageId, page?.id]);

  if (!page) return <p className="text-sm text-slate-400">This item has no pages.</p>;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label htmlFor="flow-page" className="text-sm text-slate-400">
          Page
        </label>
        <select
          id="flow-page"
          value={page.id}
          onChange={(e) => setFlowPage(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200"
        >
          {owner.pages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.stages.length} stages)
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-500">
          {graph.nodes.length} stages · {graph.edges.length} links
        </span>
        <label className="ml-auto flex items-center gap-2 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={showInferred}
            onChange={(e) => setShowInferred(e.target.checked)}
            className="accent-rose-500"
          />
          inferred exception edges
        </label>
      </div>

      <div className="h-[540px] rounded-xl border border-slate-800 bg-slate-950">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onMove={(_e, viewport) => setLabelsVisible(viewport.zoom >= 0.5)}
          nodeTypes={nodeTypes}
          onInit={setInstance}
          nodesDraggable={false}
          nodesConnectable={false}
          onlyRenderVisibleElements
          proOptions={{ hideAttribution: true }}
          minZoom={0.1}
          colorMode="dark"
        >
          <Background gap={24} />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            nodeColor={(node) =>
              KIND_MINIMAP_COLORS[(node.data as FlowNode['data']).kind] ?? '#475569'
            }
            maskColor="rgba(2, 6, 23, 0.7)"
            className="!bg-slate-900"
          />
        </ReactFlow>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-4">
        {LEGEND.map((entry) => (
          <span key={entry.label} className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className={`h-2 w-2 rounded-full ${entry.swatch}`} />
            {entry.label}
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-xs text-slate-500">
          <span className="inline-block h-0 w-5 border-t-2 border-dashed border-rose-500/70" />
          on-exception (inferred)
        </span>
      </div>
    </div>
  );
}
