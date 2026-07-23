/**
 * @prismshift/transformer — IR → UiPath XAML + project.json + REFramework
 * scaffolding (ARCHITECTURE §7).
 */
export const PACKAGE_NAME = '@prismshift/transformer';

export { translateBpExpression } from './bpExpression';
export type { TranslateOptions, TranslationResult } from './bpExpression';
export { convertObject, convertProcess } from './convert';
export type { ConversionIssue, ConvertOptions, ObjectConversion, ProcessConversion } from './convert';
export { buildManifests } from './manifests';
export { generateObjectSelectors, generateSelector } from './selectors';
export type { GeneratedSelector } from './selectors';
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
