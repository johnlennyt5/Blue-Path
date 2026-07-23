/**
 * BL-004 · Automation Anywhere (A360) adapter: exported `.bot` JSON → the
 * PrismShift IR. The whole point: downstream (rules, summaries, conversion)
 * runs UNCHANGED — this package only speaks IR.
 *
 * Mapping philosophy mirrors the BP parser: never throw, never silently
 * drop. Unknown commands become `generic` stages plus a warning; every
 * expression keeps its text (with `$Var$` interpolation rewritten to the
 * IR's `[Var]` reference syntax so the rules engine sees the same shapes).
 */
import { buildDependencyGraph } from '@prismshift/ir';
import type {
  AutomationModel,
  BpDataType,
  DataItem,
  ExpressionRef,
  Page,
  Param,
  ProcessNode,
  Stage,
  StageEdge,
} from '@prismshift/ir';

export interface AaParseIssue {
  message: string;
  path?: string;
}

export interface AaParseResult {
  model: AutomationModel;
  warnings: AaParseIssue[];
  errors: AaParseIssue[];
}

// ---------------------------------------------------------------------------
// A360 export shapes (documented subset)
// ---------------------------------------------------------------------------

interface AaValue {
  type?: string;
  string?: string;
  expression?: string;
  number?: number;
  boolean?: boolean;
}

interface AaAttribute {
  name: string;
  value?: AaValue;
}

interface AaNode {
  uid?: string;
  command?: string;
  packageName?: string;
  disabled?: boolean;
  attributes?: AaAttribute[];
  children?: AaNode[];
  branches?: { label?: string; children?: AaNode[] }[];
}

interface AaVariable {
  name?: string;
  type?: string;
  description?: string;
  input?: boolean;
  output?: boolean;
  defaultValue?: AaValue;
}

