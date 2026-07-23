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
  ActionStage,
  AutomationModel,
  BusinessObjectNode,
  DataItem,
  Page,
  ProcessNode,
  Stage,
} from '@prismshift/ir';
import { SENSITIVE_NAME } from '@prismshift/rules';
import { translateBpExpression } from './bpExpression';
import { generateObjectSelectors } from './selectors';
import type { GeneratedSelector } from './selectors';
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
  /** XPath-like pointer into the original .bprelease XML. */
  sourceRef: string;
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

function buildPageSignature(owner: { dataItems: DataItem[] }, page: Page): PageSignature {
  const pageItems: DataItem[] = page.stages
    .filter(
      (s): s is Extract<Stage, { kind: 'data' | 'collection' }> =>
        s.kind === 'data' || s.kind === 'collection',
    )
    .map((s) => owner.dataItems.find((d) => d.id === s.dataItemId))
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
  /** Active collection loops (innermost last) for row-context field access. */
  loopStack: { collectionName: string; rowVar: string }[];
  /** Owner-level data items by name (collection field lookups). */
  itemsByName: Map<string, DataItem>;
  /** Generated selectors by App Modeller element id (objects only). */
  selectors: Map<string, GeneratedSelector>;
  /** `${objectName}::${pageName}` → invoke target (processes only). */
  objectRoutes: Map<string, { file: string; signature: PageSignature }>;
  /** True when this page retrieves its own TransactionItem. */
  pageHasGetTransaction: boolean;
  /**
   * BL-012: collections filled by Get Next Item on this page
   * (collection name → field name → BP type). Field reads rewrite to
   * TransactionItem.SpecificContent instead of DataTable access.
   */
  queueItemCollections: Map<string, Map<string, string>>;
  /**
   * BL-013: the identifier holding the queue item in this page —
   * `TransactionItem` (local, page ran Get Next Item) or `io_TransactionItem`
   * (received as an InOut argument from the caller).
   */
  transactionItemVar: string;
  /** BL-013: true when this page receives the item via io_TransactionItem. */
  receivesTransactionItem: boolean;
  /** True while emitting the recovery chain (Rethrow is only legal there). */
  inRecovery: boolean;
  /** Variables added during conversion (e.g. TransactionItem). */
  extraVariables: Map<string, XamlVariable>;
  punch: ConversionIssue[];
  converted: Set<string>;
  visited: Set<string>;
  /** BL-005: user-accepted AI code translations by stage id. */
  codeOverrides: Record<string, string>;
}

const TRANSACTION_ITEM = 'TransactionItem';
export const TRANSACTION_ITEM_ARG = 'io_TransactionItem';

function ensureTransactionItemVariable(ctx: ConvertContext): void {
  // Pages that receive the item as io_TransactionItem need no local variable.
  if (ctx.receivesTransactionItem) return;
  if (!ctx.extraVariables.has(TRANSACTION_ITEM)) {
    ctx.extraVariables.set(TRANSACTION_ITEM, { name: TRANSACTION_ITEM, type: 'QueueItem' });
  }
}

