/**
 * Build stamp injected by Vite (vite.config.ts `define`). Falls back
 * gracefully in environments that don't run through Vite's define step
 * (e.g. unit tests).
 */
export const BUILD_TIME: string =
  typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : 'test-env';
