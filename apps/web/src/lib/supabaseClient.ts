/**
 * Supabase client factory (S6-3). Workspace Mode is strictly opt-in: with no
 * env configuration the client is null, no network code runs, and the app is
 * pure Local Mode — the ARCHITECTURE §1.1 privacy default.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

export type Supabase = SupabaseClient<Database>;

let cached: Supabase | null | undefined;

export function getSupabase(): Supabase | null {
  if (cached !== undefined) return cached;
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (url === undefined || key === undefined) {
    cached = null;
    console.log('[PrismShift] no Supabase config — Workspace Mode unavailable, Local Mode only');
    return cached;
  }
  console.log(
    `[PrismShift] creating Supabase client → ${url} · page origin ${window.location.origin} · ` +
      `URL hash has access_token: ${window.location.hash.includes('access_token')}`,
  );
  cached = createClient<Database>(url, key);
  return cached;
}

/** Test seam: reset the cached client between tests. */
export function resetSupabaseForTests(): void {
  cached = undefined;
}