/** Queue-tagged BP actions → UiPath Orchestrator queue activities (S5-2). */
function mapQueueAction(ctx: ConvertContext, stage: ActionStage): XActivity[] {
  const activities: XActivity[] = [];
  const action = stage.actionName.toLowerCase();

  const queueName = stage.queueName;
  const queueNameProps: { queueName: string; queueNameIsExpression?: boolean } =
    queueName !== undefined
      ? { queueName }
      : {
          queueName: translate(
            ctx,
            stage,
            stage.inputs.find((i) => i.paramName === 'Queue Name')?.expression.raw ?? '""',
          ),
          queueNameIsExpression: true,
        };
  if (queueName === undefined) {
    issue(ctx, stage, 'Dynamic queue name — verify the resolved queue at runtime');
  }

  if (/get next/.test(action)) {
    ensureTransactionItemVariable(ctx);
    ctx.pageHasGetTransaction = true;
    activities.push({
      kind: 'getTransactionItem',
      displayName: stage.name,
      ...queueNameProps,
      storeIn: TRANSACTION_ITEM,
    });
    for (const output of stage.outputs) {
      const target = identifierFor(ctx, output.storeIn) ?? sanitizeIdentifier(output.storeIn);
      if (typeFor(ctx, target) === 'DataTable') {
        // BL-012: when the collection's fields are known, downstream
        // [Coll.Field] reads rewrite to typed SpecificContent access — the
        // DataTable is skipped entirely, so it is never left unset.
        const collectionItem = ctx.itemsByName.get(output.storeIn);
        if (collectionItem?.fields?.length) {
          ctx.queueItemCollections.set(
            output.storeIn,
            new Map(collectionItem.fields.map((field) => [field.name, field.type])),
          );
          activities.push({
            kind: 'comment',
            text: `PrismShift: BP output "${output.paramName}" carries the queue item data — [${output.storeIn}.<field>] reads below use ${TRANSACTION_ITEM}.SpecificContent("<field>") directly; ${target} stays unused.`,
          });
          issue(
            ctx,
            stage,
            `Queue item data reads rewritten to ${TRANSACTION_ITEM}.SpecificContent — verify field names match the queue schema`,
          );
        } else {
          activities.push({
            kind: 'comment',
            text: `PrismShift: BP output "${output.paramName}" carried the queue item data — read fields from ${TRANSACTION_ITEM}.SpecificContent("<field>") instead of ${target}.`,
          });
          issue(
            ctx,
            stage,
            `Queue item data output "${output.paramName}" needs manual mapping from ${TRANSACTION_ITEM}.SpecificContent (collection definition has no fields)`,
          );
        }
      } else {
        activities.push({
          kind: 'assign',
          displayName: `${stage.name}: ${output.paramName}`,
          to: target,
          value: `If(${TRANSACTION_ITEM} Is Nothing, String.Empty, ${TRANSACTION_ITEM}.Reference)`,
          type: 'String',
        });
        issue(
          ctx,
          stage,
          `BP "${output.paramName}" mapped to ${TRANSACTION_ITEM}.Reference — verify the queue's Reference field carries the item id`,
        );
      }
    }
    return activities;
  }

  if (/add to queue/.test(action)) {
    const dataInput = stage.inputs.find((i) => i.paramName === 'Data');
    const loop = ctx.loopStack[ctx.loopStack.length - 1];
    const dataRef = dataInput?.expression.raw.trim().replace(/^\[|\]$/g, '') ?? '';
    const collectionItem = ctx.itemsByName.get(dataRef);

    if (loop && dataRef === loop.collectionName && collectionItem?.fields?.length) {
      activities.push({
        kind: 'addQueueItem',
        displayName: stage.name,
        ...queueNameProps,
        itemInformation: collectionItem.fields.map((field) => ({
          name: field.name,
          expression: `${loop.rowVar}("${field.name}")`,
        })),
      });
    } else {
      activities.push({
        kind: 'addQueueItem',
        displayName: stage.name,
        ...queueNameProps,
        itemInformation: dataInput
          ? [{ name: 'Data', expression: translate(ctx, stage, dataInput.expression.raw) }]
          : [],
      });
      issue(
        ctx,
        stage,
        'Queue item fields could not be derived from a collection definition — verify ItemInformation',
      );
    }
    return activities;
  }

  if (/mark completed|complete/.test(action)) {
    ensureTransactionItemVariable(ctx);
    activities.push({
      kind: 'setTransactionStatus',
      displayName: stage.name,
      status: 'Successful',
      transactionItem: ctx.transactionItemVar,
    });
    noteTransactionItemSource(ctx, stage);
    return activities;
  }

  if (/mark exception|exception/.test(action)) {
    ensureTransactionItemVariable(ctx);
    const reasonInput = stage.inputs.find((i) => /reason/i.test(i.paramName));
    activities.push({
      kind: 'setTransactionStatus',
      displayName: stage.name,
      status: 'Failed',
      errorType: 'Application',
      transactionItem: ctx.transactionItemVar,
      ...(reasonInput ? { reason: translate(ctx, stage, reasonInput.expression.raw) } : {}),
    });
    noteTransactionItemSource(ctx, stage);
    return activities;
  }

  issue(ctx, stage, `Queue action "${stage.actionName}" has no mapping yet`);
  return [
    {
      kind: 'comment',
      text: `PrismShift TODO: queue action "${stage.actionName}" ("${stage.name}") not yet converted.`,
    },
  ];
}

