import { XMLValidator } from 'fast-xml-parser';
import { describe, expect, it } from 'vitest';
import { buildProject, buildProjectJson, decideProjectLayout, deterministicGuid } from './project';
import type { WorkflowDoc } from './xaml';

const simpleDoc = (className: string): WorkflowDoc => ({
  className,
  arguments: [],
  body: {
    kind: 'sequence',
    displayName: className,
    activities: [{ kind: 'writeLine', text: `"${className}"` }],
  },
});

describe('decideProjectLayout', () => {
  it('uses plain layout below the stage threshold', () => {
    expect(decideProjectLayout({ stageCount: 19, usesQueues: false })).toBe('plain');
  });

  it('uses REFramework at or above the threshold', () => {
    expect(decideProjectLayout({ stageCount: 60, usesQueues: false })).toBe('reframework');
    expect(decideProjectLayout({ stageCount: 201, usesQueues: false })).toBe('reframework');
  });

  it('always uses REFramework for queue-driven processes', () => {
    expect(decideProjectLayout({ stageCount: 10, usesQueues: true })).toBe('reframework');
  });

  it('honors a configured threshold', () => {
    expect(
      decideProjectLayout({ stageCount: 25, usesQueues: false }, { reframeworkStageThreshold: 20 }),
    ).toBe('reframework');
  });
});

describe('deterministicGuid', () => {
  it('is stable for the same seed and distinct across seeds', () => {
    expect(deterministicGuid('A')).toBe(deterministicGuid('A'));
    expect(deterministicGuid('A')).not.toBe(deterministicGuid('B'));
  });

  it('is UUID-shaped', () => {
    expect(deterministicGuid('Loan Payment Calculator')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe('buildProjectJson', () => {
  it('emits valid Studio project metadata (snapshot)', () => {
    const json = buildProjectJson({
      name: 'Loan Payment Calculator',
      description: 'Converted from Blue Prism by PrismShift.',
      mainFile: 'Main.xaml',
    });
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed['name']).toBe('Loan Payment Calculator');
    expect(parsed['main']).toBe('Main.xaml');
    expect(parsed['schemaVersion']).toBe('4.0');
    expect(parsed['expressionLanguage']).toBe('VisualBasic');
    expect(parsed['targetFramework']).toBe('Windows');
    expect(parsed['dependencies']).toMatchObject({
      'UiPath.System.Activities': '[26.6.1]',
      'UiPath.UIAutomation.Activities': '[26.10.0]',
    });
    expect(json).toMatchSnapshot();
  });
});

describe('buildProject', () => {
  it('plain layout: project.json + workflows, all well-formed', () => {
    const project = buildProject({
      name: 'Simple',
      layout: 'plain',
      workflows: [
        { path: 'Main.xaml', doc: simpleDoc('Main') },
        { path: 'Pages/Validate.xaml', doc: simpleDoc('Validate') },
      ],
    });

    expect(project.files.map((f) => f.path)).toEqual([
      'project.json',
      'Main.xaml',
      'Pages/Validate.xaml',
    ]);
    for (const file of project.files.filter((f) => f.path.endsWith('.xaml'))) {
      expect(XMLValidator.validate(file.content), file.path).toBe(true);
    }
    expect(JSON.parse(project.files[0]!.content)).toMatchObject({ main: 'Main.xaml' });
  });

  it('REFramework layout: scaffold files + transaction guard wiring', () => {
    const project = buildProject({
      name: 'Queue Driven',
      layout: 'reframework',
      workflows: [{ path: 'Process.xaml', doc: simpleDoc('Process') }],
    });

    expect(project.files.map((f) => f.path)).toEqual([
      'project.json',
      'Main.xaml',
      'Framework/InitAllSettings.xaml',
      'Framework/GetTransactionData.xaml',
      'Framework/SetTransactionStatus.xaml',
      'Process.xaml',
    ]);
    for (const file of project.files.filter((f) => f.path.endsWith('.xaml'))) {
      expect(XMLValidator.validate(file.content), file.path).toBe(true);
    }

    const main = project.files.find((f) => f.path === 'Main.xaml')!.content;
    expect(main).toContain('Framework\\InitAllSettings.xaml');
    expect(main).toContain('Framework\\GetTransactionData.xaml');
    expect(main).toContain('Process.xaml');
    expect(main).toContain('<Catch x:TypeArguments="ui:BusinessRuleException">');
    expect(main).toContain('&quot;BusinessException&quot;');
    expect(main).toContain('&quot;SystemException&quot;');

    expect(JSON.parse(project.files[0]!.content)).toMatchObject({ main: 'Main.xaml' });
  });

  it('is deterministic end to end', () => {
    const build = () =>
      buildProject({
        name: 'Det',
        layout: 'reframework',
        workflows: [{ path: 'Process.xaml', doc: simpleDoc('Process') }],
      });
    expect(build()).toEqual(build());
  });
});
