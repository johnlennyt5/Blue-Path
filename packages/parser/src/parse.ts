import { XMLParser } from 'fast-xml-parser';
import { buildDependencyGraph } from '@prismshift/ir';
import type {
  AppElement,
  AppMode,
  AppModel,
  AutomationModel,
  BpDataType,
  BusinessObjectNode,
  DataItem,
  ElementAttr,
  EnvVarDef,
  InputBinding,
  OutputBinding,
  Page,
  Param,
  ProcessNode,
  SourceRef,
  Stage,
  StageEdge,
  WorkQueueDef,
} from '@prismshift/ir';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ParseIssue {
  message: string;
  path?: string;
}

/**
 * The parser never throws on malformed-but-salvageable input: `errors` holds
 * unparseable sections, `warnings` holds tolerated oddities (ARCHITECTURE §3).
 */
export interface ParseResult {
  model: AutomationModel;
  warnings: ParseIssue[];
  errors: ParseIssue[];
}

// ---------------------------------------------------------------------------
// XML plumbing
// ---------------------------------------------------------------------------

type Xml = Record<string, unknown>;

const ARRAY_TAGS = new Set([
  'process',
  'object',
  'work-queue',
  'environment-variable',
  'stage',
  'subsheet',
  'element',
  'attribute',
  'input',
  'output',
  'step',
  'choice',
  'calculation',
  'field',
]);

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  cdataPropName: '#cdata',
  isArray: (tagName) => ARRAY_TAGS.has(tagName),
});

const asArray = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

const isRecord = (value: unknown): value is Xml =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** First string content of a possibly-array element (`<element>guid</element>`). */
const firstStr = (value: unknown): string => {
  const first = asArray(value)[0];
  return str(first);
};

const ref = (path: string): SourceRef => ({ path });

// ---------------------------------------------------------------------------
// Small mappers
// ---------------------------------------------------------------------------

const BP_DATA_TYPES: BpDataType[] = [
  'text',
  'number',
  'flag',
  'date',
  'datetime',
  'time',
  'timespan',
  'password',
  'image',
  'binary',
  'collection',
];

function mapDataType(raw: string, warnings: ParseIssue[], path: string): BpDataType {
  const lower = raw.toLowerCase();
  if ((BP_DATA_TYPES as string[]).includes(lower)) return lower as BpDataType;
  if (raw !== '') {
    warnings.push({ message: `Unknown data type "${raw}" — treated as text`, path });
  }
  return 'text';
}

const APP_MODES: AppMode[] = ['Win32', 'HTML', 'Java', 'UIA', 'SAP', 'Citrix', 'Region'];

const MATCH_TYPES = ['exact', 'wildcard', 'regex', 'index', 'dynamic'] as const;

function mapExposure(raw: string): DataItem['exposure'] {
  const lower = raw.toLowerCase();
  if (lower === 'environment' || lower === 'session' || lower === 'statistic') return lower;
  return 'none';
}

function parseParams(container: unknown, tag: 'input' | 'output', direction: Param['direction']): Param[] {
  if (!isRecord(container)) return [];
  return asArray(container[tag]).map((entry) => {
    const e = entry as Xml;
    return {
      name: str(e['@_name']),
      dataType: (BP_DATA_TYPES as string[]).includes(str(e['@_type']).toLowerCase())
        ? (str(e['@_type']).toLowerCase() as BpDataType)
        : 'text',
      direction,
    };
  });
}

/** Start/End param ↔ data item bindings (`name` + `stage` attributes). */
function parseParamBindings(container: unknown, tag: 'input' | 'output'): OutputBinding[] {
  if (!isRecord(container)) return [];
  return asArray(container[tag])
    .map((entry) => {
      const e = entry as Xml;
      return { paramName: str(e['@_name']), storeIn: str(e['@_stage']) };
    })
    .filter((b) => b.storeIn !== '');
}

function parseInputBindings(container: unknown): InputBinding[] {
  if (!isRecord(container)) return [];
  return asArray(container['input']).map((entry) => {
    const e = entry as Xml;
    return { paramName: str(e['@_name']), expression: { raw: str(e['@_expr']) } };
  });
}

function parseOutputBindings(container: unknown): OutputBinding[] {
  if (!isRecord(container)) return [];
  return asArray(container['output']).map((entry) => {
    const e = entry as Xml;
    return { paramName: str(e['@_name']), storeIn: str(e['@_stage']) };
  });
}

