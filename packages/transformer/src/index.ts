/**
 * @prismshift/transformer — IR → UiPath XAML + project.json + REFramework
 * scaffolding (ARCHITECTURE §7).
 */
export const PACKAGE_NAME = '@prismshift/transformer';

export { convertProcess } from './convert';
export type { ConversionIssue, ProcessConversion } from './convert';
export { translateExpression } from './expression';
export type { TranslatedExpression } from './expression';
export { bpTypeToXaml, sanitizeFileName, sanitizeIdentifier } from './naming';
export {
  buildProject,
  buildProjectJson,
  decideProjectLayout,
  deterministicGuid,
} from './project';
export type {
  BuildProjectOptions,
  LayoutConfig,
  LayoutDecisionInput,
  ProjectFile,
  UiPathProject,
} from './project';
export { emitWorkflowXaml, escapeXml } from './xaml';
export type {
  InvokeArgumentBinding,
  WorkflowDoc,
  XActivity,
  XamlArgument,
  XamlCatch,
  XamlType,
  XamlVariable,
} from './xaml';
