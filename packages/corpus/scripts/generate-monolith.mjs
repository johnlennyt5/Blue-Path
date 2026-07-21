/**
 * Deterministic generator for corpus sample #3 "The Monolith".
 *
 * Emits samples/03-the-monolith.bprelease AND its answer key. Stage counts
 * and kind tallies in the key are computed from the same structures that emit
 * the XML, so they can never drift. Re-run after any change:
 *
 *   node scripts/generate-monolith.mjs
 *
 * Planted issues (see FINDINGS below): SEC-002, SEC-003, SEC-004, REL-001,
 * REL-002, REL-004, MNT-001 (x2), MNT-003 (x2), MNT-004, CMP-001, CMP-002.
 * Together with sample #2 (SEC-001, REL-003, MNT-002) every v1 rule has at
 * least one trigger in the corpus.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'samples');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let guidCounter = 0;
const nextGuid = () => `f3f3f3f3-0000-4000-9000-${String(++guidCounter).padStart(12, '0')}`;

const esc = (s) =>
  String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/** IR kind per BP stage type — must mirror @prismshift/parser. */
const KIND = {
  Start: 'start',
  End: 'end',
  Action: 'action',
  Calculation: 'calculation',
  MultipleCalculation: 'multiCalc',
  Decision: 'decision',
  SubSheet: 'subsheetRef',
  LoopStart: 'loopStart',
  LoopEnd: 'loopEnd',
  Anchor: 'anchor',
  Note: 'note',
  Alert: 'alert',
  Data: 'data',
  Collection: 'collection',
  Exception: 'exception',
  Recover: 'recover',
  Resume: 'resume',
  Read: 'read',
  Write: 'write',
  Navigate: 'navigate',
  WaitStart: 'wait',
  WaitEnd: 'anchor',
  Code: 'code',
};

/** One process/object definition being assembled. */
class Definition {
  constructor(name, narrative, { isObject = false } = {}) {
    this.id = nextGuid();
    this.name = name;
    this.narrative = narrative;
    this.isObject = isObject;
    this.pages = []; // {id, name, type, stages: [{id,type,name,body}]}
    this.appdefXml = '';
  }

  page(name, type = 'Normal') {
    const p = { id: nextGuid(), name, type, stages: [] };
    this.pages.push(p);
    return p;
  }

  stage(page, type, name, body = '', id = nextGuid()) {
    page.stages.push({ id, type, name, body });
    return id;
  }

  stats() {
    const kinds = {};
    let stageCount = 0;
    let dataItemCount = 0;
    for (const p of this.pages) {
      for (const s of p.stages) {
        stageCount += 1;
        const kind = KIND[s.type];
        if (!kind) throw new Error(`No IR kind mapping for stage type ${s.type}`);
        kinds[kind] = (kinds[kind] ?? 0) + 1;
        if (s.type === 'Data' || s.type === 'Collection') dataItemCount += 1;
      }
    }
    return { pages: this.pages.map((p) => p.name), stageCount, dataItemCount, stageKinds: kinds };
  }

  toXml() {
    const lines = [];
    const tag = this.isObject ? 'object' : 'process';
    const typeAttr = this.isObject ? ' type="object"' : '';
    lines.push(`    <${tag} id="${this.id}" name="${esc(this.name)}" xmlns="">`);
    lines.push(
      `      <process name="${esc(this.name)}"${typeAttr} version="1.0" bpversion="6.10.1.12345" narrative="${esc(this.narrative)}" byrefcollection="true">`,
    );
    if (this.appdefXml) lines.push(this.appdefXml);
    lines.push('        <view><camerax>0</camerax><cameray>0</cameray><zoom>1</zoom></view>');
    lines.push('        <preconditions />');
    lines.push('        <endpoint narrative="" />');
    for (const p of this.pages) {
      lines.push(
        `        <subsheet subsheetid="${p.id}" type="${p.type}" published="${p.type === 'MainPage' ? 'True' : 'False'}">`,
      );
      lines.push(`          <name>${esc(p.name)}</name>`);
      lines.push('          <view><camerax>0</camerax><cameray>0</cameray><zoom>1</zoom></view>');
      lines.push('        </subsheet>');
    }
    // Flow stages go down the main column; data/collection stages sit in a
    // side column so the flow view stays readable.
    for (const p of this.pages) {
      let flowY = 0;
      let dataY = 0;
      for (const s of p.stages) {
        const isData = s.type === 'Data' || s.type === 'Collection';
        const x = isData ? 320 : 15;
        const y = isData ? (dataY += 45) : (flowY += 45);
        lines.push(`        <stage stageid="${s.id}" name="${esc(s.name)}" type="${s.type}">`);
        lines.push(`          <subsheetid>${p.id}</subsheetid>`);
        lines.push(`          <display x="${x}" y="${y}" />`);
        if (s.body) lines.push(s.body.replace(/^/gm, '          ').trimEnd());
        lines.push('        </stage>');
      }
    }
    lines.push('      </process>');
    lines.push(`    </${tag}>`);
    return lines.join('\n');
  }
}