/**
 * BL-013: where does this page's TransactionItem come from? Local Get Next
 * Item needs no note; a received io_TransactionItem gets a review note; a
 * page with neither keeps the honest restructure flag.
 */
function noteTransactionItemSource(ctx: ConvertContext, stage: Stage): void {
  if (ctx.pageHasGetTransaction) return;
  if (ctx.receivesTransactionItem) {
    issue(
      ctx,
      stage,
      `${stage.name} uses the ${TRANSACTION_ITEM_ARG} passed in by the caller — verify every call site binds it`,
    );
    return;
  }
  issue(
    ctx,
    stage,
    `SetTransactionStatus needs the ${TRANSACTION_ITEM} from Get Transaction Item — pass it into this page or restructure`,
  );
}

function issue(ctx: ConvertContext, stage: Stage, reason: string): void {
  ctx.punch.push({
    pageName: ctx.page.name,
    stageName: stage.name,
    stageKind: stage.kind,
    reason,
    sourceRef: stage.sourceRef.path,
  });
}

function identifierFor(ctx: ConvertContext, itemName: string): string | undefined {
  return ctx.signature.identifierMap.get(itemName);
}

function typeFor(ctx: ConvertContext, identifier: string): XamlType {
  return ctx.signature.typeMap.get(identifier) ?? 'String';
}

function translate(ctx: ConvertContext, stage: Stage, raw: string): string {
  const loop = ctx.loopStack[ctx.loopStack.length - 1];
  const { vb, issues } = translateBpExpression(raw, {
    resolveRef: (name) => identifierFor(ctx, name),
    ...(loop ? { loop } : {}),
    ...(ctx.queueItemCollections.size > 0
      ? { queueCollections: ctx.queueItemCollections, transactionItemVar: ctx.transactionItemVar }
      : {}),
  });
  for (const reason of issues) issue(ctx, stage, reason);
  return vb;
}


/** If raw is exactly one `[Ref]` (no dot), the identifier's known type. */
function pureRefType(ctx: ConvertContext, raw: string): XamlType | undefined {
  const match = /^\s*\[([^\].]+)\]\s*$/.exec(raw);
  if (!match) return undefined;
  const identifier = identifierFor(ctx, match[1]!.trim());
  return identifier !== undefined ? typeFor(ctx, identifier) : undefined;
}

const COERCERS: Partial<Record<XamlType, string>> = {
  String: 'CStr',
  Double: 'CDbl',
  Int32: 'CInt',
  Boolean: 'CBool',
  DateTime: 'CDate',
};

/** Option Strict-safe conversion wrapper toward a known target type. */
function coerceTo(vb: string, targetType: XamlType, sourceType?: XamlType): string {
  const coercer = COERCERS[targetType];
  if (!coercer) return vb; // Object/DataTable/QueueItem: no coercion
  if (sourceType === targetType) return vb;
  if (targetType === 'String' && /^"([^"]|"")*"$/.test(vb.trim())) return vb;
  if ((targetType === 'Double' || targetType === 'Int32') && /^-?\d+(\.\d+)?$/.test(vb.trim()))
    return vb;
  if (targetType === 'Boolean' && /^(True|False)$/i.test(vb.trim())) return vb;
  return `${coercer}(${vb})`;
}

