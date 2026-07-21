/**
 * Core stage mapping (S4-3/S4-4, ARCHITECTURE §7.1): reconstructs structured
 * control flow from a page's stage graph and emits typed activity trees.
 *
 * Arguments are resolved in two passes: every page's argument signature
 * (in_/out_/io_ names + types) is computed first, then conversions bind
 * page-reference invokes against the CALLEE's signature — caller and callee
 * can never disagree.
 *
 * Deterministic tier. Stage kinds outside this tier (actions, UI stages,
 * waits, code — Sprint 5) become visible TODO comments and punch-list
 * entries — never silently dropped.
 */
import type {
  AutomationModel,
  DataItem,
  Page,
  ProcessNode,
  Stage,
} from '@prismshift/ir';
import { translateExpression } from './expression';
import { IdentifierAllocator, bpTypeToXaml, sanitizeFileName, sanitizeIdentifier } from './naming';
import type {
  InvokeArgumentBinding,
  WorkflowDoc,
  XActivity,
  XamlArgument,
  XamlType,
  XamlVariable,
} from './xaml';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ConversionIssue {
  pageName: string;
  stageName: string;
  stageKind: string;
  reason: string;
}

export interface ProcessConversion {
  processName: string;
  /** Entry workflow first (Main.xaml), then one file per subsheet. */
  workflows: { path: string; doc: WorkflowDoc }[];
  totalStageCount: number;
  convertedStageCount: number;
  /** 0–100, one decimal. */
  coveragePct: number;
  punchList: ConversionIssue[];
}

// ---------------------------------------------------------------------------
// Page argument signatures (S4-4)
// ---------------------------------------------------------------------------

interface ArgRef {
  name: string;
  type: XamlType;
  direction: 'in' | 'out' | 'inout';
}

interface PageSignature {
  /** BP param name → argument, for the page's inputs. */
  byInputParam: Map<string, ArgRef>;
  /** BP param name → argument, for the page's outputs. */
  byOutputParam: Map<string, ArgRef>;
  /** Data item name → identifier (argument or variable). */
  identifierMap: Map<string, string>;
  /** Identifier → UiPath type. */
  typeMap: Map<string, XamlType>;
  args: XamlArgument[];
  variables: XamlVariable[];
}

function buildPageSignature(process: ProcessNode, page: Page): PageSignature {
  const pageItems: DataItem[] = page.stages
    .filter(
      (s): s is Extract<Stage, { kind: 'data' | 'collection' }> =>
        s.kind === 'data' || s.kind === 'collection',
    )
    .map((s) => process.dataItems.find((d) => d.id === s.dataItemId))
    .filter((d): d is DataItem => d !== undefined);

  const startStage = page.stages.find((s) => s.kind === 'start');
  const endStage = page.stages.find((s) => s.kind === 'end');
  const inputBindings = (startStage?.kind === 'start' ? startStage.inputs : undefined) ?? [];
  const outputBindings = (endStage?.kind === 'end' ? endStage.outputs : undefined) ?? [];

  const allocator = new IdentifierAllocator();
  const byInputParam = new Map<string, ArgRef>();
  const byOutputParam = new Map<string, ArgRef>();
  const identifierMap = new Map<string, string>();
  const typeMap = new Map<string, XamlType>();
  const args: XamlArgument[] = [];

  const itemType = (itemName: string): XamlType => {
    const item = pageItems.find((d) => d.name === itemName);
    return item ? bpTypeToXaml(item.dataType) : 'String';
  };

  const outputByStore = new Map(outputBindings.map((b) => [b.storeIn, b]));

  for (const binding of inputBindings) {
    const paired = outputByStore.get(binding.storeIn);
    const type = itemType(binding.storeIn);
    if (paired) {
      // Same data item flows in AND out → one InOut argument.
      const name = allocator.claim(`io_${sanitizeIdentifier(binding.paramName)}`);
      const ref: ArgRef = { name, type, direction: 'inout' };
      byInputParam.set(binding.paramName, ref);
      byOutputParam.set(paired.paramName, ref);
      identifierMap.set(binding.storeIn, name);
      typeMap.set(name, type);
      args.push({ name, direction: 'inout', type });
    } else {
      const name = allocator.claim(`in_${sanitizeIdentifier(binding.paramName)}`);
      const ref: ArgRef = { name, type, direction: 'in' };
      byInputParam.set(binding.paramName, ref);
      identifierMap.set(binding.storeIn, name);
      typeMap.set(name, type);
      args.push({ name, direction: 'in', type });
    }
  }

  for (const binding of outputBindings) {
    if (identifierMap.has(binding.storeIn)) continue; // handled as io_ above
    const type = itemType(binding.storeIn);
    const name = allocator.claim(`out_${sanitizeIdentifier(binding.paramName)}`);
    const ref: ArgRef = { name, type, direction: 'out' };
    byOutputParam.set(binding.paramName, ref);
    identifierMap.set(binding.storeIn, name);
    typeMap.set(name, type);
    args.push({ name, direction: 'out', type });
  }

  const variables: XamlVariable[] = [];
  for (const item of pageItems) {
    if (identifierMap.has(item.name)) continue;
    const identifier = allocator.claim(sanitizeIdentifier(item.name));
    identifierMap.set(item.name, identifier);
    typeMap.set(identifier, bpTypeToXaml(item.dataType));
    variables.push({
      name: identifier,
      type: bpTypeToXaml(item.dataType),
      ...(item.initialValue !== undefined && item.dataType !== 'collection'
        ? {
            defaultExpression:
              item.dataType === 'text' || item.dataType === 'password'
                ? JSON.stringify(item.initialValue)
                : item.initialValue,
          }
        : {}),
    });
  }

  return { byInputParam, byOutputParam, identifierMap, typeMap, args, variables };
}

