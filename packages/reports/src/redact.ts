/**
 * AI digest redaction (S7-1, ARCHITECTURE §6/§13): THE single auditable
 * module that decides what an LLM may ever see.
 *
 * The contract: **names, types, and structure only — never values.**
 * Concretely, the digest excludes:
 *   - data-item initial values (the headline guarantee)
 *   - raw expression text (literals inside expressions are values)
 *   - App Modeller attribute values (window titles, ids, paths)
 *   - descriptions and any other free text authored inside the source
 *
 * Expressions contribute only the `[Data Item]` names they reference.
 * `assertNoValuesSurvive` re-checks the finished digest against every value
 * in the model at runtime — buildAiDigest refuses to return a digest that
 * leaks, independent of how this file evolves.
 */
import type {
  AutomationModel,
  BusinessObjectNode,
  DataItem,
  Page,
  ProcessNode,
} from '@prismshift/ir';

export interface DigestDataItem {
  name: string;
  type: string;
  exposure?: string;
  /** Collection field names/types (names are structure, not values). */
  fields?: { name: string; type: string }[];
}

export interface DigestStage {
  name: string;
  kind: string;
  /** For action stages: the object/action called (names). */
  object?: string;
  action?: string;
  /** Data-item names referenced by this stage's expressions. */
  refs?: string[];
}

export interface DigestPage {
  name: string;
  stages: DigestStage[];
}

export interface DigestOwner {
  name: string;
  role: 'process' | 'object';
  pages: DigestPage[];
  dataItems: DigestDataItem[];
  inputs?: { name: string; type: string }[];
  outputs?: { name: string; type: string }[];
  /** Objects only: application elements (names + mode, no attributes). */
  appElements?: { name: string; mode: string }[];
}

export interface AiDigest {
  package?: string;
  owners: DigestOwner[];
  queues: string[];
  credentials: string[];
}

// ---------------------------------------------------------------------------
// Reference extraction — the ONLY thing taken from expressions
// ---------------------------------------------------------------------------

const REF_PATTERN = /\[([^\][]+)\]/g;

/** `[Data Item]` names referenced in an expression; the raw text never leaves. */
export function extractRefs(raw: string): string[] {
  const refs = new Set<string>();
  for (const match of raw.matchAll(REF_PATTERN)) {
    refs.add(match[1]!.trim());
  }
  return [...refs].sort();
}

/** Collect every `{ raw: … }` expression string nested in a stage. */
function collectRaws(value: unknown, out: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectRaws(item, out);
    return;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record['raw'] === 'string') {
      out.push(record['raw']);
      return; // an ExpressionRef — do not descend into its AST
    }
    for (const child of Object.values(record)) collectRaws(child, out);
  }
}

// ---------------------------------------------------------------------------
// Digest building
// ---------------------------------------------------------------------------

function digestDataItem(item: DataItem): DigestDataItem {
  return {
    name: item.name,
    type: item.dataType,
    ...(item.exposure !== undefined && item.exposure !== 'none'
      ? { exposure: item.exposure }
      : {}),
    ...(item.fields !== undefined
      ? { fields: item.fields.map((f) => ({ name: f.name, type: f.dataType })) }
      : {}),
  };
}

function digestPage(page: Page): DigestPage {
  return {
    name: page.name,
    stages: page.stages.map((stage) => {
      const raws: string[] = [];
      collectRaws(stage, raws);
      const refs = [...new Set(raws.flatMap(extractRefs))].sort();
      const record = stage as unknown as Record<string, unknown>;
      return {
        name: stage.name,
        kind: stage.kind,
        ...(typeof record['objectName'] === 'string'
          ? { object: record['objectName'] as string }
          : {}),
        ...(typeof record['actionName'] === 'string'
          ? { action: record['actionName'] as string }
          : {}),
        ...(refs.length > 0 ? { refs } : {}),
      };
    }),
  };
}

function digestProcess(process: ProcessNode): DigestOwner {
  return {
    name: process.name,
    role: 'process',
    pages: process.pages.map(digestPage),
    dataItems: process.dataItems.map(digestDataItem),
    inputs: process.startupParams.map((p) => ({ name: p.name, type: p.dataType })),
    outputs: process.outputs.map((p) => ({ name: p.name, type: p.dataType })),
  };
}

function digestObject(object: BusinessObjectNode): DigestOwner {
  return {
    name: object.name,
    role: 'object',
    pages: object.pages.map(digestPage),
    dataItems: object.dataItems.map(digestDataItem),
    ...(object.appModel !== undefined
      ? {
          appElements: object.appModel.elements.map((e) => ({
            name: e.name,
            mode: e.mode,
          })),
        }
      : {}),
  };
}

/**
 * Build the redacted digest for the whole model (or one owner via `ownerId`).
 * Always ends by proving to itself that no value survived.
 */
export function buildAiDigest(model: AutomationModel, ownerId?: string): AiDigest {
  const processes = model.processes.filter((p) => ownerId === undefined || p.id === ownerId);
  const objects = model.objects.filter((o) => ownerId === undefined || o.id === ownerId);

  const digest: AiDigest = {
    ...(model.meta.packageName !== undefined && model.meta.packageName !== ''
      ? { package: model.meta.packageName }
      : {}),
    owners: [...processes.map(digestProcess), ...objects.map(digestObject)],
    queues: model.workQueues.map((q) => q.name).sort(),
    credentials: model.credentialsRefs.map((c) => c.name).sort(),
  };

  assertNoValuesSurvive(digest, model);
  return digest;
}

// ---------------------------------------------------------------------------
// The runtime guarantee
// ---------------------------------------------------------------------------

/**
 * Guard thresholds. Data-item values are the headline guarantee — guarded
 * from 4 chars. Selector attribute values guard from 8: below that they are
 * structural tokens (tag='INPUT', mode names) that collide with the digest's
 * own vocabulary, not data.
 */
const MIN_DATA_VALUE_LENGTH = 4;
const MIN_ATTR_VALUE_LENGTH = 8;

function collectForbiddenValues(model: AutomationModel): string[] {
  const values: string[] = [];
  for (const owner of [...model.processes, ...model.objects]) {
    for (const item of owner.dataItems) {
      if (
        item.initialValue !== undefined &&
        item.initialValue.trim().length >= MIN_DATA_VALUE_LENGTH
      ) {
        values.push(item.initialValue);
      }
    }
    if ('appModel' in owner && owner.appModel !== undefined) {
      for (const element of owner.appModel.elements) {
        for (const attr of element.attributes) {
          if (attr.value.trim().length >= MIN_ATTR_VALUE_LENGTH) values.push(attr.value);
        }
      }
    }
  }
  return values;
}

/**
 * Throws if any data-item initial value or App Modeller attribute value
 * appears anywhere in the serialized digest.
 */
export function assertNoValuesSurvive(digest: AiDigest, model: AutomationModel): void {
  const serialized = JSON.stringify(digest).toLowerCase();
  for (const value of collectForbiddenValues(model)) {
    if (serialized.includes(JSON.stringify(value).slice(1, -1).toLowerCase())) {
      throw new Error(
        `redaction violation: a source value (${value.length} chars) survived into the AI digest — refusing to build`,
      );
    }
  }
}