function parsePosition(stage: Xml): { x: number; y: number } | undefined {
  const display = stage['display'];
  if (!isRecord(display)) return undefined;
  const x = Number(str(display['@_x']));
  const y = Number(str(display['@_y']));
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
}

// ---------------------------------------------------------------------------
// Stage parsing
// ---------------------------------------------------------------------------

interface StageParseContext {
  path: string;
  pageNameById: Map<string, string>;
  warnings: ParseIssue[];
  edges: StageEdge[];
  dataItems: DataItem[];
}

function link(edges: StageEdge[], from: string, target: unknown, kind: StageEdge['kind'], label?: string): void {
  const to = str(target);
  if (to !== '') edges.push(label === undefined ? { from, to, kind } : { from, to, kind, label });
}

function parseStage(raw: Xml, ctx: StageParseContext): Stage {
  const id = str(raw['@_stageid']);
  const name = str(raw['@_name']);
  const type = str(raw['@_type']);
  const { path, warnings, edges } = ctx;
  const base = { id, name, sourceRef: ref(path) };
  const position = parsePosition(raw);
  if (position) Object.assign(base, { position });

  link(edges, id, raw['onsuccess'], 'flow');
  link(edges, id, raw['ontrue'], 'true');
  link(edges, id, raw['onfalse'], 'false');
  link(edges, id, raw['ontimeout'], 'choice', 'Time Out');

  switch (type) {
    case 'Start': {
      const bindings = parseParamBindings(raw['inputs'], 'input');
      const stage: Stage = { ...base, kind: 'start' };
      if (bindings.length > 0) stage.inputs = bindings;
      return stage;
    }
    case 'End': {
      const bindings = parseParamBindings(raw['outputs'], 'output');
      const stage: Stage = { ...base, kind: 'end' };
      if (bindings.length > 0) stage.outputs = bindings;
      return stage;
    }
    case 'Anchor':
      return { ...base, kind: 'anchor' };
    case 'Recover':
      return { ...base, kind: 'recover' };
    case 'Resume':
      return { ...base, kind: 'resume' };
    case 'Note':
      return { ...base, kind: 'note', text: str(raw['narrative']) };
    case 'Alert': {
      const alert = raw['alert'];
      return {
        ...base,
        kind: 'alert',
        message: { raw: isRecord(alert) ? str(alert['@_expression']) : '' },
      };
    }
    case 'Calculation': {
      // 'calculation' is array-parsed (multi-calc steps use the same tag),
      // so a single Calculation stage's child arrives as a one-item array.
      const calc = asArray(raw['calculation'])[0];
      return {
        ...base,
        kind: 'calculation',
        expression: { raw: isRecord(calc) ? str(calc['@_expression']) : '' },
        storeIn: isRecord(calc) ? str(calc['@_stage']) : '',
      };
    }
    case 'MultipleCalculation': {
      const steps = isRecord(raw['steps']) ? asArray((raw['steps'] as Xml)['calculation']) : [];
      return {
        ...base,
        kind: 'multiCalc',
        steps: steps.map((s) => ({
          expression: { raw: str((s as Xml)['@_expression']) },
          storeIn: str((s as Xml)['@_stage']),
        })),
      };
    }
    case 'Decision': {
      const decision = raw['decision'];
      return {
        ...base,
        kind: 'decision',
        expression: { raw: isRecord(decision) ? str(decision['@_expression']) : '' },
      };
    }
    case 'ChoiceStart': {
      const choices = isRecord(raw['choices']) ? asArray((raw['choices'] as Xml)['choice']) : [];
      for (const choice of choices) {
        link(edges, id, (choice as Xml)['onsuccess'], 'choice', str((choice as Xml)['@_name']));
      }
      return {
        ...base,
        kind: 'choice',
        choices: choices.map((c) => ({
          name: str((c as Xml)['@_name']),
          expression: { raw: str((c as Xml)['@_expression']) },
        })),
      };
    }
    case 'ChoiceEnd':
      return { ...base, kind: 'anchor' };
    case 'Data': {
      const dataType = mapDataType(str(raw['datatype']), ctx.warnings, path);
      const initialValue = str(raw['initialvalue']);
      const exposure = mapExposure(str(raw['exposure']));
      const item: DataItem = { id, name, dataType, sourceRef: ref(path) };
      if (initialValue !== '') item.initialValue = initialValue;
      if (exposure !== 'none') item.exposure = exposure;
      ctx.dataItems.push(item);
      return { ...base, kind: 'data', dataItemId: id };
    }
    case 'Collection': {
      const info = raw['collectioninfo'];
      const fields = isRecord(info) ? asArray(info['field']) : [];
      ctx.dataItems.push({
        id,
        name,
        dataType: 'collection',
        fields: fields.map((f) => ({
          name: str((f as Xml)['@_name']),
          dataType: mapDataType(str((f as Xml)['@_type']), warnings, path),
        })),
        sourceRef: ref(path),
      });
      return { ...base, kind: 'collection', dataItemId: id };
    }
    case 'LoopStart':
      return {
        ...base,
        kind: 'loopStart',
        collectionName: str(raw['loopdata']),
        pairId: str(raw['groupid']),
      };
    case 'LoopEnd':
      return { ...base, kind: 'loopEnd', pairId: str(raw['groupid']) };
    case 'Action': {
      const resource = raw['resource'];
      const objectName = isRecord(resource) ? str(resource['@_object']) : '';
      const actionName = isRecord(resource) ? str(resource['@_action']) : '';
      const inputs = parseInputBindings(raw['inputs']);
      const stage: Stage = {
        ...base,
        kind: 'action',
        objectName,
        actionName,
        inputs,
        outputs: parseOutputBindings(raw['outputs']),
      };
      if (objectName === 'Work Queues') {
        const queueArg = inputs.find((i) => i.paramName === 'Queue Name');
        const literal = queueArg?.expression.raw.match(/^"(.*)"$/);
        if (literal?.[1] !== undefined) {
          stage.queueName = literal[1];
        } else {
          warnings.push({
            message: `Queue action "${name}" has a non-literal Queue Name — queue dependency not resolved`,
            path,
          });
        }
      }
      return stage;
    }
    case 'SubSheet': {
      const targetPageId = str(raw['processid']);
      const targetPageName = ctx.pageNameById.get(targetPageId);
      if (targetPageName === undefined) {
        warnings.push({
          message: `Page reference "${name}" targets unknown page id "${targetPageId}" — reference left unresolved`,
          path,
        });
      }
      const stage: Stage = {
        ...base,
        kind: 'subsheetRef',
        targetPageName: targetPageName ?? '',
        inputs: parseInputBindings(raw['inputs']),
        outputs: parseOutputBindings(raw['outputs']),
      };
      // Only keep the id when it resolves — a dangling id would make the
      // model structurally unsound (validateModel) over a tolerated oddity.
      if (targetPageId !== '' && targetPageName !== undefined) {
        stage.targetPageId = targetPageId;
      }
      return stage;
    }
    case 'Exception': {
      const exception = raw['exception'];
      const stage: Stage = { ...base, kind: 'exception' };
      if (isRecord(exception)) {
        const exceptionType = str(exception['@_type']);
        const detail = str(exception['@_detail']);
        if (exceptionType !== '') stage.exceptionType = exceptionType;
        if (detail !== '') stage.detail = { raw: detail };
      }
      return stage;
    }
    case 'Read': {
      const steps = isRecord(raw['steps']) ? asArray((raw['steps'] as Xml)['step']) : [];
      return {
        ...base,
        kind: 'read',
        steps: steps.map((s) => {
          const e = s as Xml;
          const step: { elementId: string; action?: string; storeIn: string } = {
            elementId: str(e['@_element']),
            storeIn: str(e['@_stage']),
          };
          if (str(e['@_action']) !== '') step.action = str(e['@_action']);
          return step;
        }),
      };
    }
    case 'Write': {
      const steps = isRecord(raw['steps']) ? asArray((raw['steps'] as Xml)['step']) : [];
      return {
        ...base,
        kind: 'write',
        steps: steps.map((s) => ({
          elementId: str((s as Xml)['@_element']),
          value: { raw: str((s as Xml)['@_expr']) },
        })),
      };
    }
    case 'Navigate': {
      const steps = isRecord(raw['steps']) ? asArray((raw['steps'] as Xml)['step']) : [];
      return {
        ...base,
        kind: 'navigate',
        steps: steps.map((s) => ({
          elementId: str((s as Xml)['@_element']),
          action: str((s as Xml)['@_action']),
        })),
      };
    }
    case 'WaitStart': {
      const timeoutRaw = str(raw['timeout']);
      const choices = isRecord(raw['choices']) ? asArray((raw['choices'] as Xml)['choice']) : [];
      for (const choice of choices) {
        link(edges, id, (choice as Xml)['onsuccess'], 'choice', str((choice as Xml)['@_name']));
      }
      const stage: Stage = {
        ...base,
        kind: 'wait',
        conditions: choices.map((c) => {
          const e = c as Xml;
          const condition: { elementId?: string; condition: string } = {
            condition: firstStr(e['condition']),
          };
          const elementId = firstStr(e['element']);
          if (elementId !== '') condition.elementId = elementId;
          return condition;
        }),
      };
      const timeoutSeconds = Number(timeoutRaw);
      if (timeoutRaw !== '' && Number.isFinite(timeoutSeconds)) {
        stage.timeoutSeconds = timeoutSeconds;
      }
      return stage;
    }
    // WaitEnd is the timeout continuation point — modeled as an anchor.
    case 'WaitEnd':
      return { ...base, kind: 'anchor' };
    case 'Code': {
      const code = raw['code'];
      const language = isRecord(code) ? str(code['@_language']).toLowerCase() : '';
      return {
        ...base,
        kind: 'code',
        language: language === 'csharp' || language === 'jscript' ? language : 'vbnet',
        body: isRecord(code) ? str(code['#cdata']) || str(code['#text']) : '',
        inputs: parseInputBindings(raw['inputs']),
        outputs: parseOutputBindings(raw['outputs']),
      };
    }
    default:
      warnings.push({
        message: `Unknown stage type "${type}" (stage "${name}") — preserved as generic stage`,
        path,
      });
      return { ...base, kind: 'generic', rawType: type, raw };
  }
}

