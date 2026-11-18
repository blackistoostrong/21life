'use client';
import { useCallback, useEffect, useRef } from 'react';
import { authenticatedFetch } from '@/lib/authenticated-fetch';
import { supabase } from '@/lib/supabase';
import { delay } from '@/lib/async-utils';
import { SCRYFALL_REQUEST_GAP_MS, normalizeImportedDeckPreview, resolveImportedDeckCommanderImageForSave } from '@/lib/profile-commander';
import { lookupCommanderCmcInBrowser } from '@/lib/commander-cmc-client';
import { deckDataToColorFields, getDefaultImportedCommanderOption } from '@/lib/deck-importers';
import { resolveDeckCommanderCmc } from '@/lib/deck-commander-cmc';
import type { ProfileDirectoryEntry as Profile } from '@/lib/types/profile-directory';
import type { ProfileImportedDeckPreview as ImportedDeckPreview } from '@/lib/types/profile-deck';

/** Owns the existing once-per-profile-opening background import. */
export function useProfileArchidektAutosync(user: { id: string } | null, currentProfile: Profile | null,
  fetchDecks: () => Promise<void>) {
  const archidektAutoImportStartedRef = useRef(false);

  const autoImportArchidektDecks = useCallback(async (username: string) => {
    if (!user) return;
    try {
      const response = await authenticatedFetch('/api/archidekt-user-decks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      if (!response.ok) return;

      const payload = await response.json() as { decks?: ImportedDeckPreview[] };
      const candidates = (payload.decks || []).filter((deck) =>
        deck.sourceType === 'archidekt'
        && deck.sourceUrl
        && !deck.warning
        && !deck.error
        && Boolean(deck.commander?.trim()),
      );
      const rows = [];
      for (const rawDeck of candidates) {
        const deck = await normalizeImportedDeckPreview(rawDeck);
        const commander = getDefaultImportedCommanderOption(deck);
        const colorFields = deckDataToColorFields({
          commanderOptions: deck.commanderOptions || [],
          colorIdentity: deck.colorIdentity || [],
        });
        const commanderCmc = await resolveDeckCommanderCmc(
          { commander: commander.name, commander_options: colorFields.commander_options },
          lookupCommanderCmcInBrowser,
        );
        const commanderImage = await resolveImportedDeckCommanderImageForSave(commander, deck);
        rows.push({
          user_id: user.id,
          group_id: null,
          name: deck.name,
          commander: commander.name,
          commander_image: commanderImage,
          source_url: deck.sourceUrl,
          source_type: 'archidekt',
          bracket: deck.bracket,
          commander_cmc: commanderCmc,
          ...colorFields,
        });
        await delay(SCRYFALL_REQUEST_GAP_MS);
      }
      if (rows.length > 0) {
        const { error } = await supabase.rpc('sync_archidekt_decks', { p_decks: rows });
        if (error) throw error;
        await fetchDecks();
      }
    } catch {
      // Background sync must not interrupt profile use.
    }
  }, [fetchDecks, user]);

  useEffect(() => {
    const username = currentProfile?.archidekt_username?.trim();
    if (!user || !currentProfile?.archidekt_auto_import || !username || archidektAutoImportStartedRef.current) return;
    archidektAutoImportStartedRef.current = true;
    void autoImportArchidektDecks(username);
  }, [autoImportArchidektDecks, currentProfile?.archidekt_auto_import, currentProfile?.archidekt_username, user]);
}