function bindInvokeArguments(
  ctx: ConvertContext,
  stage: Stage & { inputs: { paramName: string; expression: { raw: string } }[]; outputs: { paramName: string; storeIn: string }[] },
  target: PageSignature | undefined,
): InvokeArgumentBinding[] {
  const bindings: InvokeArgumentBinding[] = [];

  for (const input of stage.inputs) {
    const calleeArg = target?.byInputParam.get(input.paramName);
    if (!calleeArg) {
      issue(ctx, stage, `Input "${input.paramName}" has no matching page parameter`);
    }
    if (calleeArg?.direction === 'inout') continue; // bound once, below
    const targetType = calleeArg?.type ?? 'String';
    bindings.push({
      name: calleeArg?.name ?? `in_${sanitizeIdentifier(input.paramName)}`,
      direction: 'in',
      type: targetType,
      expression: coerceTo(
        translate(ctx, stage, input.expression.raw),
        targetType,
        pureRefType(ctx, input.expression.raw),
      ),
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

  // BL-013: callee expects the queue item — bind our own item through.
  if (target?.args.some((arg) => arg.name === TRANSACTION_ITEM_ARG)) {
    ensureTransactionItemVariable(ctx);
    bindings.push({
      name: TRANSACTION_ITEM_ARG,
      direction: 'inout',
      type: 'QueueItem',
      expression: ctx.transactionItemVar,
    });
  }

  return bindings;
}

function selectorFor(
  ctx: ConvertContext,
  stage: Stage,
  elementId: string,
): GeneratedSelector | undefined {
  const generated = ctx.selectors.get(elementId);
  if (!generated) {
    issue(ctx, stage, `Element "${elementId}" has no App Modeller entry — selector missing`);
    return undefined;
  }
  if (generated.strategy === 'image-ocr' || generated.selector === undefined) {
    issue(
      ctx,
      stage,
      `Element "${generated.elementName}" (${generated.mode}) needs Image/OCR — no selector generated`,
    );
    return undefined;
  }
  if (generated.confidence < 0.5) {
    issue(
      ctx,
      stage,
      `Low-confidence selector (${generated.confidence}) for "${generated.elementName}" — on the validation checklist`,
    );
  }
  return generated;
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
        ctx.loopStack.push({ collectionName: stage.collectionName, rowVar: 'CurrentRow' });
        const bodyActs = emitChain(ctx, ctx.maps.nextFlow.get(current), loopEnd?.id);
        ctx.loopStack.pop();
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
        activities.push({
          kind: 'invokeWorkflow',
          displayName: stage.name,
          workflowFile: fileName,
          arguments: bindInvokeArguments(ctx, stage, target),
        });
        ctx.converted.add(stage.id);
        current = ctx.maps.nextFlow.get(current);
        break;
      }

      case 'exception': {
        if (stage.preserve === true) {
          // BP "preserve current exception" — rethrow the caught exception
          if (ctx.inRecovery) {
            activities.push({ kind: 'rethrow', displayName: stage.name });
          } else {
            activities.push({
              kind: 'comment',
              text: `PrismShift: "${stage.name}" preserves the current exception outside a recovery block — restructure manually.`,
            });
            issue(ctx, stage, 'Rethrow outside a recovery block needs manual restructuring');
          }
          ctx.converted.add(stage.id);
          current = ctx.maps.nextFlow.get(current);
          break;
        }
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

      case 'write': {
        for (const step of stage.steps) {
          const generated = selectorFor(ctx, stage, step.elementId);
          if (generated?.selector !== undefined) {
            activities.push({
              kind: 'typeInto',
              displayName: `${stage.name}: ${generated.elementName}`,
              selector: generated.selector,
              text: coerceTo(
                translate(ctx, stage, step.value.raw),
                'String',
                pureRefType(ctx, step.value.raw),
              ),
            });
          } else {
            activities.push({
              kind: 'comment',
              text: `PrismShift: write step for element ${step.elementId} needs manual work (no selector).`,
            });
          }
        }
        ctx.converted.add(stage.id);
        current = ctx.maps.nextFlow.get(current);
        break;
      }

      case 'read': {
        for (const step of stage.steps) {
          const generated = selectorFor(ctx, stage, step.elementId);
          const target = identifierFor(ctx, step.storeIn) ?? sanitizeIdentifier(step.storeIn);
          if (generated?.selector !== undefined) {
            if (typeFor(ctx, target) !== 'String') {
              issue(
                ctx,
                stage,
                `GetText returns String but "${step.storeIn}" is ${typeFor(ctx, target)} — convert after reading`,
              );
            }
            activities.push({
              kind: 'getText',
              displayName: `${stage.name}: ${generated.elementName}`,
              selector: generated.selector,
              storeIn: target,
            });
          } else {
            activities.push({
              kind: 'comment',
              text: `PrismShift: read step into ${target} needs manual work (no selector).`,
            });
          }
        }
        ctx.converted.add(stage.id);
        current = ctx.maps.nextFlow.get(current);
        break;
      }

      case 'navigate': {
        for (const step of stage.steps) {
          const generated = selectorFor(ctx, stage, step.elementId);
          if (generated?.selector === undefined) {
            activities.push({
              kind: 'comment',
              text: `PrismShift: navigate step (${step.action}) needs manual work (no selector).`,
            });
            continue;
          }
          if (!/^click/i.test(step.action)) {
            issue(ctx, stage, `Navigate action "${step.action}" approximated as Click — verify`);
          }
          activities.push({
            kind: 'click',
            displayName: `${stage.name}: ${generated.elementName}`,
            selector: generated.selector,
          });
        }
        ctx.converted.add(stage.id);
        current = ctx.maps.nextFlow.get(current);
        break;
      }

      case 'wait': {
        // BL-015: EVERY condition converts — one UiElementExists per element,
        // Or-combined into the decision (BP waits proceed on ANY condition).
        const conditions = stage.conditions.length > 0 ? stage.conditions : [undefined];
        let timeoutMs: number;
        if (stage.timeoutSeconds !== undefined && stage.timeoutSeconds > 0) {
          timeoutMs = stage.timeoutSeconds * 1000;
        } else {
          timeoutMs = 30000;
          issue(ctx, stage, 'Wait had no timeout in the source — defaulted to 30s (REL-003)');
        }

        const resultVars: string[] = [];
        for (const [conditionIndex, waitCondition] of conditions.entries()) {
          const generated =
            waitCondition?.elementId !== undefined
              ? selectorFor(ctx, stage, waitCondition.elementId)
              : undefined;
          const suffix = conditions.length > 1 ? `_${conditionIndex + 1}` : '';
          const conditionVar = `Exists_${sanitizeIdentifier(stage.name)}${suffix}`;
          ctx.extraVariables.set(conditionVar, { name: conditionVar, type: 'Boolean' });
          resultVars.push(conditionVar);
          activities.push({
            kind: 'elementExists',
            displayName:
              conditions.length > 1
                ? `${stage.name} (condition ${conditionIndex + 1})`
                : stage.name,
            selector: generated?.selector ?? '',
            storeIn: conditionVar,
            timeoutMs,
          });
        }
        const resultVar = resultVars.join(' Or ');

        const branches = ctx.maps.choiceTargets.get(current) ?? [];
        const timeoutBranch = branches.find((b) => b.label === 'Time Out');
        const foundBranch = branches.find((b) => b.label !== 'Time Out');
        const join = findJoin(ctx.maps, [foundBranch?.to, timeoutBranch?.to]);
        const thenActs = emitChain(ctx, foundBranch?.to, join);
        const elseActs = emitChain(ctx, timeoutBranch?.to, join);
        activities.push({
          kind: 'if',
          displayName: `${stage.name}?`,
          condition: resultVar,
          ...(thenActs.length > 0
            ? { then: { kind: 'sequence', displayName: 'Found', activities: thenActs } }
            : {}),
          ...(elseActs.length > 0
            ? { else: { kind: 'sequence', displayName: 'Timed Out', activities: elseActs } }
            : {}),
        });
        ctx.converted.add(stage.id);
        current = join;
        break;
      }

      case 'code': {
        if (stage.language === 'jscript' && ctx.codeOverrides[stage.id] === undefined) {
          activities.push({
            kind: 'comment',
            text: `PrismShift: JScript code stage "${stage.name}" cannot map to InvokeCode — port manually.`,
          });
          issue(ctx, stage, 'JScript code stages have no InvokeCode equivalent');
          current = ctx.maps.nextFlow.get(current);
          break;
        }
        const override = ctx.codeOverrides[stage.id];
        if (override !== undefined) {
          issue(
            ctx,
            stage,
            'Code translated by an AI suggestion the user accepted — review the translation before go-live',
          );
        }
        activities.push({
          kind: 'invokeCode',
          displayName: stage.name,
          language: override !== undefined ? 'VBNet' : stage.language === 'csharp' ? 'CSharp' : 'VBNet',
          code: override !== undefined ? override.trim() : stage.body.trim(),
          arguments: [
            ...stage.inputs.map((input) => ({
              name: sanitizeIdentifier(input.paramName),
              direction: 'in' as const,
              type: pureRefType(ctx, input.expression.raw) ?? ('String' as const),
              expression: translate(ctx, stage, input.expression.raw),
            })),
            ...stage.outputs.map((output) => {
              const target =
                identifierFor(ctx, output.storeIn) ?? sanitizeIdentifier(output.storeIn);
              return {
                name: sanitizeIdentifier(output.paramName),
                direction: 'out' as const,
                type: typeFor(ctx, target),
                expression: target,
              };
            }),
          ],
        });
        issue(
          ctx,
          stage,
          `Code stage body carried over verbatim — review the ${stage.language} source inside InvokeCode`,
        );
        ctx.converted.add(stage.id);
        current = ctx.maps.nextFlow.get(current);
        break;
      }

      case 'action':
        if (stage.queueName !== undefined || stage.objectName === 'Work Queues') {
          activities.push(...mapQueueAction(ctx, stage));
          ctx.converted.add(stage.id);
        } else {
          const route = ctx.objectRoutes.get(`${stage.objectName}::${stage.actionName}`);
          if (route) {
            activities.push({
              kind: 'invokeWorkflow',
              displayName: stage.name,
              workflowFile: route.file,
              arguments: bindInvokeArguments(ctx, stage, route.signature),
            });
            ctx.converted.add(stage.id);
          } else {
            activities.push({
              kind: 'comment',
              text: `PrismShift: action "${stage.name}" targets ${stage.objectName} › ${stage.actionName}, which is not in this release — supply the object or rewire manually.`,
            });
            issue(
              ctx,
              stage,
              `Object "${stage.objectName}" (action "${stage.actionName}") not found in the release`,
            );
          }
        }
        current = ctx.maps.nextFlow.get(current);
        break;

      case 'alert': {
        // BL-011: BP alerts are operator notifications → Orchestrator log
        // lines. If the message references a sensitive item (SEC-003 territory)
        // the log activity carries the warning inline so nobody ships PII
        // logging by accident.
        if (SENSITIVE_NAME.test(stage.message.raw)) {
          activities.push({
            kind: 'comment',
            text: `PrismShift SEC-003: this alert message references sensitive data — review before logging (see the Vulnerabilities tab).`,
          });
          issue(ctx, stage, 'Alert message references sensitive data (SEC-003) — review the log line');
        }
        activities.push({
          kind: 'logMessage',
          displayName: stage.name,
          level: 'Info',
          message: translate(ctx, stage, stage.message.raw),
        });
        current = ctx.maps.nextFlow.get(current);
        break;
      }

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

/** BL-013: cross-page queue-item context computed by convertProcess's pre-pass. */
interface CrossPageQueueContext {
  /** This page receives the item via the io_TransactionItem argument. */
  receivesTransactionItem: boolean;
  /** Callee param name → queue collection fields fed in by a caller. */
  queueParams: Map<string, Map<string, string>>;
}

function convertPage(
  owner: { dataItems: DataItem[] },
  page: Page,
  className: string,
  signature: PageSignature,
  signaturesByPageName: Map<string, PageSignature>,
  selectors: Map<string, GeneratedSelector>,
  objectRoutes: Map<string, { file: string; signature: PageSignature }>,
  punch: ConversionIssue[],
  codeOverrides: Record<string, string> = {},
  crossPage: CrossPageQueueContext = { receivesTransactionItem: false, queueParams: new Map() },
): { doc: WorkflowDoc; converted: Set<string> } {
  const maps = buildMaps(page);
  const converted = new Set<string>();
  const ctx: ConvertContext = {
    page,
    maps,
    signature,
    signaturesByPageName,
    loopStack: [],
    queueItemCollections: new Map(),
    transactionItemVar: crossPage.receivesTransactionItem ? TRANSACTION_ITEM_ARG : TRANSACTION_ITEM,
    receivesTransactionItem: crossPage.receivesTransactionItem,
    itemsByName: new Map(owner.dataItems.map((d) => [d.name, d])),
    selectors,
    objectRoutes,
    pageHasGetTransaction: false,
    inRecovery: false,
    extraVariables: new Map(),
    punch,
    converted,
    visited: new Set(),
    codeOverrides,
  };

  // BL-013: Start params fed a queue collection by a caller — field reads on
  // the receiving collection rewrite to SpecificContent on io_TransactionItem.
  if (crossPage.queueParams.size > 0) {
    const startBindings = page.stages.find((s) => s.kind === 'start');
    for (const binding of (startBindings?.kind === 'start' ? startBindings.inputs : []) ?? []) {
      const fields = crossPage.queueParams.get(binding.paramName);
      if (fields !== undefined) ctx.queueItemCollections.set(binding.storeIn, fields);
    }
  }

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
  let recoveryChain: XActivity[] = [];
  if (recoverStage) {
    converted.add(recoverStage.id);
    ctx.inRecovery = true;
    recoveryChain = emitChain(ctx, maps.nextFlow.get(recoverStage.id), undefined);
    ctx.inRecovery = false;
  }
  // Variables must be collected AFTER every chain has emitted — recovery
  // chains can add variables too (e.g. TransactionItem).
  const allVariables = [...signature.variables, ...ctx.extraVariables.values()];
  let body: XActivity;
  if (recoverStage) {
    body = {
      kind: 'sequence',
      displayName: page.name,
      variables: allVariables,
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
      variables: allVariables,
      activities: mainChain,
    };
  }

  return { doc: { className, arguments: signature.args, body }, converted };
}

// ---------------------------------------------------------------------------
// Process → conversion
// ---------------------------------------------------------------------------

export interface ConvertOptions {
  /**
   * BL-005: user-ACCEPTED AI code translations, keyed by stage id. Never
   * auto-applied — the web UI only fills this after an explicit accept, and
   * every applied override is punch-listed in the migration report.
   */
  codeOverrides?: Record<string, string>;
}

export function convertProcess(
  model: AutomationModel,
  process: ProcessNode,
  options: ConvertOptions = {},
): ProcessConversion {
  const punch: ConversionIssue[] = [];
  const workflows: { path: string; doc: WorkflowDoc }[] = [];
  const convertedIds = new Set<string>();

  // Routes to converted object workflows: `${object}::${actionPage}`
  const objectRoutes = new Map<string, { file: string; signature: PageSignature }>();
  for (const object of model.objects) {
    const objectDir = sanitizeFileName(object.name);
    for (const page of object.pages) {
      objectRoutes.set(`${object.name}::${page.name}`, {
        file: `Objects\\${objectDir}\\${sanitizeFileName(page.name)}.xaml`,
        signature: buildPageSignature(object, page),
      });
    }
  }

  // Pass 1: argument signatures for every page (callers bind against these)
  const signatures = process.pages.map((page) => buildPageSignature(process, page));
  const signaturesByPageName = new Map(process.pages.map((page, i) => [page.name, signatures[i]!]));

  // BL-013 pre-pass: which pages must receive the TransactionItem?
  const isQueueStage = (s: Stage): s is ActionStage =>
    s.kind === 'action' && (s.queueName !== undefined || s.objectName === 'Work Queues');
  const pageHasGetNext = (page: Page): boolean =>
    page.stages.some((s) => isQueueStage(s) && /get next/.test(s.actionName.toLowerCase()));
  const usesItemStatus = (page: Page): boolean =>
    page.stages.some(
      (s) => isQueueStage(s) && /mark completed|complete|mark exception|exception/.test(s.actionName.toLowerCase()),
    );

  // a) queue collections produced per page (Get Next outputs with field defs)
  const queueCollectionsByPage = new Map<string, Map<string, Map<string, string>>>();
  for (const page of process.pages) {
    const collections = new Map<string, Map<string, string>>();
    for (const stage of page.stages) {
      if (!isQueueStage(stage) || !/get next/.test(stage.actionName.toLowerCase())) continue;
      for (const output of stage.outputs) {
        const item = process.dataItems.find(
          (d) => d.name === output.storeIn && d.dataType === 'collection',
        );
        if (item?.fields?.length) {
          collections.set(output.storeIn, new Map(item.fields.map((f) => [f.name, f.type])));
        }
      }
    }
    if (collections.size > 0) queueCollectionsByPage.set(page.name, collections);
  }

  // b) callee pages fed a whole queue collection via a page-reference input
  const queueParamsByPage = new Map<string, Map<string, Map<string, string>>>();
  for (const page of process.pages) {
    const collections = queueCollectionsByPage.get(page.name);
    if (!collections) continue;
    for (const stage of page.stages) {
      if (stage.kind !== 'subsheetRef') continue;
      for (const input of stage.inputs) {
        const match = /^\s*\[([^\].]+)\]\s*$/.exec(input.expression.raw);
        const fields = match ? collections.get(match[1]!.trim()) : undefined;
        if (fields !== undefined) {
          const calleeParams = queueParamsByPage.get(stage.targetPageName) ?? new Map();
          calleeParams.set(input.paramName, fields);
          queueParamsByPage.set(stage.targetPageName, calleeParams);
        }
      }
    }
  }

  // c) pages needing io_TransactionItem: status writers and queue-collection
  //    receivers without their own Get Next, plus (fixpoint) their callers.
  const needsItem = new Set<string>();
  for (const page of process.pages) {
    if (pageHasGetNext(page)) continue;
    if (usesItemStatus(page) || queueParamsByPage.has(page.name)) needsItem.add(page.name);
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const page of process.pages) {
      if (needsItem.has(page.name) || pageHasGetNext(page)) continue;
      if (page.stages.some((s) => s.kind === 'subsheetRef' && needsItem.has(s.targetPageName))) {
        needsItem.add(page.name);
        grew = true;
      }
    }
  }

  // d) augment signatures — callers bind io_TransactionItem like any InOut arg
  for (const page of process.pages) {
    if (!needsItem.has(page.name)) continue;
    const signature = signaturesByPageName.get(page.name)!;
    signature.args.push({ name: TRANSACTION_ITEM_ARG, direction: 'inout', type: 'QueueItem' });
    signature.typeMap.set(TRANSACTION_ITEM_ARG, 'QueueItem');
  }

  // Pass 2: convert pages
  for (const [index, page] of process.pages.entries()) {
    const isMain = index === 0;
    const className = isMain ? 'Main' : sanitizeFileName(page.name);
    const path = isMain ? 'Main.xaml' : `Pages/${sanitizeFileName(page.name)}.xaml`;
    const result = convertPage(
      process,
      page,
      className,
      signatures[index]!,
      signaturesByPageName,
      new Map(),
      objectRoutes,
      punch,
      options.codeOverrides ?? {},
      {
        receivesTransactionItem: needsItem.has(page.name),
        queueParams: queueParamsByPage.get(page.name) ?? new Map(),
      },
    );
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

// ---------------------------------------------------------------------------
// Object → conversion (S5-4)
// ---------------------------------------------------------------------------

export interface ObjectConversion {
  objectName: string;
  /** One workflow per action page, under Objects/<Object>/. */
  workflows: { path: string; doc: WorkflowDoc }[];
  totalStageCount: number;
  convertedStageCount: number;
  coveragePct: number;
  punchList: ConversionIssue[];
  /** Every generated selector — the migration report's validation checklist. */
  selectors: GeneratedSelector[];
}

export function convertObject(
  _model: AutomationModel,
  object: BusinessObjectNode,
  options: ConvertOptions = {},
): ObjectConversion {
  const punch: ConversionIssue[] = [];
  const workflows: { path: string; doc: WorkflowDoc }[] = [];
  const convertedIds = new Set<string>();

  const selectors = generateObjectSelectors(object);
  const selectorMap = new Map(selectors.map((s) => [s.elementId, s]));

  const signatures = object.pages.map((page) => buildPageSignature(object, page));
  const signaturesByPageName = new Map(object.pages.map((page, i) => [page.name, signatures[i]!]));

  const objectDir = sanitizeFileName(object.name);
  for (const [index, page] of object.pages.entries()) {
    const className = sanitizeFileName(page.name);
    const path = `Objects/${objectDir}/${sanitizeFileName(page.name)}.xaml`;
    const result = convertPage(
      object,
      page,
      className,
      signatures[index]!,
      signaturesByPageName,
      selectorMap,
      new Map(),
      punch,
      options.codeOverrides ?? {},
    );
    for (const id of result.converted) convertedIds.add(id);
    workflows.push({ path, doc: result.doc });
  }

  const totalStageCount = object.pages.reduce((n, p) => n + p.stages.length, 0);
  const convertedStageCount = convertedIds.size;
  const coveragePct =
    totalStageCount === 0 ? 100 : Math.round((convertedStageCount / totalStageCount) * 1000) / 10;

  return {
    objectName: object.name,
    workflows,
    totalStageCount,
    convertedStageCount,
    coveragePct,
    punchList: punch,
    selectors,
  };
}