interface AaBot {
  name?: string;
  description?: string;
  botVersion?: string;
  variables?: AaVariable[];
  nodes?: AaNode[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AA_TYPE_MAP: Record<string, BpDataType> = {
  STRING: 'text',
  NUMBER: 'number',
  BOOLEAN: 'flag',
  DATETIME: 'datetime',
  TABLE: 'collection',
  LIST: 'collection',
  DICTIONARY: 'collection',
  RECORD: 'collection',
  FILE: 'text',
  CREDENTIAL: 'password',
};

/** `$Var$` / `$Table.column$` interpolation → IR `[Var]` reference syntax. */
export function aaExpressionToIr(expression: string): string {
  return expression.replace(/\$([A-Za-z_][\w.]*)\$/g, '[$1]');
}

function expr(raw: string): ExpressionRef {
  return { raw: aaExpressionToIr(raw) };
}

function attr(node: AaNode, name: string): AaValue | undefined {
  return node.attributes?.find((a) => a.name === name)?.value;
}

function attrText(node: AaNode, name: string): string {
  const value = attr(node, name);
  return value?.expression ?? value?.string ?? (value?.number !== undefined ? String(value.number) : '');
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Node walking
// ---------------------------------------------------------------------------

interface WalkContext {
  stages: Stage[];
  edges: StageEdge[];
  warnings: AaParseIssue[];
  counter: { value: number };
  hasErrorHandler: boolean;
  catchChains: AaNode[][];
}

const ref = (path: string) => ({ path });

function nextId(ctx: WalkContext, hint: string): string {
  ctx.counter.value += 1;
  return `aa-${hint}-${ctx.counter.value}`;
}

/**
 * Convert a sibling list into a stage chain. Returns entry/exit stage ids
 * (undefined when the list produced no stages).
 */
function walkNodes(
  nodes: AaNode[],
  ctx: WalkContext,
  path: string,
): { first?: string; last?: string } {
  let first: string | undefined;
  let previous: string | undefined;

  const link = (from: string | undefined, to: string, kind: StageEdge['kind'] = 'flow') => {
    if (from !== undefined) ctx.edges.push({ from, to, kind });
  };

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (node.disabled === true) continue;
    const nodePath = `${path}/nodes[${i + 1}]`;
    const command = (node.command ?? '').toLowerCase();
    const name = attrText(node, 'displayName') || node.command || 'AA step';

    const push = (stage: Stage): string => {
      ctx.stages.push(stage);
      link(previous, stage.id);
      if (first === undefined) first = stage.id;
      previous = stage.id;
      return stage.id;
    };

    switch (command) {
      case 'assign': {
        const target = attrText(node, 'destination') || attrText(node, 'variableName');
        push({
          kind: 'calculation',
          id: node.uid ?? nextId(ctx, 'calc'),
          name,
          expression: expr(attrText(node, 'expression') || attrText(node, 'sourceValue')),
          storeIn: target.replace(/^\$|\$$/g, ''),
          sourceRef: ref(nodePath),
        });
        break;
      }

      case 'if': {
        const id = node.uid ?? nextId(ctx, 'if');
        push({
          kind: 'decision',
          id,
          name,
          expression: expr(attrText(node, 'condition')),
          sourceRef: ref(nodePath),
        });
        const thenChain = walkNodes(node.children ?? [], ctx, `${nodePath}/then`);
        // An immediately following `else` node supplies the false branch.
        const elseNode =
          nodes[i + 1]?.command?.toLowerCase() === 'else' ? nodes[++i] : undefined;
        const elseChain =
          elseNode !== undefined
            ? walkNodes(elseNode.children ?? [], ctx, `${nodePath}/else`)
            : {};
        // Join: an anchor stage both branches converge on.
        const joinId = nextId(ctx, 'join');
        ctx.stages.push({
          kind: 'anchor',
          id: joinId,
          name: `${name} (join)`,
          sourceRef: ref(nodePath),
        });
        if (thenChain.first !== undefined) {
          ctx.edges.push({ from: id, to: thenChain.first, kind: 'true' });
          ctx.edges.push({ from: thenChain.last!, to: joinId, kind: 'flow' });
        } else {
          ctx.edges.push({ from: id, to: joinId, kind: 'true' });
        }
        if (elseChain.first !== undefined) {
          ctx.edges.push({ from: id, to: elseChain.first, kind: 'false' });
          ctx.edges.push({ from: elseChain.last!, to: joinId, kind: 'flow' });
        } else {
          ctx.edges.push({ from: id, to: joinId, kind: 'false' });
        }
        previous = joinId;
        break;
      }

      case 'loop': {
        const pairId = nextId(ctx, 'looppair');
        const iterator =
          attrText(node, 'iterator') || attrText(node, 'variableName') || attrText(node, 'sourceValue');
        const startId = node.uid ?? nextId(ctx, 'loopstart');
        push({
          kind: 'loopStart',
          id: startId,
          name,
          collectionName: aaExpressionToIr(iterator).replace(/^\[|\]$/g, ''),
          pairId,
          sourceRef: ref(nodePath),
        });
        const body = walkNodes(node.children ?? [], ctx, `${nodePath}/body`);
        const endId = nextId(ctx, 'loopend');
        ctx.stages.push({
          kind: 'loopEnd',
          id: endId,
          name: `${name} (end)`,
          pairId,
          sourceRef: ref(nodePath),
        });
        if (body.first !== undefined) {
          ctx.edges.push({ from: startId, to: body.first, kind: 'flow' });
          ctx.edges.push({ from: body.last!, to: endId, kind: 'flow' });
        } else {
          ctx.edges.push({ from: startId, to: endId, kind: 'flow' });
        }
        previous = endId;
        break;
      }

      case 'runtask': {
        const taskPath = attrText(node, 'taskPath') || attrText(node, 'filePath') || 'Unknown task';
        push({
          kind: 'action',
          id: node.uid ?? nextId(ctx, 'runtask'),
          name,
          objectName: taskPath,
          actionName: 'Run Task',
          inputs: (node.attributes ?? [])
            .filter((a) => a.name.startsWith('input:'))
            .map((a) => ({
              paramName: a.name.slice('input:'.length),
              expression: expr(a.value?.expression ?? a.value?.string ?? ''),
            })),
          outputs: [],
          sourceRef: ref(nodePath),
        });
        break;
      }

      case 'messagebox':
      case 'log':
      case 'logtofile': {
        push({
          kind: 'alert',
          id: node.uid ?? nextId(ctx, 'alert'),
          name,
          message: expr(attrText(node, 'message') || attrText(node, 'logMessage')),
          sourceRef: ref(nodePath),
        });
        break;
      }

      case 'comment':
        push({
          kind: 'note',
          id: node.uid ?? nextId(ctx, 'note'),
          name,
          text: attrText(node, 'comment') || name,
          sourceRef: ref(nodePath),
        });
        break;

      case 'errorhandler':
      case 'try': {
        ctx.hasErrorHandler = true;
        const body = walkNodes(node.children ?? [], ctx, `${nodePath}/try`);
        if (body.first !== undefined) {
          link(previous, body.first);
          if (first === undefined) first = body.first;
          previous = body.last;
        }
        const catchBranch =
          node.branches?.find((b) => (b.label ?? '').toLowerCase() === 'catch') ??
          (nodes[i + 1]?.command?.toLowerCase() === 'catch'
            ? { children: nodes[++i]!.children }
            : undefined);
        if (catchBranch?.children !== undefined) ctx.catchChains.push(catchBranch.children);
        break;
      }

      default: {
        ctx.warnings.push({
          message: `AA command "${node.command ?? '(unnamed)'}" (package "${node.packageName ?? '?'}") has no IR mapping yet — kept as a generic stage.`,
          path: nodePath,
        });
        push({
          kind: 'generic',
          id: node.uid ?? nextId(ctx, 'generic'),
          name,
          rawType: node.command ?? 'unknown',
          sourceRef: ref(nodePath),
        });
        break;
      }
    }
  }
  return { first, last: previous };
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

export async function parseAaBot(json: string): Promise<AaParseResult> {
  const warnings: AaParseIssue[] = [];
  const errors: AaParseIssue[] = [];
  const sourceHash = await sha256Hex(json);

  const model: AutomationModel = {
    meta: { packageName: '', bpVersion: '', sourceHash },
    processes: [],
    objects: [],
    workQueues: [],
    environmentVars: [],
    credentialsRefs: [],
    dependencies: [],
  };

  let bot: AaBot;
  try {
    bot = JSON.parse(json) as AaBot;
  } catch (cause) {
    errors.push({ message: `Not valid JSON: ${String(cause)}` });
    return { model, warnings, errors };
  }
  if (bot === null || typeof bot !== 'object' || !Array.isArray(bot.nodes)) {
    errors.push({ message: 'Not an Automation Anywhere bot export: expected a JSON object with a "nodes" array' });
    return { model, warnings, errors };
  }

  const botName = bot.name ?? 'AA Bot';
  model.meta.packageName = botName;
  model.meta.bpVersion = `A360${bot.botVersion !== undefined ? ` ${bot.botVersion}` : ''}`;

  // Variables → data items + params
  const dataItems: DataItem[] = [];
  const startupParams: Param[] = [];
  const outputs: Param[] = [];
  for (const [i, variable] of (bot.variables ?? []).entries()) {
    const varPath = `/bot/variables[${i + 1}]`;
    const name = variable.name ?? `Variable ${i + 1}`;
    const aaType = (variable.type ?? 'STRING').toUpperCase();
    const dataType = AA_TYPE_MAP[aaType];
    if (dataType === undefined) {
      warnings.push({ message: `AA variable type "${aaType}" is unmapped — treated as text.`, path: varPath });
    }
    const item: DataItem = {
      id: `aa-var-${i + 1}`,
      name,
      dataType: dataType ?? 'text',
      sourceRef: ref(varPath),
    };
    const initial = variable.defaultValue?.string ?? variable.defaultValue?.expression;
    if (initial !== undefined && initial !== '') item.initialValue = initial;
    dataItems.push(item);
    const param: Param = { name, dataType: dataType ?? 'text', direction: 'in' };
    if (variable.input === true) startupParams.push(param);
    if (variable.output === true) outputs.push({ ...param, direction: 'out' });
  }

  // Nodes → one main page
  const ctx: WalkContext = {
    stages: [],
    edges: [],
    warnings,
    counter: { value: 0 },
    hasErrorHandler: false,
    catchChains: [],
  };
  const startId = 'aa-start';
  ctx.stages.push({
    kind: 'start',
    id: startId,
    name: 'Start',
    inputs: startupParams.map((p) => ({ paramName: p.name, storeIn: p.name })),
    sourceRef: ref('/bot'),
  });
  const chain = walkNodes(bot.nodes, ctx, '/bot');
  const endId = 'aa-end';
  ctx.stages.push({
    kind: 'end',
    id: endId,
    name: 'End',
    outputs: outputs.map((p) => ({ paramName: p.name, storeIn: p.name })),
    sourceRef: ref('/bot'),
  });
  if (chain.first !== undefined) {
    ctx.edges.push({ from: startId, to: chain.first, kind: 'flow' });
    ctx.edges.push({ from: chain.last!, to: endId, kind: 'flow' });
  } else {
    ctx.edges.push({ from: startId, to: endId, kind: 'flow' });
  }

  // Error handler catches → Recover … Resume chain (exception path)
  if (ctx.hasErrorHandler) {
    const recoverId = 'aa-recover';
    ctx.stages.push({ kind: 'recover', id: recoverId, name: 'Recover', sourceRef: ref('/bot/catch') });
    let tail = recoverId;
    for (const [i, catchNodes] of ctx.catchChains.entries()) {
      const caught = walkNodes(catchNodes, ctx, `/bot/catch[${i + 1}]`);
      if (caught.first !== undefined) {
        ctx.edges.push({ from: tail, to: caught.first, kind: 'flow' });
        tail = caught.last!;
      }
    }
    const resumeId = 'aa-resume';
    ctx.stages.push({ kind: 'resume', id: resumeId, name: 'Resume', sourceRef: ref('/bot/catch') });
    ctx.edges.push({ from: tail, to: resumeId, kind: 'flow' });
    ctx.edges.push({ from: resumeId, to: endId, kind: 'flow' });
  }

  const page: Page = {
    id: 'aa-main',
    name: 'Main Flow',
    stages: ctx.stages,
    edges: ctx.edges,
    sourceRef: ref('/bot/nodes'),
  };

  const process: ProcessNode = {
    id: `aa-bot-${sourceHash.slice(0, 12)}`,
    name: botName,
    pages: [page],
    dataItems,
    startupParams,
    outputs,
    sourceRef: ref('/bot'),
  };
  if (bot.description !== undefined && bot.description !== '') {
    process.description = bot.description;
  }
  model.processes.push(process);
  model.dependencies = buildDependencyGraph(model);
  return { model, warnings, errors };
}
