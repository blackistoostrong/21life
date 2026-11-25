import { describe, expect, it, vi } from 'vitest';
import { restoreSetupDecks } from '@/components/live-game/restore-setup-decks';
import type { SupabaseClient } from '@supabase/supabase-js';
function client(result: { data: unknown; error: unknown }) {
 const query = { select: () => query, eq: () => query, in: () => query, abortSignal: () => Promise.resolve(result) };
 return { from: () => query } as unknown as SupabaseClient;
}
describe('saved occasional setup restoration', () => {
 it('aborts a pending SDK request when its account owner closes', async () => {
  let received: AbortSignal | undefined;
  const query = { select: () => query, eq: () => query, in: () => query,
   abortSignal: (signal: AbortSignal) => { received = signal; return new Promise<never>(() => undefined); } };
  const parent = new AbortController();
  const result = restoreSetupDecks({ from: () => query } as unknown as SupabaseClient, 'arena', ['saved-id'], parent.signal);
  const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  parent.abort(); await assertion;
  expect(received?.aborted).toBe(true);
 });
 it('bounds an unresponsive SDK request to the foreground deadline', async () => {
  vi.useFakeTimers();
  try {
   let received: AbortSignal | undefined;
   const query = { select: () => query, eq: () => query, in: () => query,
    abortSignal: (signal: AbortSignal) => { received = signal; return new Promise<never>(() => undefined); } };
   const result = restoreSetupDecks({ from: () => query } as unknown as SupabaseClient, 'arena', ['saved-id']);
   const assertion = expect(result).rejects.toThrow('Live game operation timed out');
   await vi.advanceTimersByTimeAsync(8000); await assertion;
   expect(received?.aborted).toBe(true);
  } finally { vi.useRealTimers(); }
 });
 it('rejects transient catalog errors so the saved deck selection is not replaced by a fallback', async () => {
  await expect(restoreSetupDecks(client({ data: null, error: new Error('offline') }), 'arena', ['saved-id'])).rejects.toThrow('offline');
 });
 it('returns the arena catalog snapshot after retry succeeds', async () => {
  const deck = { id: 'saved-id', user_id: 'a', group_id: 'arena', source_type: 'occasional' };
  await expect(restoreSetupDecks(client({ data: [deck], error: null }), 'arena', ['saved-id'])).resolves.toEqual([deck]);
 });
});