const on = (id) => `<onsuccess>${id}</onsuccess>`;
const dataBody = (datatype, initialValue = '', exposure = '') =>
  `<datatype>${datatype}</datatype>\n<initialvalue${initialValue === '' ? ' /' : `>${esc(initialValue)}</initialvalue`}>\n${exposure ? `<exposure>${exposure}</exposure>\n` : ''}<alwaysinit />`;
const calcBody = (expr, storeIn, next) =>
  `<calculation expression="${esc(expr)}" stage="${esc(storeIn)}" />\n${on(next)}`;

// ---------------------------------------------------------------------------
// The Monolith process
// ---------------------------------------------------------------------------

const monolith = new Definition('Customer Account Reconciliation', ''); // CMP-002: no narrative

const main = monolith.page('Main Page', 'MainPage');
const validate = monolith.page('Validate Customer');
const update = monolith.page('Update Ledger');
const orphan = monolith.page('Orphaned Utilities'); // MNT-001: never referenced

// Pre-allocate ids we need for links
const id = {
  start: nextGuid(), logIn: nextGuid(), readLedger: nextGuid(), loopStart: nextGuid(),
  extractSsn: nextGuid(), alert: nextGuid(), refValidate: nextGuid(), decValid: nextGuid(),
  refUpdate: nextGuid(), anchorContinue: nextGuid(), queueAdd: nextGuid(), loopEnd: nextGuid(),
  decSession: nextGuid(), refresh: nextGuid(), anchorRetry: nextGuid(), sessionAge: nextGuid(),
  totalCalc: nextGuid(), end: nextGuid(), islandCalc: nextGuid(), islandNote: nextGuid(),
};

const PAD_COUNT = 36;
const padCalcIds = Array.from({ length: PAD_COUNT }, () => nextGuid());
const loopGroup = nextGuid();

