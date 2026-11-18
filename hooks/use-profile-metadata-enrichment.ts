'use client';

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { supabase } from '@/lib/supabase';
import { authenticatedFetch } from '@/lib/authenticated-fetch';
import { withRequestDeadline } from '@/packages/data/request-deadline';
import { delay } from '@/lib/async-utils';
import { runWhenIdle } from '@/lib/idle-work';
import { buildDeckColorFields, deckHasColorIdentity, getCommanderOptions } from '@/lib/deck-metadata';
import { deckDataToColorFields, isImportedDeckSource, type CommanderOption } from '@/lib/deck-importers';
import { buildDeckCommanderCmcFromCmcs, deckNeedsCommanderCmc } from '@/lib/deck-commander-cmc';
import { collectUniqueCommanderNames } from '@/lib/deck-collection-analytics';
import type { ProfileDeck as Deck, ProfileImportedDeckPreview as ImportedDeckPreview } from '@/lib/types/profile-deck';

const SCRYFALL_REQUEST_GAP_MS = 120;

type Context = { key: string | null };
type Job = { controller: AbortController; detach: () => void };
type Scheduled = { cancel: () => void; detach: () => void };
type Owner = { context: Context; paused: boolean; metadata: Job | null; cmc: Job | null; idle: Scheduled | null };
type JobKind = 'metadata' | 'cmc';

function startJob(owner: Owner, kind: JobKind, signal?: AbortSignal): Job | null {
  if (!owner.context.key || owner.paused || signal?.aborted || (owner[kind] && !owner[kind].controller.signal.aborted)) return null;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const job = { controller, detach: () => signal?.removeEventListener('abort', abort) };
  owner[kind] = job;
  return job;
}

function finishJob(owner: Owner, kind: JobKind, job: Job) {
  job.detach();
  if (owner[kind] === job) owner[kind] = null;
}

function cancelIdle(owner: Owner) {
  owner.idle?.cancel();
  owner.idle?.detach();
  owner.idle = null;
}

async function postMetadata(url: string, body: unknown, signal: AbortSignal) {
  return withRequestDeadline({ abortSignal: async deadline => {
    const response = await authenticatedFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: deadline });
    return { ok: response.ok, payload: response.ok ? await response.json() as unknown : null };
  } }, 15_000, signal, 'Metadata request timed out');
}