// ---------------------------------------------------------------------------
// Definition (process / object) parsing
// ---------------------------------------------------------------------------

interface Definition {
  name: string;
  description: string;
  bpVersion: string;
  pages: Page[];
  dataItems: DataItem[];
  startupParams: Param[];
  outputs: Param[];
  appModel?: AppModel;
}

function parseDefinition(definition: Xml, basePath: string, warnings: ParseIssue[]): Definition {
  const name = str(definition['@_name']);
  const description = str(definition['@_narrative']);
  const bpVersion = str(definition['@_bpversion']);

  // Pages: declared subsheets, main page first
  const subsheets = asArray(definition['subsheet']).map((s, i) => {
    const e = s as Xml;
    return {
      id: str(e['@_subsheetid']),
      name: firstStr(e['name']),
      isMain: str(e['@_type']) === 'MainPage',
      sourceRef: ref(`${basePath}/subsheet[${i + 1}]`),
    };
  });
  subsheets.sort((a, b) => Number(b.isMain) - Number(a.isMain));

  if (subsheets.length === 0) {
    warnings.push({ message: `"${name}" declares no pages — synthesizing a main page`, path: basePath });
    subsheets.push({ id: `${name}-main`, name: 'Main Page', isMain: true, sourceRef: ref(basePath) });
  }

  const pageNameById = new Map(subsheets.map((s) => [s.id, s.name]));
  const pageMap = new Map<string, Page>(
    subsheets.map((s) => [
      s.id,
      { id: s.id, name: s.name, stages: [], edges: [], sourceRef: s.sourceRef },
    ]),
  );
  const fallbackPage = pageMap.get(subsheets[0]!.id)!;

  const dataItems: DataItem[] = [];
  const stagesRaw = asArray(definition['stage']);
  for (const [i, stageEntry] of stagesRaw.entries()) {
    const raw = stageEntry as Xml;
    const path = `${basePath}/stage[${i + 1}]`;
    let page = pageMap.get(str(raw['subsheetid']));
    if (!page) {
      warnings.push({
        message: `Stage "${str(raw['@_name'])}" references unknown page id "${str(raw['subsheetid'])}" — attached to "${fallbackPage.name}"`,
        path,
      });
      page = fallbackPage;
    }
    const stage = parseStage(raw, {
      path,
      pageNameById,
      warnings,
      edges: page.edges,
      dataItems,
    });
    page.stages.push(stage);
  }

  const pages = [...pageMap.values()];
  const mainPage = pages[0];

  // Process-level params come from the main page's Start/End stages
  const startStageRaw = stagesRaw.find(
    (s) =>
      str((s as Xml)['@_type']) === 'Start' &&
      str((s as Xml)['subsheetid']) === mainPage?.id,
  ) as Xml | undefined;
  const endStageRaw = stagesRaw.find(
    (s) =>
      str((s as Xml)['@_type']) === 'End' && str((s as Xml)['subsheetid']) === mainPage?.id,
  ) as Xml | undefined;

  const result: Definition = {
    name,
    description,
    bpVersion,
    pages,
    dataItems,
    startupParams: startStageRaw ? parseParams(startStageRaw['inputs'], 'input', 'in') : [],
    outputs: endStageRaw ? parseParams(endStageRaw['outputs'], 'output', 'out') : [],
  };

  const appdef = definition['appdef'];
  if (isRecord(appdef)) {
    result.appModel = parseAppDef(appdef, basePath, warnings);
  }
  return result;
}

