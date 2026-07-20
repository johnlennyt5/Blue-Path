/**
 * Intermediate Representation (IR) — a normalized graph model decoupled from
 * both Blue Prism and UiPath. All analysis and transformation operate on it
 * exclusively (ARCHITECTURE §3).
 */

// ---------------------------------------------------------------------------
// Provenance & location
// ---------------------------------------------------------------------------

/**
 * XPath-like pointer into the original .bprelease XML. Every IR node carries
 * one so the UI can show side-by-side provenance and reports can cite exact
 * locations.
 */
export interface SourceRef {
  path: string;
}

/** Path to a node inside the IR, used by findings and reports. */
export interface IrLocation {
  processId?: string;
  objectId?: string;
  pageId?: string;
  stageId?: string;
}

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

/**
 * Blue Prism expression AST. Powers both rules (e.g. detecting password
 * literals) and BP → VB.NET expression translation.
 */
export type ExpressionNode =
  | { type: 'literal'; value: string | number | boolean }
  | { type: 'identifier'; name: string }
  | { type: 'call'; name: string; args: ExpressionNode[] }
  | { type: 'binary'; op: string; left: ExpressionNode; right: ExpressionNode }
  | { type: 'unary'; op: string; operand: ExpressionNode };

/**
 * Expressions are stored both raw (BP expression text) and parsed. `ast` is
 * absent when the expression could not be parsed — never silently wrong.
 */