// ---------------------------------------------------------------------------
// Page graph helpers
// ---------------------------------------------------------------------------

interface PageMaps {
  byId: Map<string, Stage>;
  order: Map<string, number>;
  nextFlow: Map<string, string>;
  decisionTargets: Map<string, { onTrue?: string; onFalse?: string }>;
  choiceTargets: Map<string, { label: string; to: string }[]>;
  allTargets: Map<string, string[]>;
}

function buildMaps(page: Page): PageMaps {
  const byId = new Map(page.stages.map((s) => [s.id, s]));
  const order = new Map(page.stages.map((s, i) => [s.id, i]));
  const nextFlow = new Map<string, string>();
  const decisionTargets = new Map<string, { onTrue?: string; onFalse?: string }>();
  const choiceTargets = new Map<string, { label: string; to: string }[]>();
  const allTargets = new Map<string, string[]>();

  for (const edge of page.edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) continue;
    allTargets.set(edge.from, [...(allTargets.get(edge.from) ?? []), edge.to]);

    if (edge.kind === 'flow' && !nextFlow.has(edge.from)) {
      nextFlow.set(edge.from, edge.to);
    } else if (edge.kind === 'true' || edge.kind === 'false') {
      const entry = decisionTargets.get(edge.from) ?? {};
      if (edge.kind === 'true') entry.onTrue = edge.to;
      else entry.onFalse = edge.to;
      decisionTargets.set(edge.from, entry);
    } else if (edge.kind === 'choice') {
      choiceTargets.set(edge.from, [
        ...(choiceTargets.get(edge.from) ?? []),
        { label: edge.label ?? '', to: edge.to },
      ]);
    }
  }
  return { byId, order, nextFlow, decisionTargets, choiceTargets, allTargets };
}

/** Earliest (document-order) stage reachable from ALL branch heads — the join. */
function findJoin(maps: PageMaps, heads: (string | undefined)[]): string | undefined {
  const reachableSets = heads.map((head) => {
    const seen = new Set<string>();
    const queue = head === undefined ? [] : [head];
    while (queue.length > 0) {
      const id = queue.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      queue.push(...(maps.allTargets.get(id) ?? []));
    }
    return seen;
  });

  const candidates = [...(reachableSets[0] ?? [])].filter((id) =>
    reachableSets.every((set) => set.has(id)),
  );
  candidates.sort((a, b) => (maps.order.get(a) ?? 0) - (maps.order.get(b) ?? 0));
  return candidates[0];
}

// ---------------------------------------------------------------------------
// Structurizer
// ---------------------------------------------------------------------------

