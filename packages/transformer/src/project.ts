/**
 * UiPath project emitter (S4-2, ARCHITECTURE §7.3): project.json + folder
 * layout, with the plain-vs-REFramework decision.
 *
 * Target: UiPath Studio 2023.10+, Windows (.NET 6), VB expressions.
 *
 * v1 honesty note: the REFramework layout here is a sequence-based
 * transaction skeleton (Main → Framework/*.xaml) — the full queue-wired
 * transaction logic lands in S5-2/S5-3, and Config.xlsx is deliberately
 * left to the migration report (binary artifacts are not emitted).
 */
import { emitWorkflowXaml } from './xaml';
import type { WorkflowDoc, XActivity } from './xaml';

export interface ProjectFile {
  path: string;
  content: string;
}

export interface UiPathProject {
  name: string;
  layout: 'plain' | 'reframework';
  files: ProjectFile[];
}

// ---------------------------------------------------------------------------
// Layout decision (threshold configurable — ARCHITECTURE §7.1)
// ---------------------------------------------------------------------------

export interface LayoutDecisionInput {
  stageCount: number;
  usesQueues: boolean;
}

export interface LayoutConfig {
  /** Processes at or above this stage count get REFramework. Default 60. */
  reframeworkStageThreshold?: number;
}

export function decideProjectLayout(
  input: LayoutDecisionInput,
  config: LayoutConfig = {},
): 'plain' | 'reframework' {
  const threshold = config.reframeworkStageThreshold ?? 60;
  if (input.usesQueues) return 'reframework';
  return input.stageCount >= threshold ? 'reframework' : 'plain';
}

// ---------------------------------------------------------------------------
// Deterministic project ids (no randomness anywhere in the pipeline)
// ---------------------------------------------------------------------------

