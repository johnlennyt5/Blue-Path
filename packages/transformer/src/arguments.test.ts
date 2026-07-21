import { describe, expect, it } from 'vitest';
import type { AutomationModel, BpDataType, Page, ProcessNode } from '@prismshift/ir';
import { convertProcess } from './convert';
import { IdentifierAllocator, bpTypeToXaml } from './naming';
import { emitWorkflowXaml } from './xaml';

const ref = { path: '/t' };

describe('bpTypeToXaml — full §7.1 type map (S4-4 AC)', () => {
  it.each([
    ['text', 'String'],
    ['password', 'String'],
    ['time', 'String'],
    ['timespan', 'String'],
    ['number', 'Double'],
    ['flag', 'Boolean'],
    ['date', 'DateTime'],
    ['datetime', 'DateTime'],
    ['collection', 'DataTable'],
    ['image', 'Object'],
    ['binary', 'Object'],
  ] as [BpDataType, string][])('%s → %s', (bp, xaml) => {
    expect(bpTypeToXaml(bp)).toBe(xaml);
  });
});

describe('IdentifierAllocator', () => {
  it('dedupes colliding sanitized names deterministically', () => {
    const allocator = new IdentifierAllocator();
    expect(allocator.claim('A_B')).toBe('A_B');
    expect(allocator.claim('A_B')).toBe('A_B_2');
    expect(allocator.claim('A_B')).toBe('A_B_3');
  });
});

// ---------------------------------------------------------------------------
// io_ InOut contract + collision handling on a hand-built process
// ---------------------------------------------------------------------------

function ioModel(): { model: AutomationModel; process: ProcessNode } {
  const subPage: Page = {
    id: 'p-sub',
    name: 'Adjust Total',
    stages: [
      {
        id: 'sub-start', kind: 'start', name: 'Start', sourceRef: ref,
        inputs: [{ paramName: 'Total', storeIn: 'Running Total' }],
      },
      {
        id: 'sub-calc', kind: 'calculation', name: 'Bump',
        expression: { raw: '[Running Total] + 1' }, storeIn: 'Running Total', sourceRef: ref,
      },
      {
        id: 'sub-end', kind: 'end', name: 'End', sourceRef: ref,
        outputs: [{ paramName: 'Total', storeIn: 'Running Total' }],
      },
      { id: 'sub-data', kind: 'data', name: 'Running Total', dataItemId: 'di-sub-total', sourceRef: ref },
    ],
    edges: [
      { from: 'sub-start', to: 'sub-calc', kind: 'flow' },
      { from: 'sub-calc', to: 'sub-end', kind: 'flow' },
    ],
    sourceRef: ref,
  };

  const mainPage: Page = {
    id: 'p-main',
    name: 'Main Page',
    stages: [
      { id: 'm-start', kind: 'start', name: 'Start', sourceRef: ref },
      {
        id: 'm-ref', kind: 'subsheetRef', name: 'Adjust Total',
        targetPageName: 'Adjust Total', targetPageId: 'p-sub',
        inputs: [{ paramName: 'Total', expression: { raw: '[Grand Total]' } }],
        outputs: [{ paramName: 'Total', storeIn: 'Grand Total' }],
        sourceRef: ref,
      },
      { id: 'm-end', kind: 'end', name: 'End', sourceRef: ref },
      // Two data items whose sanitized names collide
      { id: 'm-data1', kind: 'data', name: 'Grand Total', dataItemId: 'di-grand', sourceRef: ref },
      { id: 'm-data2', kind: 'data', name: 'Grand_Total', dataItemId: 'di-grand2', sourceRef: ref },
    ],
    edges: [
      { from: 'm-start', to: 'm-ref', kind: 'flow' },
      { from: 'm-ref', to: 'm-end', kind: 'flow' },
    ],
    sourceRef: ref,
  };

  const process: ProcessNode = {
    id: 'proc-io',
    name: 'IO Demo',
    pages: [mainPage, subPage],
    dataItems: [
      { id: 'di-grand', name: 'Grand Total', dataType: 'number', sourceRef: ref },
      { id: 'di-grand2', name: 'Grand_Total', dataType: 'text', sourceRef: ref },
      { id: 'di-sub-total', name: 'Running Total', dataType: 'number', sourceRef: ref },
    ],
    startupParams: [],
    outputs: [],
    sourceRef: ref,
  };

  const model: AutomationModel = {
    meta: { packageName: 'T', bpVersion: '6', sourceHash: 'a'.repeat(64) },
    processes: [process],
    objects: [],
    workQueues: [],
    environmentVars: [],
    credentialsRefs: [],
    dependencies: [],
  };
  return { model, process };
}

describe('argument signatures (S4-4)', () => {
  it('merges same-item in+out page params into one io_ InOut argument', () => {
    const { model, process } = ioModel();
    const conversion = convertProcess(model, process);

    const subDoc = conversion.workflows.find((w) => w.path === 'Pages/Adjust_Total.xaml')!.doc;
    expect(subDoc.arguments).toEqual([{ name: 'io_Total', direction: 'inout', type: 'Double' }]);

    // The page body reads/writes the argument, not a shadow variable
    const subXaml = emitWorkflowXaml(subDoc);
    expect(subXaml).toContain('[io_Total + 1]');
    expect(subXaml).not.toContain('Running_Total');
  });

  it('caller binds the callee signature exactly (InOutArgument, one binding)', () => {
    const { model, process } = ioModel();
    const conversion = convertProcess(model, process);

    const mainXaml = emitWorkflowXaml(conversion.workflows[0]!.doc);
    expect(mainXaml).toContain(
      '<InOutArgument x:TypeArguments="x:Double" x:Key="io_Total">[Grand_Total]</InOutArgument>',
    );
    // No separate in_/out_ bindings for the merged param
    expect(mainXaml).not.toContain('x:Key="in_Total"');
    expect(mainXaml).not.toContain('x:Key="out_Total"');
    expect(conversion.punchList).toEqual([]);
  });

  it('deduplicates colliding variable names across data items', () => {
    const { model, process } = ioModel();
    const conversion = convertProcess(model, process);
    const main = conversion.workflows[0]!.doc.body;

    if (main.kind !== 'sequence') throw new Error('expected sequence body');
    expect(main.variables?.map((v) => `${v.name}:${v.type}`)).toEqual([
      'Grand_Total:Double',
      'Grand_Total_2:String',
    ]);
  });
});