interface ConvertContext {
  page: Page;
  maps: PageMaps;
  signature: PageSignature;
  /** Callee signatures by page name (and id) for page-reference binding. */
  signaturesByPageName: Map<string, PageSignature>;
  punch: ConversionIssue[];
  converted: Set<string>;
  visited: Set<string>;
}

function issue(ctx: ConvertContext, stage: Stage, reason: string): void {
  ctx.punch.push({
    pageName: ctx.page.name,
    stageName: stage.name,
    stageKind: stage.kind,
    reason,
  });
}

function identifierFor(ctx: ConvertContext, itemName: string): string | undefined {
  return ctx.signature.identifierMap.get(itemName);
}

function typeFor(ctx: ConvertContext, identifier: string): XamlType {
  return ctx.signature.typeMap.get(identifier) ?? 'String';
}

function translate(ctx: ConvertContext, stage: Stage, raw: string): string {
  const { vb, issues } = translateExpression(raw, (name) => identifierFor(ctx, name));
  for (const reason of issues) issue(ctx, stage, reason);
  return vb;
}

/** Emits activities from `fromId` until `stopId` (exclusive) or flow end. */
function emitChain(
  ctx: ConvertContext,
  fromId: string | undefined,
  stopId: string | undefined,
): XActivity[] {
  const activities: XActivity[] = [];
  let current = fromId;

  while (current !== undefined && current !== stopId) {
    const stage = ctx.maps.byId.get(current);
    if (!stage) break;

    if (stage.kind === 'end') {
      ctx.converted.add(stage.id);
      break;
    }
    if (ctx.visited.has(current)) {
      activities.push({
        kind: 'comment',
        text: `PrismShift: control flow loops back to "${stage.name}" — cycle needs manual restructuring.`,
      });
      issue(ctx, stage, 'Control-flow cycle needs manual restructuring');
      break;
    }
    ctx.visited.add(current);

    switch (stage.kind) {
      case 'start':
      case 'anchor':
        ctx.converted.add(stage.id);
        current = ctx.maps.nextFlow.get(current);
        break;

      case 'resume':
        ctx.converted.add(stage.id);
        activities.push({ kind: 'comment', text: 'BP Resume: normal flow resumes here.' });
        current = ctx.maps.nextFlow.get(current);
        break;

      case 'calculation': {
        const to = identifierFor(ctx, stage.storeIn) ?? sanitizeIdentifier(stage.storeIn);
        activities.push({
          kind: 'assign',
          displayName: stage.name,
          to,
          value: translate(ctx, stage, stage.expression.raw),
          type: typeFor(ctx, to),
        });
        ctx.converted.add(stage.id);
        current = ctx.maps.nextFlow.get(current);
        break;
      }

      case 'multiCalc': {
        for (const step of stage.steps) {
          const to = identifierFor(ctx, step.storeIn) ?? sanitizeIdentifier(step.storeIn);
          activities.push({
            kind: 'assign',
            displayName: `${stage.name}: ${step.storeIn}`,
            to,
            value: translate(ctx, stage, step.expression.raw),
            type: typeFor(ctx, to),
          });
        }
        ctx.converted.add(stage.id);
        current = ctx.maps.nextFlow.get(current);
        break;
      }

      case 'decision': {
        const targets = ctx.maps.decisionTargets.get(current) ?? {};
        const join = findJoin(ctx.maps, [targets.onTrue, targets.onFalse]);
        const thenActs = emitChain(ctx, targets.onTrue, join);
        const elseActs = emitChain(ctx, targets.onFalse, join);
        activities.push({
          kind: 'if',
          displayName: stage.name,
          condition: translate(ctx, stage, stage.expression.raw),
          ...(thenActs.length > 0
            ? { then: { kind: 'sequence', displayName: 'True', activities: thenActs } }
            : {}),
          ...(elseActs.length > 0
            ? { else: { kind: 'sequence', displayName: 'False', activities: elseActs } }
            : {}),
        });
        ctx.converted.add(stage.id);
        current = join;
        break;
      }

      case 'choice': {
        const branches = ctx.maps.choiceTargets.get(current) ?? [];
        const otherwise = ctx.maps.nextFlow.get(current);
        const join = findJoin(ctx.maps, [...branches.map((b) => b.to), otherwise]);

        const buildNested = (index: number): XActivity => {
          if (index >= branches.length) {
            const acts = emitChain(ctx, otherwise, join);
            return { kind: 'sequence', displayName: 'Otherwise', activities: acts };
          }
          const branch = branches[index]!;
          const choiceExpr = stage.choices[index]?.expression.raw ?? 'True';
          const thenActs = emitChain(ctx, branch.to, join);
          return {
            kind: 'if',
            displayName: `${stage.name}: ${branch.label || `Choice ${index + 1}`}`,
            condition: translate(ctx, stage, choiceExpr),
            then: { kind: 'sequence', displayName: branch.label || 'Choice', activities: thenActs },
            else: buildNested(index + 1),
          };
        };

        activities.push(buildNested(0));
        ctx.converted.add(stage.id);
        current = join;
        break;
      }

      case 'loopStart': {
        const loopEnd = ctx.page.stages.find(
          (s) => s.kind === 'loopEnd' && s.pairId === stage.pairId,
        );
        const collection =
          identifierFor(ctx, stage.collectionName) ?? sanitizeIdentifier(stage.collectionName);
        const bodyActs = emitChain(ctx, ctx.maps.nextFlow.get(current), loopEnd?.id);
        activities.push({
          kind: 'forEachRow',
          displayName: stage.name,
          dataTable: collection,
          body: { kind: 'sequence', displayName: `${stage.name} body`, activities: bodyActs },
        });
        ctx.converted.add(stage.id);
        if (loopEnd) {
          ctx.converted.add(loopEnd.id);
          ctx.visited.add(loopEnd.id);
          current = ctx.maps.nextFlow.get(loopEnd.id);
        } else {
          issue(ctx, stage, 'Loop has no matching end stage');
          current = undefined;
        }
        break;
      }

      case 'loopEnd':
        // Reached only when a loop is malformed; the healthy path stops on it.
        ctx.converted.add(stage.id);
        current = ctx.maps.nextFlow.get(current);
        break;

      case 'subsheetRef': {
        const fileName = `Pages\\${sanitizeFileName(stage.targetPageName || stage.name)}.xaml`;
        const target = ctx.signaturesByPageName.get(stage.targetPageName);
        const bindings: InvokeArgumentBinding[] = [];

        for (const input of stage.inputs) {
          const calleeArg = target?.byInputParam.get(input.paramName);
          if (!calleeArg) {
            issue(ctx, stage, `Input "${input.paramName}" has no matching page parameter`);
          }
          if (calleeArg?.direction === 'inout') continue; // bound once, below
          bindings.push({
            name: calleeArg?.name ?? `in_${sanitizeIdentifier(input.paramName)}`,
            direction: 'in',
            type: calleeArg?.type ?? 'String',
            expression: translate(ctx, stage, input.expression.raw),
          });
        }

        for (const output of stage.outputs) {
          const calleeArg = target?.byOutputParam.get(output.paramName);
          if (!calleeArg) {
            issue(ctx, stage, `Output "${output.paramName}" has no matching page parameter`);
          }
          bindings.push({
            name: calleeArg?.name ?? `out_${sanitizeIdentifier(output.paramName)}`,
            direction: calleeArg?.direction === 'inout' ? 'inout' : 'out',
            type: calleeArg?.type ?? typeFor(ctx, identifierFor(ctx, output.storeIn) ?? ''),
            expression: identifierFor(ctx, output.storeIn) ?? sanitizeIdentifier(output.storeIn),
          });
        }

        activities.push({
          kind: 'invokeWorkflow',
          displayName: stage.name,
          workflowFile: fileName,
          arguments: bindings,
        });
        ctx.converted.add(stage.id);
        current = ctx.maps.nextFlow.get(current);
        break;
      }

      case 'exception': {
        const isBusiness = (stage.exceptionType ?? '').toLowerCase().includes('business');
        activities.push({
          kind: 'throw',
          displayName: stage.name,
          exception: isBusiness ? 'BusinessRuleException' : 'Exception',
          message: stage.detail ? translate(ctx, stage, stage.detail.raw) : `"${stage.name}"`,
        });
        ctx.converted.add(stage.id);
        current = ctx.maps.nextFlow.get(current);
        break;
      }

      case 'note':
        activities.push({ kind: 'comment', text: `BP note: ${stage.text}` });
        ctx.converted.add(stage.id);
        current = ctx.maps.nextFlow.get(current);
        break;

      case 'recover':
        // Recovery entries are handled at page level; stop this chain.
        current = undefined;
        break;

      default:
        activities.push({
          kind: 'comment',
          text: `PrismShift TODO (Sprint 5): ${stage.kind} stage "${stage.name}" not yet converted.`,
        });
        issue(ctx, stage, `Stage kind "${stage.kind}" is converted in Sprint 5`);
        current = ctx.maps.nextFlow.get(current);
        break;
    }
  }

  return activities;
}