monolith.stage(
  main, 'Start', 'Start',
  `<inputs>\n  <input type="text" name="SAP Password" narrative="Ledger terminal password" stage="SAP Password" />\n  <input type="date" name="Run Date" narrative="" stage="Run Date" />\n</inputs>\n${on(id.logIn)}`,
  id.start,
);
monolith.stage(
  main, 'Action', 'Log In To Ledger',
  `<resource object="Ledger Terminal VBO" action="Log In" />\n<inputs>\n  <input type="text" name="Password" expr="[SAP Password]" />\n</inputs>\n<outputs />\n${on(id.readLedger)}`,
  id.logIn,
);
monolith.stage(
  main, 'Action', 'Read Ledger Export',
  `<resource object="Ledger Terminal VBO" action="Read Ledger Export" />\n<inputs>\n  <input type="text" name="Export Path" expr="[Export Path]" />\n</inputs>\n<outputs>\n  <output type="collection" name="Rows" stage="Customer Records" />\n</outputs>\n${on(id.loopStart)}`,
  id.readLedger,
);
monolith.stage(
  main, 'LoopStart', 'For Each Customer',
  `<groupid>${loopGroup}</groupid>\n<loopdata>Customer Records</loopdata>\n${on(id.extractSsn)}`,
  id.loopStart,
);
monolith.stage(
  main, 'Calculation', 'Extract SSN',
  calcBody('[Customer Records.SSN]', 'Customer SSN', id.alert),
  id.extractSsn,
);
// SEC-003: SSN flows into a log-style stage
monolith.stage(
  main, 'Alert', 'Log Customer Detail',
  `<alert expression="${esc('"Reconciling account " & [Customer Records.Account Number] & " SSN " & [Customer SSN] & " run " & [Run Date]')}" />\n${on(id.refValidate)}`,
  id.alert,
);
monolith.stage(
  main, 'SubSheet', 'Validate Customer',
  `<processid>${validate.id}</processid>\n<inputs>\n  <input type="text" name="Customer SSN" expr="[Customer SSN]" />\n</inputs>\n<outputs>\n  <output type="flag" name="Valid" stage="Is Valid" />\n</outputs>\n${on(id.decValid)}`,
  id.refValidate,
);
monolith.stage(
  main, 'Decision', 'Valid Record?',
  `<decision expression="[Is Valid]" />\n<ontrue>${id.refUpdate}</ontrue>\n<onfalse>${id.anchorContinue}</onfalse>`,
  id.decValid,
);
monolith.stage(
  main, 'SubSheet', 'Update Ledger',
  `<processid>${update.id}</processid>\n<inputs>\n  <input type="text" name="Account Number" expr="[Customer Records.Account Number]" />\n</inputs>\n<outputs />\n${on(id.anchorContinue)}`,
  id.refUpdate,
);
monolith.stage(main, 'Anchor', 'Continue', on(id.queueAdd), id.anchorContinue);
// CMP-001: PII collection queued to an unencrypted queue
monolith.stage(
  main, 'Action', 'Queue Customer Record',
  `<resource object="Work Queues" action="Add To Queue" />\n<inputs>\n  <input type="text" name="Queue Name" expr="${esc('"Reconciliation Queue"')}" />\n  <input type="collection" name="Data" expr="[Customer Records]" />\n</inputs>\n<outputs />\n${on(id.loopEnd)}`,
  id.queueAdd,
);
monolith.stage(
  main, 'LoopEnd', 'Next Customer',
  `<groupid>${loopGroup}</groupid>\n${on(id.decSession)}`,
  id.loopEnd,
);
monolith.stage(
  main, 'Decision', 'Session Expired?',
  `<decision expression="[Session Age] &gt; 30" />\n<ontrue>${id.refresh}</ontrue>\n<onfalse>${id.sessionAge}</onfalse>`,
  id.decSession,
);
// REL-002: unguarded retry cycle (no decision inside the cycle)
monolith.stage(
  main, 'Action', 'Refresh Session',
  `<resource object="Ledger Terminal VBO" action="Refresh" />\n<inputs />\n<outputs />\n${on(id.anchorRetry)}`,
  id.refresh,
);
monolith.stage(main, 'Anchor', 'Retry', on(id.refresh), id.anchorRetry);
monolith.stage(
  main, 'Calculation', 'Update Session Age',
  calcBody('[Session Age] + 1', 'Session Age', padCalcIds[0]),
  id.sessionAge,
);
for (let n = 1; n <= PAD_COUNT; n++) {
  const expr = n === 1 ? '[Session Age] + 1' : `[Metric ${n - 1}] + 1`;
  const next = n === PAD_COUNT ? id.totalCalc : padCalcIds[n];
  monolith.stage(main, 'Calculation', `Compute Metric ${n}`, calcBody(expr, `Metric ${n}`, next), padCalcIds[n - 1]);
}
monolith.stage(
  main, 'Calculation', 'Total Metrics',
  calcBody(`[Metric ${PAD_COUNT}] * 1`, 'Total Metrics', id.end),
  id.totalCalc,
);
monolith.stage(
  main, 'End', 'End',
  `<outputs>\n  <output type="number" name="Total Metrics" narrative="" stage="Total Metrics" />\n</outputs>`,
  id.end,
);
// MNT-001: unreachable island (no inbound edge from the flow)
monolith.stage(
  main, 'Calculation', 'Legacy Adjustment',
  calcBody('[Session Age] * 2', 'Session Age', id.islandNote),
  id.islandCalc,
);
monolith.stage(main, 'Note', 'Retired logic kept for reference', '<narrative>Superseded in 2019; kept for audit.</narrative>', id.islandNote);