function parseAppDef(appdef: Xml, basePath: string, warnings: ParseIssue[]): AppModel {
  const application = appdef['application'];
  const model: AppModel = { elements: [] };
  if (isRecord(application) && str(application['@_name']) !== '') {
    model.applicationName = str(application['@_name']);
  }

  for (const [i, entry] of asArray(appdef['element']).entries()) {
    const e = entry as Xml;
    const path = `${basePath}/appdef/element[${i + 1}]`;
    const modeRaw = str(e['@_mode']);
    const mode = (APP_MODES as string[]).includes(modeRaw) ? (modeRaw as AppMode) : 'Win32';
    if (!(APP_MODES as string[]).includes(modeRaw)) {
      warnings.push({ message: `Unknown app element mode "${modeRaw}" — treated as Win32`, path });
    }
    const attributes: ElementAttr[] = (
      isRecord(e['attributes']) ? asArray((e['attributes'] as Xml)['attribute']) : []
    ).map((a) => {
      const attr = a as Xml;
      const matchRaw = str(attr['@_matchtype']).toLowerCase();
      return {
        name: str(attr['@_name']),
        value: str(attr['@_value']),
        matchType: (MATCH_TYPES as readonly string[]).includes(matchRaw)
          ? (matchRaw as ElementAttr['matchType'])
          : 'exact',
        enabled: str(attr['@_enabled']) !== 'false',
      };
    });
    const element: AppElement = {
      id: str(e['@_id']),
      name: str(e['@_name']),
      mode,
      attributes,
      sourceRef: ref(path),
    };
    model.elements.push(element);
  }
  return model;
}

