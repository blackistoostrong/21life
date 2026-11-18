'use client';

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { supabase } from '@/lib/supabase';
import { authenticatedFetch } from '@/lib/authenticated-fetch';
import { delay } from '@/lib/async-utils';
import { buildDeckColorFields, deckHasColorIdentity, getCommanderOptions } from '@/lib/deck-metadata';
import { deckDataToColorFields, isImportedDeckSource, type CommanderOption } from '@/lib/deck-importers';
import { buildDeckCommanderCmcFromCmcs, deckNeedsCommanderCmc } from '@/lib/deck-commander-cmc';
import { collectUniqueCommanderNames } from '@/lib/deck-collection-analytics';
import type { ProfileDeck as Deck, ProfileImportedDeckPreview as ImportedDeckPreview } from '@/lib/types/profile-deck';

const SCRYFALL_REQUEST_GAP_MS = 120;

/** Owns background metadata batches and progress; catalog owns the collection. */
export function useProfileMetadataEnrichment(
  decks: Deck[], setDecks: Dispatch<SetStateAction<Deck[]>>, paused: boolean,
  resolveCommanderColorOptions: (commander: string, options: CommanderOption[]) => Promise<CommanderOption[]>,
) {
  const deckMetadataSyncAbortRef = useRef(false);
  const deckMetadataSyncInFlightRef = useRef(false);
  const commanderCmcSyncInFlightRef = useRef(false);
  const decksRef = useRef<Deck[]>([]);
  const [commanderCmcSyncInProgress, setCommanderCmcSyncInProgress] = useState(false);

  useEffect(() => {
    deckMetadataSyncAbortRef.current = paused;
  }, [paused]);

  useEffect(() => {
    decksRef.current = decks;
  }, [decks]);

  const syncMissingDeckMetadata = useCallback(async (loadedDecks: Deck[]) => {
    if (deckMetadataSyncInFlightRef.current) return;

    const MAX_AUTO_SYNC_DECKS = 3;
    const decksToSync = loadedDecks.filter((deck) => {
      const needsColors = !deckHasColorIdentity(deck);
      const needsBracket = isImportedDeckSource(deck.source_type) && !!deck.source_url && !deck.bracket;
      return needsColors || needsBracket;
    }).slice(0, MAX_AUTO_SYNC_DECKS);

    if (decksToSync.length === 0) return;

    deckMetadataSyncInFlightRef.current = true;
    deckMetadataSyncAbortRef.current = false;

    try {
      await delay(4000);
      if (deckMetadataSyncAbortRef.current) return;

      const successfulUpdates: Array<Partial<Deck> & { id: string }> = [];

      for (const deck of decksToSync) {
        if (deckMetadataSyncAbortRef.current) break;

        try {
          const updatePayload: Partial<Deck> = {};
          const needsColors = !deckHasColorIdentity(deck);
          const needsBracket = isImportedDeckSource(deck.source_type) && !!deck.source_url && !deck.bracket;

          if (needsColors || needsBracket) {
            if (isImportedDeckSource(deck.source_type) && deck.source_url) {
              const response = await authenticatedFetch('/api/deck-import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: deck.source_url }),
              });

              if (response.ok) {
                const imported = await response.json() as ImportedDeckPreview & { colorIdentity?: string[] };
                const bracket = typeof imported.bracket === 'string' ? imported.bracket : null;
                const colorFields = deckDataToColorFields({
                  commanderOptions: imported.commanderOptions || [],
                  colorIdentity: imported.colorIdentity || [],
                });

                if (!deck.bracket && bracket) updatePayload.bracket = bracket;
                if (needsColors && deckHasColorIdentity(colorFields)) {
                  updatePayload.color_identity = colorFields.color_identity ?? null;
                  updatePayload.commander_options = colorFields.commander_options ?? null;
                }
              }
            } else if (needsColors && deck.commander.trim()) {
              const commanderOptions = await resolveCommanderColorOptions(
                deck.commander,
                getCommanderOptions(deck)
              );
              const colorFields = buildDeckColorFields(commanderOptions);
              if (deckHasColorIdentity(colorFields)) {
                updatePayload.color_identity = colorFields.color_identity ?? null;
                updatePayload.commander_options = colorFields.commander_options ?? null;
              }
            }
          }

          if (Object.keys(updatePayload).length === 0) continue;

          const { error } = await supabase
            .from('decks')
            .update(updatePayload)
            .eq('id', deck.id);

          if (!error) {
            successfulUpdates.push({ id: deck.id, ...updatePayload });
          }
        } catch {
          // Keep syncing the remaining decks.
        }

        await delay(SCRYFALL_REQUEST_GAP_MS);
      }

      if (!deckMetadataSyncAbortRef.current && successfulUpdates.length > 0) {
        setDecks((currentDecks) => currentDecks.map((deck) => {
          const update = successfulUpdates.find((item) => item.id === deck.id);
          return update ? { ...deck, ...update } : deck;
        }));
      }
    } finally {
      deckMetadataSyncInFlightRef.current = false;
    }
  }, [resolveCommanderColorOptions, setDecks]);

  const syncMissingCommanderCmc = useCallback(async () => {
    if (commanderCmcSyncInFlightRef.current || deckMetadataSyncAbortRef.current) return;

    const MAX_BATCH_DECKS = 6;
    const MAX_ROUNDS = 24;

    commanderCmcSyncInFlightRef.current = true;
    setCommanderCmcSyncInProgress(true);

    try {
      let stalledRounds = 0;

      for (let round = 0; round < MAX_ROUNDS; round += 1) {
        if (deckMetadataSyncAbortRef.current) break;

        const decksNeedingCmc = decksRef.current.filter((deck) => deckNeedsCommanderCmc(deck));
        if (decksNeedingCmc.length === 0) break;

        const batch = decksNeedingCmc.slice(0, MAX_BATCH_DECKS);
        const commanderNames = collectUniqueCommanderNames(batch);
        if (commanderNames.length === 0) break;

        const response = await authenticatedFetch('/api/scryfall-commander-cmc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ names: commanderNames }),
        });

        if (!response.ok) {
          stalledRounds += 1;
          if (stalledRounds >= 2) break;
          await delay(600);
          continue;
        }

        const payload = await response.json() as { cmcs?: Record<string, number | null> };
        const commanderCmcs = payload.cmcs || {};
        const successfulUpdates: Array<{ id: string; commander_cmc: number }> = [];

        for (const deck of batch) {
          const commanderCmc = buildDeckCommanderCmcFromCmcs(deck, commanderCmcs);
          if (commanderCmc == null) continue;

          const { error } = await supabase
            .from('decks')
            .update({ commander_cmc: commanderCmc })
            .eq('id', deck.id);

          if (!error) {
            successfulUpdates.push({ id: deck.id, commander_cmc: commanderCmc });
          } else {
            console.error('Failed to persist commander_cmc for deck', deck.id, error);
          }
        }

        if (successfulUpdates.length === 0) {
          stalledRounds += 1;
          if (stalledRounds >= 2) break;
          await delay(600);
          continue;
        }

        stalledRounds = 0;
        setDecks((currentDecks) => currentDecks.map((deck) => {
          const update = successfulUpdates.find((item) => item.id === deck.id);
          return update ? { ...deck, commander_cmc: update.commander_cmc } : deck;
        }));

        await delay(SCRYFALL_REQUEST_GAP_MS);
      }
    } finally {
      commanderCmcSyncInFlightRef.current = false;
      setCommanderCmcSyncInProgress(false);
    }
  }, [setDecks]);

  return { syncMissingDeckMetadata, syncMissingCommanderCmc, commanderCmcSyncInProgress };
}