/** Owns scoped background jobs; navigation, pause and catalog replacement cancel their work. */
export function useProfileMetadataEnrichment(
  decks: Deck[], setDecks: Dispatch<SetStateAction<Deck[]>>, paused: boolean,
  resolveCommanderColorOptions: (commander: string, options: CommanderOption[], signal?: AbortSignal) => Promise<CommanderOption[]>,
  contextKey: string | null,
) {
  const context = useMemo<Context>(() => ({ key: contextKey }), [contextKey]);
  const ownerRef = useRef<Owner | null>(null);
  const decksRef = useRef<Deck[]>([]);
  const [progress, setProgress] = useState<{ context: Context; job: Job } | null>(null);

  useLayoutEffect(() => {
    const owner: Owner = { context, paused, metadata: null, cmc: null, idle: null };
    ownerRef.current = owner;
    return () => {
      cancelIdle(owner);
      owner.metadata?.controller.abort();
      owner.cmc?.controller.abort();
      if (ownerRef.current === owner) ownerRef.current = null;
    };
  }, [context, paused]);
  useLayoutEffect(() => { decksRef.current = decks; }, [decks]);

  const syncMissingDeckMetadata = useCallback(async (loadedDecks: Deck[], signal?: AbortSignal) => {
    const owner = ownerRef.current;
    if (owner?.context !== context) return;

    const MAX_AUTO_SYNC_DECKS = 3;
    const decksToSync = loadedDecks.filter((deck) => {
      const needsColors = !deckHasColorIdentity(deck);
      const needsBracket = isImportedDeckSource(deck.source_type) && !!deck.source_url && !deck.bracket;
      return needsColors || needsBracket;
    }).slice(0, MAX_AUTO_SYNC_DECKS);

    if (decksToSync.length === 0) return;

    const job = startJob(owner, 'metadata', signal);
    if (!job) return;
    const jobSignal = job.controller.signal;
    const active = () => ownerRef.current === owner && !jobSignal.aborted;

    try {
      await delay(4000, jobSignal);
      if (!active()) return;

      const successfulUpdates: Array<Partial<Deck> & { id: string }> = [];

      for (const deck of decksToSync) {
        if (!active()) break;

        try {
          const updatePayload: Partial<Deck> = {};
          const needsColors = !deckHasColorIdentity(deck);
          const needsBracket = isImportedDeckSource(deck.source_type) && !!deck.source_url && !deck.bracket;

          if (needsColors || needsBracket) {
            if (isImportedDeckSource(deck.source_type) && deck.source_url) {
              const response = await postMetadata('/api/deck-import', { url: deck.source_url }, jobSignal);

              if (response.ok) {
                const imported = response.payload as ImportedDeckPreview & { colorIdentity?: string[] };
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
                getCommanderOptions(deck),
                jobSignal
              );
              const colorFields = buildDeckColorFields(commanderOptions);
              if (deckHasColorIdentity(colorFields)) {
                updatePayload.color_identity = colorFields.color_identity ?? null;
                updatePayload.commander_options = colorFields.commander_options ?? null;
              }
            }
          }

          if (Object.keys(updatePayload).length === 0) continue;

          if (!active()) return;
          const { error } = await withRequestDeadline(supabase.from('decks').update(updatePayload).eq('id', deck.id),
            15_000, jobSignal, 'Metadata update timed out');
          if (!active()) return;

          if (!error) {
            successfulUpdates.push({ id: deck.id, ...updatePayload });
          }
        } catch {
          // Keep syncing the remaining decks.
        }

        await delay(SCRYFALL_REQUEST_GAP_MS, jobSignal);
      }

      if (active() && successfulUpdates.length > 0) {
        setDecks((currentDecks) => currentDecks.map((deck) => {
          const update = successfulUpdates.find((item) => item.id === deck.id);
          return update ? { ...deck, ...update } : deck;
        }));
      }
    } catch (error) {
      if (active()) console.error('Profile metadata enrichment failed', error);
    } finally {
      finishJob(owner, 'metadata', job);
    }
  }, [context, resolveCommanderColorOptions, setDecks]);

  const syncMissingCommanderCmc = useCallback(async (signal?: AbortSignal) => {
    const owner = ownerRef.current;
    if (owner?.context !== context) return;
    const job = startJob(owner, 'cmc', signal);
    if (!job) return;
    const jobSignal = job.controller.signal;
    const active = () => ownerRef.current === owner && !jobSignal.aborted;

    const MAX_BATCH_DECKS = 6;
    const MAX_ROUNDS = 24;

    setProgress({ context, job });

    try {
      let stalledRounds = 0;

      for (let round = 0; round < MAX_ROUNDS; round += 1) {
        if (!active()) break;

        const decksNeedingCmc = decksRef.current.filter((deck) => deckNeedsCommanderCmc(deck));
        if (decksNeedingCmc.length === 0) break;

        const batch = decksNeedingCmc.slice(0, MAX_BATCH_DECKS);
        const commanderNames = collectUniqueCommanderNames(batch);
        if (commanderNames.length === 0) break;

        const response = await postMetadata('/api/scryfall-commander-cmc', { names: commanderNames }, jobSignal);

        if (!response.ok) {
          stalledRounds += 1;
          if (stalledRounds >= 2) break;
          await delay(600, jobSignal);
          continue;
        }

        const payload = response.payload as { cmcs?: Record<string, number | null> };
        const commanderCmcs = payload.cmcs || {};
        const successfulUpdates: Array<{ id: string; commander_cmc: number }> = [];

        for (const deck of batch) {
          const commanderCmc = buildDeckCommanderCmcFromCmcs(deck, commanderCmcs);
          if (commanderCmc == null) continue;

          if (!active()) return;
          const { error } = await withRequestDeadline(supabase.from('decks').update({ commander_cmc: commanderCmc }).eq('id', deck.id),
            15_000, jobSignal, 'Metadata update timed out');
          if (!active()) return;

          if (!error) {
            successfulUpdates.push({ id: deck.id, commander_cmc: commanderCmc });
          } else {
            console.error('Failed to persist commander_cmc for deck', deck.id, error);
          }
        }

        if (successfulUpdates.length === 0) {
          stalledRounds += 1;
          if (stalledRounds >= 2) break;
          await delay(600, jobSignal);
          continue;
        }

        stalledRounds = 0;
        setDecks((currentDecks) => currentDecks.map((deck) => {
          const update = successfulUpdates.find((item) => item.id === deck.id);
          return update ? { ...deck, commander_cmc: update.commander_cmc } : deck;
        }));

        await delay(SCRYFALL_REQUEST_GAP_MS, jobSignal);
      }
    } catch (error) {
      if (active()) console.error('Profile CMC enrichment failed', error);
    } finally {
      const current = ownerRef.current === owner && owner.cmc === job;
      finishJob(owner, 'cmc', job);
      if (current) setProgress(value => value?.job === job ? null : value);
    }
  }, [context, setDecks]);

  const commanderCmcSyncInProgress = Boolean(progress?.context === context && !paused && !progress.job.controller.signal.aborted);
  const scheduleEnrichment = useCallback((loadedDecks: Deck[], signal: AbortSignal) => {
    const owner = ownerRef.current;
    if (owner?.context !== context || owner.paused || signal.aborted) return;
    cancelIdle(owner);
    let cancel = () => {};
    const abort = () => { if (owner.idle === scheduled) cancelIdle(owner); };
    const scheduled: Scheduled = { cancel: () => cancel(), detach: () => signal.removeEventListener('abort', abort) };
    owner.idle = scheduled;
    signal.addEventListener('abort', abort, { once: true });
    cancel = runWhenIdle(() => {
      scheduled.detach();
      if (owner.idle !== scheduled) return;
      owner.idle = null;
      if (ownerRef.current !== owner || signal.aborted) return;
      void syncMissingDeckMetadata(loadedDecks, signal).finally(() => { void syncMissingCommanderCmc(signal); });
    }, { timeoutMs: 6000 });
  }, [context, syncMissingCommanderCmc, syncMissingDeckMetadata]);

  return { scheduleEnrichment, commanderCmcSyncInProgress };
}