/** FNV-1a over the seed with per-segment salts, shaped like a UUID v4. */
export function deterministicGuid(seed: string): string {
  const fnv = (input: string): number => {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
  };
  const hex = (salt: string): string => fnv(`${salt}:${seed}`).toString(16).padStart(8, '0');
  const h = `${hex('a')}${hex('b')}${hex('c')}${hex('d')}`;
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// ---------------------------------------------------------------------------
// project.json
// ---------------------------------------------------------------------------

const DEPENDENCIES: Record<string, string> = {
  'UiPath.System.Activities': '[26.6.1]',
  'UiPath.UIAutomation.Activities': '[26.10.0]',
};

export function buildProjectJson(options: {
  name: string;
  description: string;
  mainFile: string;
  /** 'Library' emits a publishable library (BL-008); default 'Process'. */
  outputType?: 'Process' | 'Library';
  /** Additional project.json dependencies (e.g. exported object libraries). */
  extraDependencies?: Record<string, string>;
  /** Entry points; defaults to [mainFile]. Libraries list every workflow. */
  entryPointFiles?: string[];
}): string {
  const projectJson = {
    name: options.name,
    projectId: deterministicGuid(options.name),
    description: options.description,
    main: options.mainFile,
    dependencies: { ...DEPENDENCIES, ...(options.extraDependencies ?? {}) },
    webServices: [],
    entitiesStores: [],
    schemaVersion: '4.0',
    studioVersion: '26.0.197.0',
    projectVersion: '1.0.0',
    runtimeOptions: {
      autoDispose: false,
      netFrameworkLazyLoading: false,
      isPausable: true,
      requiresUserInteraction: true,
      supportsPersistence: false,
      workflowSerialization: 'DataContract',
      excludedLoggedData: ['Private:*', '*password*'],
      executionType: 'Workflow',
      readyForPiP: false,
      startsInPiP: false,
      mustRestoreAllDependencies: false,
      pipType: 'ChildSession',
    },
    designOptions: {
      projectProfile: 'Development',
      outputType: options.outputType ?? 'Process',
      libraryOptions: {
        includeOriginalXaml: false,
        privateWorkflows: [],
      },
      processOptions: { ignoredFiles: [] },
      fileInfoCollection: [],
      saveToCloud: false,
    },
    expressionLanguage: 'VisualBasic',
    entryPoints: (options.entryPointFiles ?? [options.mainFile]).map((filePath) => ({
      filePath,
      uniqueId: deterministicGuid(`${options.name}/${filePath}`),
      input: [],
      output: [],
    })),
    isTemplate: false,
    templateProjectData: {},
    publishData: {},
    targetFramework: 'Windows',
  };
  return `${JSON.stringify(projectJson, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// REFramework scaffold (sequence-based v1)
// ---------------------------------------------------------------------------

function reframeworkFiles(queueName?: string): { path: string; doc: WorkflowDoc }[] {
  const itemType = queueName !== undefined ? ('QueueItem' as const) : ('Object' as const);
  return [
    {
      path: 'Framework/InitAllSettings.xaml',
      doc: {
        className: 'InitAllSettings',
        arguments: [{ name: 'out_Config', direction: 'out', type: 'Object' }],
        body: {
          kind: 'sequence',
          displayName: 'Init All Settings',
          activities: [
            {
              kind: 'comment',
              text: 'PrismShift scaffold: load configuration/assets here (BP environment variables map to Orchestrator assets — see AssetsManifest.json).',
            },
          ],
        },
      },
    },
    {
      path: 'Framework/GetTransactionData.xaml',
      doc: {
        className: 'GetTransactionData',
        arguments: [
          { name: 'in_TransactionNumber', direction: 'in', type: 'Int32' },
          { name: 'out_TransactionItem', direction: 'out', type: itemType },
        ],
        body: {
          kind: 'sequence',
          displayName: 'Get Transaction Data',
          activities:
            queueName !== undefined
              ? [
                  {
                    kind: 'getTransactionItem',
                    displayName: `Get next item from "${queueName}"`,
                    queueName,
                    storeIn: 'out_TransactionItem',
                  },
                ]
              : [
                  {
                    kind: 'comment',
                    text: 'PrismShift scaffold: fetch the next work item (no work queue detected in the source process).',
                  },
                ],
        },
      },
    },
    {
      path: 'Framework/SetTransactionStatus.xaml',
      doc: {
        className: 'SetTransactionStatus',
        arguments: [
          { name: 'in_TransactionItem', direction: 'in', type: itemType },
          { name: 'in_Status', direction: 'in', type: 'String' },
        ],
        body: {
          kind: 'sequence',
          displayName: 'Set Transaction Status',
          activities:
            queueName !== undefined
              ? [
                  {
                    kind: 'if',
                    displayName: 'Success?',
                    condition: 'in_Status = "Success"',
                    then: {
                      kind: 'setTransactionStatus',
                      displayName: 'Mark Successful',
                      status: 'Successful',
                      transactionItem: 'in_TransactionItem',
                    },
                    else: {
                      kind: 'setTransactionStatus',
                      displayName: 'Mark Failed',
                      status: 'Failed',
                      errorType: 'Application',
                      reason: '"Marked by framework: " & in_Status',
                      transactionItem: 'in_TransactionItem',
                    },
                  },
                ]
              : [
                  {
                    kind: 'comment',
                    text: 'PrismShift scaffold: mark the work item Completed/Failed (no work queue detected in the source process).',
                  },
                ],
        },
      },
    },
  ];
}

function reframeworkMain(processFile: string, queueName?: string): WorkflowDoc {
  const itemType = queueName !== undefined ? ('QueueItem' as const) : ('Object' as const);
  const transactionLoop: XActivity = {
    kind: 'tryCatch',
    displayName: 'Transaction Guard',
    tryBody: {
      kind: 'sequence',
      displayName: 'Process Transaction',
      activities: [
        {
          kind: 'invokeWorkflow',
          displayName: 'Get Transaction Data',
          workflowFile: 'Framework\\GetTransactionData.xaml',
          arguments: [
            { name: 'in_TransactionNumber', direction: 'in', type: 'Int32', expression: 'TransactionNumber' },
            { name: 'out_TransactionItem', direction: 'out', type: itemType, expression: 'TransactionItem' },
          ],
        },
        {
          kind: 'invokeWorkflow',
          displayName: 'Process',
          workflowFile: processFile.replaceAll('/', '\\'),
          arguments: [],
        },
        {
          kind: 'invokeWorkflow',
          displayName: 'Mark Completed',
          workflowFile: 'Framework\\SetTransactionStatus.xaml',
          arguments: [
            { name: 'in_TransactionItem', direction: 'in', type: itemType, expression: 'TransactionItem' },
            { name: 'in_Status', direction: 'in', type: 'String', expression: '"Success"' },
          ],
        },
      ],
    },
    catches: [
      {
        exceptionType: 'BusinessRuleException',
        body: {
          kind: 'invokeWorkflow',
          displayName: 'Mark Business Exception',
          workflowFile: 'Framework\\SetTransactionStatus.xaml',
          arguments: [
            { name: 'in_TransactionItem', direction: 'in', type: itemType, expression: 'TransactionItem' },
            { name: 'in_Status', direction: 'in', type: 'String', expression: '"BusinessException"' },
          ],
        },
      },
      {
        exceptionType: 'Exception',
        body: {
          kind: 'invokeWorkflow',
          displayName: 'Mark System Exception',
          workflowFile: 'Framework\\SetTransactionStatus.xaml',
          arguments: [
            { name: 'in_TransactionItem', direction: 'in', type: itemType, expression: 'TransactionItem' },
            { name: 'in_Status', direction: 'in', type: 'String', expression: '"SystemException"' },
          ],
        },
      },
    ],
  };

  return {
    className: 'Main',
    arguments: [],
    body: {
      kind: 'sequence',
      displayName: 'REFramework Main (PrismShift scaffold)',
      variables: [
        { name: 'Config', type: 'Object' },
        { name: 'TransactionItem', type: itemType },
        { name: 'TransactionNumber', type: 'Int32', defaultExpression: '1' },
      ],
      activities: [
        {
          kind: 'invokeWorkflow',
          displayName: 'Init All Settings',
          workflowFile: 'Framework\\InitAllSettings.xaml',
          arguments: [{ name: 'out_Config', direction: 'out', type: 'Object', expression: 'Config' }],
        },
        transactionLoop,
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Project assembly
// ---------------------------------------------------------------------------

export interface BuildProjectOptions {
  name: string;
  description?: string;
  layout: 'plain' | 'reframework';
  /** Wires REFramework scaffolds with real queue activities. */
  queueName?: string;
  /** The process workflows: first entry is the process entry point. */
  workflows: { path: string; doc: WorkflowDoc }[];
}

export function buildProject(options: BuildProjectOptions): UiPathProject {
  const files: ProjectFile[] = [];
  const description =
    options.description ?? `Converted from Blue Prism by PrismShift (${options.name}).`;

  if (options.layout === 'plain') {
    files.push({
      path: 'project.json',
      content: buildProjectJson({
        name: options.name,
        description,
        mainFile: options.workflows[0]?.path ?? 'Main.xaml',
      }),
    });
    for (const workflow of options.workflows) {
      files.push({ path: workflow.path, content: emitWorkflowXaml(workflow.doc) });
    }
    return { name: options.name, layout: 'plain', files };
  }

  // REFramework: Main.xaml orchestrates; the converted process becomes
  // the Process workflow invoked inside the transaction guard.
  const processEntry = options.workflows[0]?.path ?? 'Process.xaml';
  files.push({
    path: 'project.json',
    content: buildProjectJson({ name: options.name, description, mainFile: 'Main.xaml' }),
  });
  files.push({
    path: 'Main.xaml',
    content: emitWorkflowXaml(reframeworkMain(processEntry, options.queueName)),
  });
  for (const scaffold of reframeworkFiles(options.queueName)) {
    files.push({ path: scaffold.path, content: emitWorkflowXaml(scaffold.doc) });
  }
  for (const workflow of options.workflows) {
    files.push({ path: workflow.path, content: emitWorkflowXaml(workflow.doc) });
  }
  return { name: options.name, layout: 'reframework', files };
}

// ---------------------------------------------------------------------------
// Library projects (BL-008): a VBO exported as a publishable UiPath library.
// Workflows live at the project root — Studio compiles each public root
// workflow into an activity when the library is published.
// ---------------------------------------------------------------------------

export interface BuildLibraryOptions {
  name: string;
  description?: string;
  workflows: { path: string; doc: WorkflowDoc }[];
}

export function buildLibraryProject(options: BuildLibraryOptions): UiPathProject {
  const files: ProjectFile[] = [];
  // Objects/<Object>/<Page>.xaml → <Page>.xaml (root = public activity)
  const rootWorkflows = options.workflows.map((workflow) => ({
    path: workflow.path.split('/').pop()!,
    doc: workflow.doc,
  }));
  files.push({
    path: 'project.json',
    content: buildProjectJson({
      name: options.name,
      description:
        options.description ??
        `Converted from Blue Prism VBO "${options.name}" by PrismShift — publish to a feed and reference from consuming processes.`,
      mainFile: rootWorkflows[0]?.path ?? 'Main.xaml',
      outputType: 'Library',
      entryPointFiles: rootWorkflows.map((w) => w.path),
    }),
  });
  for (const workflow of rootWorkflows) {
    files.push({ path: workflow.path, content: emitWorkflowXaml(workflow.doc) });
  }
  return { name: options.name, layout: 'plain', files };
}