// ---------------------------------------------------------------------------
// Release parsing
// ---------------------------------------------------------------------------

async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function emptyModel(sourceHash: string): AutomationModel {
  return {
    meta: { packageName: '', bpVersion: '', sourceHash },
    processes: [],
    objects: [],
    workQueues: [],
    environmentVars: [],
    credentialsRefs: [],
    dependencies: [],
  };
}

/**
 * Parses a .bprelease (release package) or single-process .xml export into
 * the IR. Never throws: malformed input lands in `errors`, tolerated
 * oddities in `warnings`.
 */
export async function parseBpRelease(xml: string): Promise<ParseResult> {
  const warnings: ParseIssue[] = [];
  const errors: ParseIssue[] = [];
  const sourceHash = await sha256Hex(xml);

  let doc: unknown;
  try {
    doc = xmlParser.parse(xml);
  } catch (cause) {
    errors.push({ message: `XML is not well-formed: ${String(cause)}` });
    return { model: emptyModel(sourceHash), warnings, errors };
  }
  if (!isRecord(doc)) {
    errors.push({ message: 'XML has no recognizable root element' });
    return { model: emptyModel(sourceHash), warnings, errors };
  }

  const model = emptyModel(sourceHash);
  const release = doc['bpr:release'];

  if (isRecord(release)) {
    model.meta.packageName = str(release['bpr:package-name']);
    const exportDate = str(release['bpr:created']);
    if (exportDate !== '') model.meta.exportDate = exportDate;

    const contents = release['bpr:contents'];
    if (!isRecord(contents)) {
      errors.push({ message: 'Release has no <bpr:contents> section', path: '/bpr:release' });
      return { model, warnings, errors };
    }

    for (const [i, wrapper] of asArray(contents['process']).entries()) {
      const w = wrapper as Xml;
      const basePath = `/bpr:release/bpr:contents/process[${i + 1}]/process`;
      const inner = asArray(w['process'])[0];
      if (!isRecord(inner)) {
        errors.push({ message: `Process "${str(w['@_name'])}" has no definition`, path: basePath });
        continue;
      }
      const def = parseDefinition(inner, basePath, warnings);
      const node: ProcessNode = {
        id: str(w['@_id']),
        name: def.name || str(w['@_name']),
        pages: def.pages,
        dataItems: def.dataItems,
        startupParams: def.startupParams,
        outputs: def.outputs,
        sourceRef: ref(basePath),
      };
      if (def.description !== '') node.description = def.description;
      if (model.meta.bpVersion === '') model.meta.bpVersion = def.bpVersion;
      model.processes.push(node);
    }

    for (const [i, wrapper] of asArray(contents['object']).entries()) {
      const w = wrapper as Xml;
      const basePath = `/bpr:release/bpr:contents/object[${i + 1}]/process`;
      const inner = asArray(w['process'])[0];
      if (!isRecord(inner)) {
        errors.push({ message: `Object "${str(w['@_name'])}" has no definition`, path: basePath });
        continue;
      }
      const def = parseDefinition(inner, basePath, warnings);
      const node: BusinessObjectNode = {
        id: str(w['@_id']),
        name: def.name || str(w['@_name']),
        pages: def.pages,
        dataItems: def.dataItems,
        sourceRef: ref(basePath),
      };
      if (def.description !== '') node.description = def.description;
      if (def.appModel) node.appModel = def.appModel;
      if (model.meta.bpVersion === '') model.meta.bpVersion = def.bpVersion;
      model.objects.push(node);
    }

    for (const [i, entry] of asArray(contents['work-queue']).entries()) {
      const e = entry as Xml;
      const path = `/bpr:release/bpr:contents/work-queue[${i + 1}]`;
      const queue: WorkQueueDef = { name: str(e['@_name']), sourceRef: ref(path) };
      if (str(e['@_id']) !== '') queue.id = str(e['@_id']);
      if (str(e['keyfield']) !== '') queue.keyField = str(e['keyfield']);
      const maxAttempts = Number(str(e['maxattempts']));
      if (str(e['maxattempts']) !== '' && Number.isFinite(maxAttempts)) {
        queue.maxAttempts = maxAttempts;
      }
      if (str(e['encrypted']) !== '') queue.encrypted = str(e['encrypted']) === 'true';
      model.workQueues.push(queue);
    }

    for (const [i, entry] of asArray(contents['environment-variable']).entries()) {
      const e = entry as Xml;
      const path = `/bpr:release/bpr:contents/environment-variable[${i + 1}]`;
      const envVar: EnvVarDef = {
        name: str(e['@_name']),
        dataType: mapDataType(str(e['datatype']), warnings, path),
        sourceRef: ref(path),
      };
      if (str(e['value']) !== '') envVar.value = str(e['value']);
      if (str(e['description']) !== '') envVar.description = str(e['description']);
      model.environmentVars.push(envVar);
    }
  } else if (doc['process'] !== undefined) {
    // Bare single-process .xml export
    const inner = asArray(doc['process'])[0];
    if (isRecord(inner)) {
      const basePath = '/process';
      const def = parseDefinition(inner, basePath, warnings);
      const node: ProcessNode = {
        id: str(inner['@_preferredid']) || `process-${def.name || '1'}`,
        name: def.name,
        pages: def.pages,
        dataItems: def.dataItems,
        startupParams: def.startupParams,
        outputs: def.outputs,
        sourceRef: ref(basePath),
      };
      if (def.description !== '') node.description = def.description;
      model.meta.bpVersion = def.bpVersion;
      model.meta.packageName = def.name;
      model.processes.push(node);
    }
  } else {
    errors.push({
      message: 'Not a Blue Prism export: expected <bpr:release> or <process> root',
    });
    return { model, warnings, errors };
  }

  model.dependencies = buildDependencyGraph(model);
  return { model, warnings, errors };
}