// Main page data items
monolith.stage(main, 'Data', 'SAP Password', dataBody('text')); // SEC-002 material (with startup param)
monolith.stage(main, 'Data', 'Run Date', dataBody('date'));
monolith.stage(main, 'Data', 'Export Path', dataBody('text', '\\\\fs01\\exports\\ledger.csv')); // SEC-004: UNC path
monolith.stage(
  main, 'Collection', 'Customer Records',
  `<collectioninfo>\n  <field name="Account Number" type="text" />\n  <field name="SSN" type="text" />\n  <field name="Balance" type="number" />\n</collectioninfo>`,
);
monolith.stage(main, 'Data', 'Customer SSN', dataBody('text'));
monolith.stage(main, 'Data', 'Is Valid', dataBody('flag'));
monolith.stage(main, 'Data', 'Session Age', dataBody('number', '0'));
monolith.stage(main, 'Data', 'Total Metrics', dataBody('number'));
for (let n = 1; n <= PAD_COUNT; n++) {
  monolith.stage(main, 'Data', `Metric ${n}`, dataBody('number'));
}

// Validate Customer page
{
  const start = nextGuid();
  const calcIds = Array.from({ length: 40 }, () => nextGuid());
  const dec = nextGuid();
  const setValid = nextGuid();
  const setInvalid = nextGuid();
  const end = nextGuid();

  monolith.stage(
    validate, 'Start', 'Start',
    `<inputs>\n  <input type="text" name="Customer SSN" narrative="" stage="Customer SSN" />\n</inputs>\n${on(calcIds[0])}`,
    start,
  );
  monolith.stage(validate, 'Calculation', 'Copy SSN', calcBody('[Customer SSN]', 'Work SSN', calcIds[1]), calcIds[0]);
  for (let n = 1; n < 40; n++) {
    const next = n === 39 ? dec : calcIds[n + 1];
    monolith.stage(validate, 'Calculation', `Normalise Pass ${n}`, calcBody('[Work SSN]', 'Work SSN', next), calcIds[n]);
  }
  monolith.stage(
    validate, 'Decision', 'SSN Well Formed?',
    `<decision expression="${esc('Len([Work SSN]) = 11')}" />\n<ontrue>${setValid}</ontrue>\n<onfalse>${setInvalid}</onfalse>`,
    dec,
  );
  monolith.stage(validate, 'Calculation', 'Set Valid', calcBody('True', 'Is Valid Local', end), setValid);
  monolith.stage(validate, 'Calculation', 'Set Invalid', calcBody('False', 'Is Valid Local', end), setInvalid);
  monolith.stage(
    validate, 'End', 'End',
    `<outputs>\n  <output type="flag" name="Valid" narrative="" stage="Is Valid Local" />\n</outputs>`,
    end,
  );
  monolith.stage(validate, 'Data', 'Customer SSN', dataBody('text'));
  monolith.stage(validate, 'Data', 'Work SSN', dataBody('text'));
  monolith.stage(validate, 'Data', 'Is Valid Local', dataBody('flag'));
}

// Update Ledger page
{
  const start = nextGuid();
  const action = nextGuid();
  const calcIds = Array.from({ length: 35 }, () => nextGuid());
  const end = nextGuid();

  monolith.stage(
    update, 'Start', 'Start',
    `<inputs>\n  <input type="text" name="Account Number" narrative="" stage="Account Number" />\n</inputs>\n${on(action)}`,
    start,
  );
  monolith.stage(
    update, 'Action', 'Post Adjustment',
    `<resource object="Ledger Terminal VBO" action="Post Adjustment" />\n<inputs>\n  <input type="text" name="Account Number" expr="[Account Number]" />\n</inputs>\n<outputs />\n${on(calcIds[0])}`,
    action,
  );
  for (let n = 0; n < 35; n++) {
    const expr = n === 0 ? '[Account Number]' : '[Ledger Temp]';
    const next = n === 34 ? end : calcIds[n + 1];
    monolith.stage(update, 'Calculation', `Reconcile Step ${n + 1}`, calcBody(expr, 'Ledger Temp', next), calcIds[n]);
  }
  monolith.stage(update, 'End', 'End', '<outputs />', end);
  monolith.stage(update, 'Data', 'Account Number', dataBody('text'));
  monolith.stage(update, 'Data', 'Ledger Temp', dataBody('text'));
}

// Orphaned Utilities page (MNT-001: no subsheet reference targets it)
{
  const start = nextGuid();
  const calcIds = Array.from({ length: 10 }, () => nextGuid());
  const end = nextGuid();
  monolith.stage(orphan, 'Start', 'Start', `<inputs />\n${on(calcIds[0])}`, start);
  for (let n = 0; n < 10; n++) {
    const next = n === 9 ? end : calcIds[n + 1];
    monolith.stage(orphan, 'Calculation', `Utility Step ${n + 1}`, calcBody('[Scratch] + 1', 'Scratch', next), calcIds[n]);
  }
  monolith.stage(orphan, 'End', 'End', '<outputs />', end);
  monolith.stage(orphan, 'Data', 'Scratch', dataBody('number', '0'));
}

