'use client';

import { useEffect, useMemo, useRef } from 'react';
import { authenticatedFetch } from '@/lib/authenticated-fetch';
import { supabase } from '@/lib/supabase';
import { delay } from '@/lib/async-utils';
import { SCRYFALL_REQUEST_GAP_MS, normalizeImportedDeckPreview, resolveImportedDeckCommanderImageForSave } from '@/lib/profile-commander';
import { lookupCommanderCmcInBrowser } from '@/lib/commander-cmc-client';
import { deckDataToColorFields, getDefaultImportedCommanderOption } from '@/lib/deck-importers';
import { resolveDeckCommanderCmc } from '@/lib/deck-commander-cmc';
import { useProfileCommandScope } from '@/hooks/use-profile-command-scope';
import { withRequestDeadline } from '@/packages/data/request-deadline';
import type { ProfileDirectoryEntry as Profile } from '@/lib/types/profile-directory';
import type { ProfileImportedDeckPreview as ImportedDeckPreview } from '@/lib/types/profile-deck';

/** One attempt per account opening; scope/consent cleanup owns every pending request. */
export function useProfileArchidektAutosync(key: string | null, userId: string | null, currentProfile: Profile | null,
  fetchDecks: () => Promise<void>) {
  const opening = useMemo(() => ({ userId }), [userId]);
  const attemptedOpening = useRef<typeof opening | null>(null);
  const username = currentProfile?.archidekt_username?.trim() || '';
  const enabled = Boolean(userId && currentProfile?.id === userId && currentProfile.archidekt_auto_import && username);
  const { begin, cancel } = useProfileCommandScope(key, enabled);

  useEffect(() => {
    if (!enabled || !userId || attemptedOpening.current === opening) return;
    const job = begin('import');
    if (!job) return;
    const run = async () => {
      try {
        const payload = await withRequestDeadline({ abortSignal: async signal => {
          const response = await authenticatedFetch('/api/archidekt-user-decks', { method: 'POST',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username }), signal });
          if (!response.ok) throw new Error('Background catalog unavailable');
          return await response.json() as { decks?: ImportedDeckPreview[] };
        } }, 15000, job.signal);
        const candidates = (payload.decks || []).filter(deck => deck.sourceType === 'archidekt' && deck.sourceUrl
          && !deck.warning && !deck.error && Boolean(deck.commander?.trim()));
        const rows = [];
        for (const rawDeck of candidates) {
          if (!job.active()) return;
          // Bound each deck's metadata work, not the complete catalog's duration.
          const row = await withRequestDeadline({ abortSignal: async signal => {
            const deck = await normalizeImportedDeckPreview(rawDeck, signal);
            const commander = getDefaultImportedCommanderOption(deck);
            const colorFields = deckDataToColorFields({ commanderOptions: deck.commanderOptions || [], colorIdentity: deck.colorIdentity || [] });
            const commanderCmc = await resolveDeckCommanderCmc(
              { commander: commander.name, commander_options: colorFields.commander_options },
              name => lookupCommanderCmcInBrowser(name, signal));
            const commanderImage = await resolveImportedDeckCommanderImageForSave(commander, deck, undefined, signal);
            signal.throwIfAborted();
            return { user_id: userId, group_id: null, name: deck.name, commander: commander.name,
              commander_image: commanderImage, source_url: deck.sourceUrl, source_type: 'archidekt',
              bracket: deck.bracket, commander_cmc: commanderCmc, ...colorFields };
          } }, 15000, job.signal);
          if (!job.active()) return;
          rows.push(row);
          await delay(SCRYFALL_REQUEST_GAP_MS, job.signal);
        }
        // Optional metadata lookup can return null after cancellation. Check the
        // owner before sending any private write, including a cached fast path.
        if (!rows.length || !job.active()) return;
        const { error } = await withRequestDeadline(supabase.rpc('sync_archidekt_decks', { p_decks: rows }), 15000, job.signal);
        if (error) throw error;
        if (job.active()) await fetchDecks();
      } catch {
        // Background sync must not interrupt profile use or publish stale feedback.
      } finally { job.finish(); }
    };
    // A discarded/replayed effect must not consume the opening's sole attempt.
    queueMicrotask(() => {
      if (!job.active()) return;
      attemptedOpening.current = opening;
      void run();
    });
    return () => cancel('import');
  }, [begin, cancel, enabled, fetchDecks, opening, userId, username]);
}
