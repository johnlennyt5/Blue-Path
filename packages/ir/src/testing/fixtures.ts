import type {
  AutomationModel,
  Page,
  SourceRef,
  Stage,
  StageEdge,
} from '../types';

const ref = (path: string): SourceRef => ({ path });

const expr = (raw: string) => ({ raw });

/**
 * In-memory sample model used by IR unit tests: one queue-driven process
 * ("Invoice Loader") with a subsheet and an exception path, plus one VBO
 * ("Invoice VBO") attached to SAP GUI.
 */
export function buildSampleModel(): AutomationModel {
  const mainStages: Stage[] = [
    { id: 's1', kind: 'start', name: 'Start', sourceRef: ref('/process[1]/stage[1]') },
    {
      id: 's2',
      kind: 'action',
      name: 'Get Next Item',
      objectName: 'Internal - Work Queues',
      actionName: 'Get Next Item',
      queueName: 'Invoices Queue',
      inputs: [{ paramName: 'Queue Name', expression: expr('"Invoices Queue"') }],
      outputs: [{ paramName: 'Item ID', storeIn: 'Item ID' }],
      sourceRef: ref('/process[1]/stage[2]'),
    },
    {
      id: 's3',
      kind: 'calculation',
      name: 'Compute Total',
      expression: expr('[Net] + [Tax]'),
      storeIn: 'Total',
      sourceRef: ref('/process[1]/stage[3]'),
    },
    {
      id: 's4',
      kind: 'decision',
      name: 'Has Item?',
      expression: expr('[Item ID] <> ""'),
      sourceRef: ref('/process[1]/stage[4]'),
    },
    {
      id: 's5',
      kind: 'subsheetRef',
      name: 'Handle Item',
      targetPageName: 'Handle Item',
      targetPageId: 'page-handle',
      inputs: [],
      outputs: [],
      sourceRef: ref('/process[1]/stage[5]'),
    },
    { id: 's6', kind: 'end', name: 'End', sourceRef: ref('/process[1]/stage[6]') },
  ];

  const mainEdges: StageEdge[] = [
    { from: 's1', to: 's2', kind: 'flow' },
    { from: 's2', to: 's3', kind: 'flow' },
    { from: 's3', to: 's4', kind: 'flow' },
    { from: 's4', to: 's5', kind: 'true' },
    { from: 's4', to: 's6', kind: 'false' },
    { from: 's5', to: 's6', kind: 'flow' },
  ];

  const handleStages: Stage[] = [
    { id: 'h1', kind: 'start', name: 'Start', sourceRef: ref('/process[1]/subsheet[1]/stage[1]') },
    {
      id: 'h2',
      kind: 'action',
      name: 'Enter Invoice',
      objectName: 'Invoice VBO',
      actionName: 'Enter Invoice',
      inputs: [{ paramName: 'Invoice ID', expression: expr('[Item ID]') }],
      outputs: [],
      sourceRef: ref('/process[1]/subsheet[1]/stage[2]'),
    },
    { id: 'h3', kind: 'recover', name: 'Recover', sourceRef: ref('/process[1]/subsheet[1]/stage[3]') },
    { id: 'h4', kind: 'resume', name: 'Resume', sourceRef: ref('/process[1]/subsheet[1]/stage[4]') },
    { id: 'h5', kind: 'end', name: 'End', sourceRef: ref('/process[1]/subsheet[1]/stage[5]') },
  ];

  const handleEdges: StageEdge[] = [
    { from: 'h1', to: 'h2', kind: 'flow' },
    { from: 'h2', to: 'h5', kind: 'flow' },
    { from: 'h2', to: 'h3', kind: 'exception' },
    { from: 'h3', to: 'h4', kind: 'flow' },
    { from: 'h4', to: 'h5', kind: 'flow' },
  ];

  const mainPage: Page = {
    id: 'page-main',
    name: 'Main Page',
    stages: mainStages,
    edges: mainEdges,
    sourceRef: ref('/process[1]/page[1]'),
  };

  const handlePage: Page = {
    id: 'page-handle',
    name: 'Handle Item',
    stages: handleStages,
    edges: handleEdges,
    sourceRef: ref('/process[1]/subsheet[1]'),
  };

  const enterInvoicePage: Page = {
    id: 'obj-page-enter',
    name: 'Enter Invoice',
    stages: [
      { id: 'o1', kind: 'start', name: 'Start', sourceRef: ref('/object[1]/page[1]/stage[1]') },
      {
        id: 'o2',
        kind: 'write',
        name: 'Write Invoice ID',
        steps: [{ elementId: 'el-invoice-field', value: expr('[Invoice ID]') }],
        sourceRef: ref('/object[1]/page[1]/stage[2]'),
      },
      { id: 'o3', kind: 'end', name: 'End', sourceRef: ref('/object[1]/page[1]/stage[3]') },
    ],
    edges: [
      { from: 'o1', to: 'o2', kind: 'flow' },
      { from: 'o2', to: 'o3', kind: 'flow' },
    ],
    sourceRef: ref('/object[1]/page[1]'),
  };

  return {
    meta: {
      packageName: 'IR Fixture Release',
      bpVersion: '6.10.1',
      sourceHash: 'f'.repeat(64),
    },
    processes: [
      {
        id: 'proc-invoice-loader',
        name: 'Invoice Loader',
        description: 'Loads invoices from the work queue into SAP.',
        pages: [mainPage, handlePage],
        dataItems: [
          {
            id: 'di-item-id',
            name: 'Item ID',
            dataType: 'text',
            sourceRef: ref('/process[1]/data[1]'),
          },
          {
            id: 'di-total',
            name: 'Total',
            dataType: 'number',
            sourceRef: ref('/process[1]/data[2]'),
          },
        ],
        startupParams: [{ name: 'Environment', dataType: 'text', direction: 'in' }],
        outputs: [{ name: 'Processed Count', dataType: 'number', direction: 'out' }],
        sourceRef: ref('/process[1]'),
      },
    ],
    objects: [
      {
        id: 'obj-invoice-vbo',
        name: 'Invoice VBO',
        pages: [enterInvoicePage],
        dataItems: [],
        appModel: {
          applicationName: 'SAP GUI',
          elements: [
            {
              id: 'el-invoice-field',
              name: 'Invoice Number Field',
              mode: 'SAP',
              attributes: [
                { name: 'Id', value: 'wnd[0]/usr/txtRF05A-NEWBS', matchType: 'exact', enabled: true },
              ],
            },
          ],
        },
        sourceRef: ref('/object[1]'),
      },
    ],
    workQueues: [
      {
        name: 'Invoices Queue',
        keyField: 'Invoice ID',
        maxAttempts: 3,
        sourceRef: ref('/work-queue[1]'),
      },
    ],
    environmentVars: [],
    credentialsRefs: [],
    dependencies: [],
  };
}
