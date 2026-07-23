import type { Page, Stage, StageEdgeKind } from '@prismshift/ir';

/**
 * Pure mapping from an IR page to React Flow nodes/edges. Kept
 * framework-light so it is unit-testable without a canvas.
 */

export interface FlowNodeData {
  label: string;
  kind: Stage['kind'];
  highlighted: boolean;
  [key: string]: unknown;
}

export interface FlowNode {
  id: string;
  position: { x: number; y: number };
  data: FlowNodeData;
  type: 'stage';
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  type: 'smoothstep';
  label?: string;
  labelStyle?: { fill: string; fontSize: number };
  labelBgStyle?: { fill: string; fillOpacity: number };
  labelBgPadding?: [number, number];
  labelBgBorderRadius?: number;
  animated: boolean;
  className: string;
  /** Arrowhead so flow direction is visible, colored to match the edge. */
  markerEnd: { type: 'arrowclosed'; color: string; width: number; height: number };
  /** True for edges PrismShift inferred rather than parsed from the XML. */
  inferred?: boolean;
}

/** BP diagram coordinates are compact; spread them for readable labels. */
const SCALE_X = 1.9;
const SCALE_Y = 1.6;

const EDGE_LABELS: Partial<Record<StageEdgeKind, string>> = {
  true: 'True',
  false: 'False',
};

const EDGE_CLASSES: Record<StageEdgeKind, string> = {
  flow: 'ps-edge-flow',
  true: 'ps-edge-true',
  false: 'ps-edge-false',
  choice: 'ps-edge-choice',
  exception: 'ps-edge-exception',
};

/** Must match the stroke palette in index.css. */
const EDGE_COLORS: Record<StageEdgeKind, string> = {
  flow: '#64748b',
  true: '#34d399',
  false: '#fb7185',
  choice: '#fbbf24',
  exception: '#f43f5e',
};

const marker = (kind: StageEdgeKind): FlowEdge['markerEnd'] => ({
  type: 'arrowclosed',
  color: EDGE_COLORS[kind],
  width: 18,
  height: 18,
});

/**
 * Stage kinds whose failures flow to a Recover stage. Blue Prism keeps these
 * links implicit (recovery is block/page-scoped), so the visualization infers
 * them — clearly marked, never persisted to the IR.
 */
const EXCEPTION_SOURCE_KINDS = new Set<Stage['kind']>([
  'action',
  'subsheetRef',
  'navigate',
  'write',
  'read',
  'wait',
  'code',
  'exception',
]);

export interface FlowGraphOptions {
  /** Draw inferred "on exception" edges into the page's Recover stage. */
  inferExceptionEdges?: boolean;
}

export function buildFlowGraph(
  page: Page,
  highlightStageId?: string,
  options: FlowGraphOptions = {},
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const { inferExceptionEdges = true } = options;

  // Stages without diagram coordinates get stacked in a side column.
  let fallbackY = 0;

  const nodes: FlowNode[] = page.stages.map((stage) => {
    const position = stage.position
      ? { x: stage.position.x * SCALE_X, y: stage.position.y * SCALE_Y }
      : { x: -320, y: (fallbackY += 70) };
    return {
      id: stage.id,
      position,
      type: 'stage',
      data: {
        label: stage.name,
        kind: stage.kind,
        highlighted: stage.id === highlightStageId,
      },
    };
  });

  // BL-018: labels get a solid backing chip so they stay readable when the
  // path crosses node text; FlowView additionally hides them at low zoom.
  const labelStyling = {
    labelStyle: { fill: '#cbd5e1', fontSize: 11 },
    labelBgStyle: { fill: '#0f172a', fillOpacity: 0.9 },
    labelBgPadding: [4, 2] as [number, number],
    labelBgBorderRadius: 4,
  };
  const edges: FlowEdge[] = page.edges.map((edge, i) => ({
    id: `e${i}-${edge.from}-${edge.to}`,
    source: edge.from,
    target: edge.to,
    type: 'smoothstep',
    ...(edge.label !== undefined
      ? { label: edge.label, ...labelStyling }
      : EDGE_LABELS[edge.kind] !== undefined
        ? { label: EDGE_LABELS[edge.kind], ...labelStyling }
        : {}),
    animated: edge.kind === 'exception',
    className: EDGE_CLASSES[edge.kind],
    markerEnd: marker(edge.kind),
  }));

  if (inferExceptionEdges) {
    const recover = page.stages.find((s) => s.kind === 'recover');
    if (recover) {
      for (const stage of page.stages) {
        if (!EXCEPTION_SOURCE_KINDS.has(stage.kind)) continue;
        edges.push({
          id: `ex-${stage.id}`,
          source: stage.id,
          target: recover.id,
          type: 'smoothstep',
          label: 'on exception',
          labelStyle: { fill: '#fda4af', fontSize: 11 },
          labelBgStyle: { fill: '#0f172a', fillOpacity: 0.9 },
          labelBgPadding: [4, 2] as [number, number],
          labelBgBorderRadius: 4,
          animated: true,
          className: 'ps-edge-exception ps-edge-inferred',
          markerEnd: marker('exception'),
          inferred: true,
        });
      }
    }
  }

  return { nodes, edges };
}
