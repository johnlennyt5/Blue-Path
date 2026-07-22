/**
 * BL-006 · Test-harness generation: per process, two UiPath test-case stubs —
 * a happy path and an exception path — with arguments wired from the
 * process signature and assertion placeholders.
 *
 * Deliberately built from activities this project has already verified in
 * Studio (Sequence/Invoke/TryCatch/Throw/WriteLine): the stubs load with
 * zero new activity shapes. Replace the placeholder assertions with
 * UiPath.Testing Verify* activities once the Testing package is installed
 * (dependency is pre-declared in project.json).
 */
import type { WorkflowDoc, XamlArgument, XamlType, XamlVariable, XActivity } from './xaml';
import type { InvokeArgumentBinding } from './xaml';
import { sanitizeFileName, sanitizeIdentifier } from './naming';

const DEFAULT_FOR: Record<XamlType, string> = {
  String: '"TODO test input"',
  Double: '0',
  Int32: '0',
  Boolean: 'False',
  DateTime: 'DateTime.Now',
  Object: 'Nothing',
  DataTable: 'New System.Data.DataTable()',
  QueueItem: 'Nothing',
};

export interface TestCaseFile {
  path: string;
  doc: WorkflowDoc;
}

function variablesFor(args: XamlArgument[]): XamlVariable[] {
  return args.map((arg) => ({
    name: `tc_${sanitizeIdentifier(arg.name)}`,
    type: arg.type,
    ...(arg.direction !== 'out' ? { defaultExpression: DEFAULT_FOR[arg.type] } : {}),
  }));
}

function bindingsFor(args: XamlArgument[]): InvokeArgumentBinding[] {
  return args.map((arg) => ({
    name: arg.name,
    direction: arg.direction,
    type: arg.type,
    expression: `tc_${sanitizeIdentifier(arg.name)}`,
  }));
}

function givenSection(args: XamlArgument[]): XActivity {
  const inputs = args.filter((a) => a.direction !== 'out');
  return {
    kind: 'sequence',
    displayName: 'Given — arrange test inputs',
    activities: [
      {
        kind: 'comment',
        text:
          inputs.length === 0
            ? 'PrismShift TODO: this process takes no inputs — arrange any required application/queue state here.'
            : `PrismShift TODO: replace the placeholder defaults for ${inputs
                .map((a) => a.name)
                .join(', ')} with real test data (see the tc_* variable defaults).`,
      },
    ],
  };
}

function whenSection(mainFile: string, args: XamlArgument[]): XActivity {
  return {
    kind: 'sequence',
    displayName: 'When — run the process',
    activities: [
      {
        kind: 'invokeWorkflow',
        displayName: 'Invoke process under test',
        workflowFile: mainFile,
        arguments: bindingsFor(args),
      },
    ],
  };
}

function thenPlaceholder(outArg: XamlArgument): XActivity {
  const variable = `tc_${sanitizeIdentifier(outArg.name)}`;
  return {
    kind: 'if',
    displayName: `Assert ${outArg.name}`,
    // Placeholder condition: always-true until the tester writes the real one.
    condition: `True ' TODO: assert on ${variable}`,
    then: {
      kind: 'writeLine',
      displayName: `${outArg.name} OK`,
      text: `"PASS: ${outArg.name} = " & ${variable}.ToString()`,
    },
    else: {
      kind: 'throw',
      exception: 'Exception',
      message: `"Assertion failed for ${outArg.name}"`,
    },
  };
}

export function buildTestCases(options: {
  processName: string;
  /** The workflow the tests invoke (the process entry point). */
  mainFile: string;
  arguments: XamlArgument[];
}): TestCaseFile[] {
  const safeName = sanitizeFileName(options.processName);
  const variables = variablesFor(options.arguments);
  const outs = options.arguments.filter((a) => a.direction !== 'in');

  const happy: WorkflowDoc = {
    className: `${sanitizeIdentifier(options.processName)}_HappyPath`,
    arguments: [],
    body: {
      kind: 'sequence',
      displayName: `${options.processName} — happy path`,
      variables,
      activities: [
        {
          kind: 'comment',
          text: `PrismShift test stub (BL-006): happy path for "${options.processName}". Given/When/Then below — fill the TODOs, then swap the placeholder assertions for UiPath.Testing Verify* activities.`,
        },
        givenSection(options.arguments),
        whenSection(options.mainFile, options.arguments),
        {
          kind: 'sequence',
          displayName: 'Then — assert outcomes',
          activities:
            outs.length === 0
              ? [
                  {
                    kind: 'comment',
                    text: 'PrismShift TODO: this process declares no outputs — assert on application/queue state instead.',
                  },
                ]
              : outs.map(thenPlaceholder),
        },
      ],
    },
  };

  const exception: WorkflowDoc = {
    className: `${sanitizeIdentifier(options.processName)}_ExceptionPath`,
    arguments: [],
    body: {
      kind: 'sequence',
      displayName: `${options.processName} — exception path`,
      variables,
      activities: [
        {
          kind: 'comment',
          text: `PrismShift test stub (BL-006): exception path for "${options.processName}". Arrange inputs that must make the process throw, then run — the test fails if no exception surfaces.`,
        },
        givenSection(options.arguments),
        {
          kind: 'tryCatch',
          displayName: 'When — expect a failure',
          tryBody: {
            kind: 'sequence',
            activities: [
              whenSection(options.mainFile, options.arguments),
              {
                kind: 'throw',
                exception: 'Exception',
                message: '"Expected the process to throw, but it completed normally"',
              },
            ],
          },
          catches: [
            {
              exceptionType: 'BusinessRuleException',
              body: {
                kind: 'writeLine',
                displayName: 'Expected failure observed',
                text: '"PASS: process rejected the invalid input as expected"',
              },
            },
          ],
        },
      ],
    },
  };

  return [
    { path: `Tests/${safeName}_HappyPath.xaml`, doc: happy },
    { path: `Tests/${safeName}_ExceptionPath.xaml`, doc: exception },
  ];
}
