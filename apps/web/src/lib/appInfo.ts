export const APP_NAME = 'PrismShift';

/**
 * Operating modes per ARCHITECTURE §1.1. Local Mode is the default:
 * pipeline content never leaves the browser.
 */
export type OperatingMode = 'local' | 'workspace';

export const DEFAULT_MODE: OperatingMode = 'local';

export function modeLabel(mode: OperatingMode): string {
  return mode === 'local' ? 'Local Mode' : 'Workspace Mode';
}