// ---------------------------------------------------------------------------
// Page → workflow document
// ---------------------------------------------------------------------------

function convertPage(
  page: Page,
  className: string,
  signature: PageSignature,
  signaturesByPageName: Map<string, PageSignature>,
  punch: ConversionIssue[],
): { doc: WorkflowDoc; converted: Set<string> } {
  const maps = buildMaps(page);
  const converted = new Set<string>();
  const ctx: ConvertContext = {
    page,
    maps,
    signature,
    signaturesByPageName,
    punch,
    converted,
    visited: new Set(),
  };

  // Data/Collection stages count as converted: they became variables/args
  for (const stage of page.stages) {
    if (stage.kind === 'data' || stage.kind === 'collection') converted.add(stage.id);
  }
  const startStage = page.stages.find((s) => s.kind === 'start');
  if (startStage) converted.add(startStage.id);

  const mainChain = emitChain(
    ctx,
    startStage ? maps.nextFlow.get(startStage.id) : undefined,
    undefined,
  );

  const recoverStage = page.stages.find((s) => s.kind === 'recover');
  let body: XActivity;
  if (recoverStage) {
    converted.add(recoverStage.id);
    const recoveryChain = emitChain(ctx, maps.nextFlow.get(recoverStage.id), undefined);
    body = {
      kind: 'sequence',
      displayName: page.name,
      variables: signature.variables,
      activities: [
        {
          kind: 'tryCatch',
          displayName: `${page.name} (BP Recover/Resume)`,
          tryBody: { kind: 'sequence', displayName: 'Page flow', activities: mainChain },
          catches: [
            {
              exceptionType: 'Exception',
              body: { kind: 'sequence', displayName: 'Recovery', activities: recoveryChain },
            },
          ],
        },
      ],
    };
  } else {
    body = {
      kind: 'sequence',
      displayName: page.name,
      variables: signature.variables,
      activities: mainChain,
    };
  }

  return { doc: { className, arguments: signature.args, body }, converted };
}

