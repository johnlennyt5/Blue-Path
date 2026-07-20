/**
 * Tagged console logging for the intake pipeline. Filter the browser console
 * by "[PrismShift]" to follow the drop → read → parse chain.
 */
export function plog(message: string, ...detail: unknown[]): void {
  console.log(`[PrismShift] ${message}`, ...detail);
}