export interface ExpressionRef {
  raw: string;
  ast?: ExpressionNode;
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

export type BpDataType =
  | 'text'
  | 'number'
  | 'flag'
  | 'date'
  | 'datetime'
  | 'time'
  | 'timespan'
  | 'password'
  | 'image'
  | 'binary'
  | 'collection';

export interface CollectionField {
  name: string;
  dataType: BpDataType;
}

export interface DataItem {
  id: string;
  name: string;
  dataType: BpDataType;
  /** Initial value as written in the source XML, if any. */
  initialValue?: string;
  /** BP exposure setting (environment/session variables surface here). */
  exposure?: 'none' | 'environment' | 'session' | 'statistic';
  /** Field layout when dataType is 'collection'. */
  fields?: CollectionField[];
  sourceRef: SourceRef;
}

export interface Param {
  name: string;
  dataType: BpDataType;
  direction: 'in' | 'out';
  description?: string;
}

/** Binding of a value expression to a named input parameter. */
export interface InputBinding {
  paramName: string;
  expression: ExpressionRef;
}

/** Binding of a named output parameter to the data item that stores it. */
export interface OutputBinding {
  paramName: string;
  storeIn: string;
}

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

export type StageKind = Stage['kind'];

interface StageBase {
  id: string;
  name: string;
  sourceRef: SourceRef;
  /** Diagram coordinates from BP, kept for flow rendering. */
  position?: { x: number; y: number };
}

export interface ActionStage extends StageBase {
  kind: 'action';
  objectName: string;
  actionName: string;
  /**
   * Set by the parser when this action targets BP's internal Work Queues
   * object; the dependency graph then records a process → queue edge instead
   * of an object edge.
   */
  queueName?: string;
  inputs: InputBinding[];
  outputs: OutputBinding[];
}

export interface CalculationStage extends StageBase {
  kind: 'calculation';
  expression: ExpressionRef;
  storeIn: string;
}

export interface MultiCalcStage extends StageBase {
  kind: 'multiCalc';
  steps: { expression: ExpressionRef; storeIn: string }[];
}

export interface DecisionStage extends StageBase {
  kind: 'decision';
  expression: ExpressionRef;
}

export interface ChoiceStage extends StageBase {
  kind: 'choice';
  choices: { name: string; expression: ExpressionRef }[];
}

export interface LoopStartStage extends StageBase {
  kind: 'loopStart';
  /** Collection data item the loop iterates. */
  collectionName: string;
  /** Links this stage to its matching loopEnd. */
  pairId: string;
}

export interface LoopEndStage extends StageBase {
  kind: 'loopEnd';
  pairId: string;
}

export interface DataStage extends StageBase {
  kind: 'data';
  dataItemId: string;
}

export interface CollectionStage extends StageBase {
  kind: 'collection';
  dataItemId: string;
}

export interface ExceptionStage extends StageBase {
  kind: 'exception';
  exceptionType?: string;
  detail?: ExpressionRef;
  /** True when re-throwing ("preserve current exception"). */
  preserve?: boolean;
}

export interface RecoverStage extends StageBase {
  kind: 'recover';
}

export interface ResumeStage extends StageBase {
  kind: 'resume';
}

export interface SubSheetRefStage extends StageBase {
  kind: 'subsheetRef';
  targetPageName: string;
  /** Resolved by the parser when the referenced page is found. */
  targetPageId?: string;
  inputs: InputBinding[];
  outputs: OutputBinding[];
}

export interface ReadStage extends StageBase {
  kind: 'read';
  steps: { elementId: string; action?: string; storeIn: string }[];
}

export interface WriteStage extends StageBase {
  kind: 'write';
  steps: { elementId: string; value: ExpressionRef }[];
}

export interface NavigateStage extends StageBase {
  kind: 'navigate';
  steps: {
    elementId: string;
    action: string;
    params?: { name: string; value: ExpressionRef }[];
  }[];
}

export interface WaitStage extends StageBase {
  kind: 'wait';
  timeoutSeconds?: number;
  conditions: { elementId?: string; condition: string; expected?: ExpressionRef }[];
}

export interface AlertStage extends StageBase {
  kind: 'alert';
  message: ExpressionRef;
}

export interface NoteStage extends StageBase {
  kind: 'note';
  text: string;
}

export interface StartStage extends StageBase {
  kind: 'start';
}

export interface EndStage extends StageBase {
  kind: 'end';
}

export interface CodeStage extends StageBase {
  kind: 'code';
  language: 'csharp' | 'vbnet' | 'jscript';
  body: string;
  inputs: Param[];
  outputs: Param[];
}

export interface AnchorStage extends StageBase {
  kind: 'anchor';
}

/**
 * Fallback for stage types the parser does not recognize. The raw payload is
 * preserved and a warning emitted — never dropped silently (ARCHITECTURE §4).
 */
export interface GenericStage extends StageBase {
  kind: 'generic';
  rawType: string;
  raw?: unknown;
}

export type Stage =
  | ActionStage
  | CalculationStage
  | MultiCalcStage
  | DecisionStage
  | ChoiceStage
  | LoopStartStage
  | LoopEndStage
  | DataStage
  | CollectionStage
  | ExceptionStage
  | RecoverStage
  | ResumeStage
  | SubSheetRefStage
  | ReadStage
  | WriteStage
  | NavigateStage
  | WaitStage
  | AlertStage
  | NoteStage
  | StartStage
  | EndStage
  | CodeStage
  | AnchorStage
  | GenericStage;

// ---------------------------------------------------------------------------
// Control flow
// ---------------------------------------------------------------------------

export type StageEdgeKind = 'flow' | 'true' | 'false' | 'choice' | 'exception';

/** Directed control-flow link between two stages on the same page. */
export interface StageEdge {
  from: string;
  to: string;
  kind: StageEdgeKind;
  /** Choice name for 'choice' edges. */
  label?: string;
  sourceRef?: SourceRef;
}

export interface Page {
  id: string;
  name: string;
  description?: string;
  stages: Stage[];
  edges: StageEdge[];
  sourceRef: SourceRef;
}

// ---------------------------------------------------------------------------
// Processes & business objects
// ---------------------------------------------------------------------------

export interface ProcessNode {
  id: string;
  name: string;
  description?: string;
  /** Main page first, then subsheets. */
  pages: Page[];
  dataItems: DataItem[];
  startupParams: Param[];
  outputs: Param[];
  sourceRef: SourceRef;
}

export type AppMode = 'Win32' | 'HTML' | 'Java' | 'UIA' | 'SAP' | 'Citrix' | 'Region';

export interface ElementAttr {
  name: string;
  value: string;
  matchType: 'exact' | 'wildcard' | 'regex' | 'index' | 'dynamic';
  enabled: boolean;
}

/** Element captured in BP's Application Modeller. */
export interface AppElement {
  id: string;
  name: string;
  mode: AppMode;
  parentId?: string;
  attributes: ElementAttr[];
  sourceRef?: SourceRef;
}

export interface AppModel {
  applicationName?: string;
  elements: AppElement[];
}

/** Visual Business Object: action pages + the application model they drive. */
export interface BusinessObjectNode {
  id: string;
  name: string;
  description?: string;
  pages: Page[];
  dataItems: DataItem[];
  appModel?: AppModel;
  sourceRef: SourceRef;
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

export interface WorkQueueDef {
  id?: string;
  name: string;
  keyField?: string;
  maxAttempts?: number;
  encrypted?: boolean;
  sourceRef: SourceRef;
}

export interface EnvVarDef {
  name: string;
  dataType: BpDataType;
  value?: string;
  description?: string;
  sourceRef: SourceRef;
}

export interface CredentialRef {
  name: string;
  sourceRef: SourceRef;
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export type DependencyNodeType =
  | 'process'
  | 'object'
  | 'application'
  | 'queue'
  | 'credential'
  | 'envVar';

/**
 * Program-level dependency edge (process → object, object → application,
 * process → queue, …). Field names mirror the Workspace Mode
 * dependency_edges table (ARCHITECTURE §8.1).
 */
export interface DependencyEdge {
  fromType: DependencyNodeType;
  fromName: string;
  toType: DependencyNodeType;
  toName: string;
}

// ---------------------------------------------------------------------------
// Release & model root
// ---------------------------------------------------------------------------

export interface ReleaseMeta {
  packageName: string;
  bpVersion: string;
  exportDate?: string;
  /** SHA-256 of the source XML — audit trail + Workspace Mode dedup. */
  sourceHash: string;
}

export interface AutomationModel {
  meta: ReleaseMeta;
  processes: ProcessNode[];
  objects: BusinessObjectNode[];
  workQueues: WorkQueueDef[];
  environmentVars: EnvVarDef[];
  credentialsRefs: CredentialRef[];
  dependencies: DependencyEdge[];
}

// ---------------------------------------------------------------------------
// Findings (produced by @prismshift/rules, typed here so reports and corpus
// answer keys can share them without depending on the rules engine)
// ---------------------------------------------------------------------------

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type FindingCategory =
  | 'security'
  | 'reliability'
  | 'maintainability'
  | 'compliance'
  | 'performance';

export interface Finding {
  /** e.g. "SEC-001" */
  ruleId: string;
  severity: FindingSeverity;
  category: FindingCategory;
  location: IrLocation;
  message: string;
  /** UiPath-oriented fix guidance. */
  remediation: string;
  /** 0–1 */
  confidence: number;
}