// ---------------------------------------------------------------------------
// Process → conversion
// ---------------------------------------------------------------------------

export function convertProcess(_model: AutomationModel, process: ProcessNode): ProcessConversion {
  const punch: ConversionIssue[] = [];
  const workflows: { path: string; doc: WorkflowDoc }[] = [];
  const convertedIds = new Set<string>();

  // Pass 1: argument signatures for every page (callers bind against these)
  const signatures = process.pages.map((page) => buildPageSignature(process, page));
  const signaturesByPageName = new Map(process.pages.map((page, i) => [page.name, signatures[i]!]));

  // Pass 2: convert pages
  for (const [index, page] of process.pages.entries()) {
    const isMain = index === 0;
    const className = isMain ? 'Main' : sanitizeFileName(page.name);
    const path = isMain ? 'Main.xaml' : `Pages/${sanitizeFileName(page.name)}.xaml`;
    const result = convertPage(page, className, signatures[index]!, signaturesByPageName, punch);
    for (const id of result.converted) convertedIds.add(id);
    workflows.push({ path, doc: result.doc });
  }

  const totalStageCount = process.pages.reduce((n, p) => n + p.stages.length, 0);
  const convertedStageCount = convertedIds.size;
  const coveragePct =
    totalStageCount === 0 ? 100 : Math.round((convertedStageCount / totalStageCount) * 1000) / 10;

  return {
    processName: process.name,
    workflows,
    totalStageCount,
    convertedStageCount,
    coveragePct,
    punchList: punch,
  };
}