// ---------------------------------------------------------------------------
// Three near-duplicate VBOs (MNT-003) — #1 carries the index-matched element
// (REL-004); v2/Copy differ only trivially.
// ---------------------------------------------------------------------------

function buildLedgerVbo(name, { indexMatch, narrativeSuffix }) {
  const vbo = new Definition(
    name,
    `Drives the Ledger Terminal application: login, export reads, and adjustments.${narrativeSuffix}`,
    { isObject: true },
  );
  const elSession = nextGuid();
  const elGrid = nextGuid();
  vbo.appdefXml = [
    '        <appdef>',
    '          <application name="Ledger Terminal" mode="Win32" />',
    `          <element id="${elSession}" name="Session Window" mode="Win32">`,
    '            <attributes>',
    '              <attribute name="WindowText" matchtype="exact" enabled="true" value="Ledger Terminal" />',
    '              <attribute name="ClassName" matchtype="exact" enabled="true" value="LedgerMainWnd" />',
    '            </attributes>',
    '          </element>',
    `          <element id="${elGrid}" name="Grid Rows" mode="Win32">`,
    '            <attributes>',
    `              <attribute name="ClassName" matchtype="exact" enabled="true" value="LedgerGrid" />`,
    `              <attribute name="Ordinal" matchtype="${indexMatch ? 'index' : 'exact'}" enabled="true" value="3" />`,
    '            </attributes>',
    '          </element>',
    '        </appdef>',
  ].join('\n');

  // Log In
  {
    const p = vbo.page('Log In');
    const start = nextGuid(), write = nextGuid(), nav = nextGuid(), wait = nextGuid(),
      waitEnd = nextGuid(), exc = nextGuid(), end = nextGuid();
    vbo.stage(p, 'Start', 'Start', `<inputs>\n  <input type="password" name="Password" narrative="" stage="Password" />\n</inputs>\n${on(write)}`, start);
    vbo.stage(p, 'Write', 'Enter Credentials', `<steps>\n  <step element="${elSession}" expr="[Password]" />\n</steps>\n${on(nav)}`, write);
    vbo.stage(p, 'Navigate', 'Click Log In', `<steps>\n  <step element="${elSession}" action="Click" />\n</steps>\n${on(wait)}`, nav);
    vbo.stage(p, 'WaitStart', 'Wait For Session', `<timeout>30</timeout>\n<choices>\n  <choice name="Session Ready">\n    <element>${elSession}</element>\n    <condition>CheckExists</condition>\n    <onsuccess>${end}</onsuccess>\n  </choice>\n</choices>\n<ontimeout>${waitEnd}</ontimeout>`, wait);
    vbo.stage(p, 'WaitEnd', 'Timed Out', on(exc), waitEnd);
    vbo.stage(p, 'Exception', 'Login Timeout', `<exception type="System Exception" detail="${esc('"Ledger session did not appear"')}" />`, exc);
    vbo.stage(p, 'End', 'End', '<outputs />', end);
    vbo.stage(p, 'Data', 'Password', dataBody('password'));
  }
  // Read Ledger Export
  {
    const p = vbo.page('Read Ledger Export');
    const start = nextGuid(), code = nextGuid(), end = nextGuid();
    vbo.stage(p, 'Start', 'Start', `<inputs>\n  <input type="text" name="Export Path" narrative="" stage="Export Path" />\n</inputs>\n${on(code)}`, start);
    vbo.stage(
      p, 'Code', 'Read Export',
      `<inputs>\n  <input type="text" name="Export Path" expr="[Export Path]" />\n</inputs>\n<outputs>\n  <output type="collection" name="Rows" stage="Ledger Rows" />\n</outputs>\n<code language="vbnet"><![CDATA[\nDim reader As New LedgerReader(Export_Path)\nRows = reader.ReadAll()\n]]></code>\n${on(end)}`,
      code,
    );
    vbo.stage(p, 'End', 'End', `<outputs>\n  <output type="collection" name="Rows" narrative="" stage="Ledger Rows" />\n</outputs>`, end);
    vbo.stage(p, 'Data', 'Export Path', dataBody('text'));
    vbo.stage(p, 'Collection', 'Ledger Rows', `<collectioninfo>\n  <field name="Account Number" type="text" />\n  <field name="SSN" type="text" />\n  <field name="Balance" type="number" />\n</collectioninfo>`);
  }
  // Post Adjustment
  {
    const p = vbo.page('Post Adjustment');
    const start = nextGuid(), write = nextGuid(), nav = nextGuid(), end = nextGuid();
    vbo.stage(p, 'Start', 'Start', `<inputs>\n  <input type="text" name="Account Number" narrative="" stage="Account Number" />\n</inputs>\n${on(write)}`, start);
    vbo.stage(p, 'Write', 'Write Account Row', `<steps>\n  <step element="${elGrid}" expr="[Account Number]" />\n</steps>\n${on(nav)}`, write);
    vbo.stage(p, 'Navigate', 'Commit Row', `<steps>\n  <step element="${elGrid}" action="Click" />\n</steps>\n${on(end)}`, nav);
    vbo.stage(p, 'End', 'End', '<outputs />', end);
    vbo.stage(p, 'Data', 'Account Number', dataBody('text'));
  }
  // Refresh
  {
    const p = vbo.page('Refresh');
    const start = nextGuid(), nav = nextGuid(), end = nextGuid();
    vbo.stage(p, 'Start', 'Start', `<inputs />\n${on(nav)}`, start);
    vbo.stage(p, 'Navigate', 'Refresh Session', `<steps>\n  <step element="${elSession}" action="Click" />\n</steps>\n${on(end)}`, nav);
    vbo.stage(p, 'End', 'End', '<outputs />', end);
  }
  return vbo;
}

