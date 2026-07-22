/**
 * BL-006 · Test-case stub generation: Given/When/Then structure, argument
 * wiring from the real corpus process signature, exception-path semantics,
 * and gate-proven-activities-only XAML.
 */
import { describe, expect, it } from 'vitest';
import { loadSample } from '@prismshift/corpus';
import { parseBpRelease } from '@prismshift/parser';
import { convertProcess } from './convert';
import { buildTestCases } from './testCases';
import { emitWorkflowXaml } from './xaml';

async function loanCalculator() {
  const { xml } = await loadSample('01-clean-and-simple');
  const { model } = await parseBpRelease(xml);
  const process = model.processes[0]!;
  const conversion = convertProcess(model, process);
  return buildTestCases({
    processName: process.name,
    mainFile: conversion.workflows[0]!.path,
    arguments: conversion.workflows[0]!.doc.arguments,
  });
}

describe('buildTestCases', () => {
  it('emits happy + exception stubs under Tests/', async () => {
    const cases = await loanCalculator();
    expect(cases.map((c) => c.path)).toEqual([
      'Tests/Loan_Payment_Calculator_HappyPath.xaml',
      'Tests/Loan_Payment_Calculator_ExceptionPath.xaml',
    ]);
  });

  it('happy path: Given/When/Then, args wired to tc_ variables, assertion placeholders', async () => {
    const [happy] = await loanCalculator();
    const xaml = emitWorkflowXaml(happy!.doc);

    expect(xaml).toContain('Given — arrange test inputs');
    expect(xaml).toContain('When — run the process');
    expect(xaml).toContain('Then — assert outcomes');
    // Inputs become defaulted variables and invoke bindings
    expect(xaml).toContain('Name="tc_in_Principal"');
    expect(xaml).toContain('x:Key="in_Principal">[tc_in_Principal]');
    // Outputs get assertion placeholders that fail loudly when falsified
    expect(xaml).toContain('TODO: assert on tc_out_Monthly_Payment');
    expect(xaml).toContain('Assertion failed for out_Monthly_Payment');
  });

  it('exception path: invoke inside Try, unthrown = failure, BRE = pass', async () => {
    const [, exceptionCase] = await loanCalculator();
    const xaml = emitWorkflowXaml(exceptionCase!.doc);
    expect(xaml).toContain('Expected the process to throw');
    expect(xaml).toContain('BusinessRuleException');
    expect(xaml).toContain('process rejected the invalid input as expected');
  });

  it('uses only gate-proven activity shapes (no ut:/Verify activities to fail loading)', async () => {
    const cases = await loanCalculator();
    for (const testCase of cases) {
      const xaml = emitWorkflowXaml(testCase.doc);
      expect(xaml).not.toContain('<ut:');
      expect(xaml).not.toContain('<Verify');
      expect(xaml).toContain('<ui:InvokeWorkflowFile');
    }
  });
});