const vbo1 = buildLedgerVbo('Ledger Terminal VBO', { indexMatch: true, narrativeSuffix: '' });
const vbo2 = buildLedgerVbo('Ledger Terminal VBO v2', { indexMatch: false, narrativeSuffix: ' Cloned for the 2021 upgrade.' });
const vbo3 = buildLedgerVbo('Ledger Terminal VBO Copy', { indexMatch: false, narrativeSuffix: ' Working copy - do not use.' });

// ---------------------------------------------------------------------------
// Assemble release
// ---------------------------------------------------------------------------

const releaseXml = `<?xml version="1.0" encoding="utf-8"?>
<bpr:release xmlns:bpr="http://www.blueprism.co.uk/product/release">
  <bpr:name>The Monolith</bpr:name>
  <bpr:release-notes>PrismShift corpus sample #3 - a 200+ stage monolith planting SEC-002/003/004, REL-001/002/004, MNT-001/003/004, CMP-001/002. See answer key.</bpr:release-notes>
  <bpr:created>2026-07-20 13:00:00Z</bpr:created>
  <bpr:package-id>3</bpr:package-id>
  <bpr:package-name>PrismShift Corpus</bpr:package-name>
  <bpr:user-created-by>corpus-generator</bpr:user-created-by>
  <bpr:contents count="5">

${monolith.toXml()}

${vbo1.toXml()}

${vbo2.toXml()}

${vbo3.toXml()}

    <work-queue id="${nextGuid()}" name="Reconciliation Queue" xmlns="">
      <keyfield>Account Number</keyfield>
      <maxattempts>5</maxattempts>
      <encrypted>false</encrypted>
    </work-queue>
  </bpr:contents>
</bpr:release>
`;

// ---------------------------------------------------------------------------
// Answer key
// ---------------------------------------------------------------------------

const FINDINGS = [
  { ruleId: 'SEC-002', severity: 'high', processName: monolith.name,
    note: 'Startup parameter "SAP Password" is plain text instead of a Credential Manager lookup' },
  { ruleId: 'SEC-003', severity: 'high', processName: monolith.name, pageName: 'Main Page', stageName: 'Log Customer Detail',
    note: 'SSN flows into a log/alert stage' },
  { ruleId: 'SEC-004', severity: 'medium', processName: monolith.name, pageName: 'Main Page', stageName: 'Export Path',
    note: 'Hardcoded UNC path in data item initial value' },
  { ruleId: 'REL-001', severity: 'high', processName: monolith.name,
    note: 'No Recover/Resume anywhere in the process' },
  { ruleId: 'REL-002', severity: 'high', processName: monolith.name, pageName: 'Main Page', stageName: 'Refresh Session',
    note: 'Refresh Session <-> Retry anchor cycle has no decision guard' },
  { ruleId: 'REL-004', severity: 'medium', objectName: vbo1.name, elementName: 'Grid Rows',
    note: 'Element matched by Ordinal index instead of stable attributes' },
  { ruleId: 'MNT-001', severity: 'medium', processName: monolith.name, pageName: 'Main Page', stageName: 'Legacy Adjustment',
    note: 'Unreachable stage island (Legacy Adjustment -> Note)' },
  { ruleId: 'MNT-001', severity: 'medium', processName: monolith.name, pageName: 'Orphaned Utilities',
    note: 'Page is never referenced by any page-reference stage' },
  { ruleId: 'MNT-003', severity: 'medium', objectName: vbo2.name,
    note: 'Near-duplicate of Ledger Terminal VBO (structure similarity > 0.85)' },
  { ruleId: 'MNT-003', severity: 'medium', objectName: vbo3.name,
    note: 'Near-duplicate of Ledger Terminal VBO (structure similarity > 0.85)' },
  { ruleId: 'MNT-004', severity: 'medium', processName: monolith.name,
    note: 'Monolith: >150 stages in process and >60 on Main Page - recommend dispatcher/performer split' },
  { ruleId: 'CMP-001', severity: 'high', processName: monolith.name, pageName: 'Main Page', stageName: 'Queue Customer Record',
    note: 'Collection with SSN field queued to unencrypted queue' },
  { ruleId: 'CMP-002', severity: 'info', processName: monolith.name,
    note: 'Process narrative/documentation is empty' },
];

const answerKey = {
  id: '03-the-monolith',
  file: '03-the-monolith.bprelease',
  description:
    'A 200+ stage reconciliation monolith with three near-duplicate VBO clones. Plants every v1 rule not covered by sample #2. The retry cycle is deliberately unguarded (REL-002); the performer cycle in sample #2 is the guarded negative case.',
  expectedParse: {
    errors: 0,
    warnings: 0,
    bpVersion: '6.10.1.12345',
    packageName: 'PrismShift Corpus',
    counts: { processes: 1, objects: 3, workQueues: 1, environmentVars: 0, credentialRefs: 0 },
    processes: [
      {
        name: monolith.name,
        ...monolith.stats(),
        startupParams: ['SAP Password', 'Run Date'],
        outputs: ['Total Metrics'],
      },
    ],
    objects: [vbo1, vbo2, vbo3].map((v) => ({
      name: v.name,
      applicationName: 'Ledger Terminal',
      appElementCount: 2,
      ...v.stats(),
    })),
  },
  expectedFindings: FINDINGS.map(({ note, ...finding }) => finding),
  expectedSummaries: [
    {
      processName: monolith.name,
      applicationsTouched: ['Ledger Terminal'],
      objectsCalled: ['Ledger Terminal VBO'],
      queuesUsed: ['Reconciliation Queue'],
      inputs: ['SAP Password', 'Run Date'],
      outputs: ['Total Metrics'],
      hasRecovery: false,
      recoveryPages: [],
      deliberateThrows: false,
      mainPageFirstSteps: [
        'Call Ledger Terminal VBO › Log In',
        'Call Ledger Terminal VBO › Read Ledger Export',
        'For each row in Customer Records',
      ],
      sensitiveItems: [
        'Account Number',
        'Customer Records.Account Number',
        'Customer Records.SSN',
        'Customer SSN',
        'Work SSN',
      ],
    },
  ],
  notes:
    'Planted issues (12 findings): ' +
    FINDINGS.map((f) => `${f.ruleId} - ${f.note}`).join('; ') +
    '. The Monolith process deliberately has an empty narrative (CMP-002) - structural corpus checks must exempt it.',
};

writeFileSync(path.join(OUT_DIR, '03-the-monolith.bprelease'), releaseXml);
writeFileSync(path.join(OUT_DIR, '03-the-monolith.answer-key.json'), `${JSON.stringify(answerKey, null, 2)}\n`);

const pStats = monolith.stats();
console.log(`Monolith: ${pStats.stageCount} stages across ${pStats.pages.length} pages, ${pStats.dataItemCount} data items`);
console.log(`Objects: ${[vbo1, vbo2, vbo3].map((v) => `${v.name} (${v.stats().stageCount})`).join(', ')}`);
console.log(`Findings planted: ${FINDINGS.length}`);
