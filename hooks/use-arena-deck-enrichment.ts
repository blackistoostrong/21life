'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useCommandScope, type CommandJob } from '@/hooks/use-command-scope';
import { authenticatedFetch } from '@/lib/authenticated-fetch';
import { delay, runTasksWithConcurrency } from '@/lib/async-utils';
import { runWhenIdle } from '@/lib/idle-work';
import { syncDeckCommanderColors } from '@/lib/deck-color-sync';
import { buildArenaColorTargets, persistArenaEnrichment, sameArenaEnrichmentSource, type ArenaColorMatch, type EnrichmentPatch } from '@/lib/arena-deck-enrichment';
import { withRequestDeadline } from '@/packages/data/request-deadline';
import type { Deck } from '@/lib/types/arena-catalog';

type Imported = { name?: unknown; commander?: unknown; commanderImageUrl?: unknown; bracket?: unknown };
const text = (value: unknown, fallback: string) => typeof value === 'string' && value.trim() ? value : fallback;
function assertActive(job: CommandJob) {
  job.signal.throwIfAborted();
  if (!job.active()) throw new DOMException('Operation aborted', 'AbortError');
}
async function importedDeck(deck: Deck, job: CommandJob): Promise<Imported | null> {
  assertActive(job);
  return withRequestDeadline({ abortSignal: async signal => {
    const response = await authenticatedFetch('/api/deck-import', { signal, method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: deck.source_url }) });
    return response.ok ? await response.json() as Imported : null;
  } }, 15000, job.signal);
}

/** Enrichment owns background leases, bounded I/O, per-deck exclusion and acknowledgements. */
export function useArenaDeckEnrichment(userId: string | null, groupId: string, adminMode: boolean, demo: boolean,
  decks: Deck[], overrides: Record<string, string[]>, matches: ArenaColorMatch[],
  setDecks: Dispatch<SetStateAction<Deck[]>>, updateDeckColors: (action: (colors: Record<string, string[]>, decks: Deck[]) => Record<string, string[]>) => void) {
  const key = userId && groupId ? `${userId}:${groupId}:${adminMode}` : null;
  const { epoch, begin, committed } = useCommandScope<'metadata' | 'images' | 'colors'>(key, true);
  const workRef = useRef<{ epoch: typeof epoch; decks: Set<string>; idle: Set<() => void>; images: Promise<void> | null } | null>(null);
  const latest = useRef({ decks, overrides, matches });
  const [colorJob, setColorJob] = useState<CommandJob | null>(null);
  useLayoutEffect(() => { latest.current = { decks, overrides, matches }; }, [decks, overrides, matches]);
  useLayoutEffect(() => {
    const work = { epoch, decks: new Set<string>(), idle: new Set<() => void>(), images: null as Promise<void> | null };
    workRef.current = work;
    return () => { work.idle.forEach(cancel => cancel()); work.idle.clear(); if (workRef.current === work) workRef.current = null; };
  }, [epoch]);
  const getWork = useCallback(() => workRef.current?.epoch === epoch ? workRef.current : null, [epoch]);
  const own = useCallback((deck: Deck) => Boolean(userId && (adminMode || deck.user_id === userId)), [adminMode, userId]);
  const save = useCallback(async (deck: Deck, patch: EnrichmentPatch, job: CommandJob) => {
    assertActive(job);
    const current = latest.current.decks.find(row => row.id === deck.id);
    if (!current || !sameArenaEnrichmentSource(current, deck) || !own(deck)) return;
    if (!await persistArenaEnrichment(deck, patch, job.signal)) return;
    assertActive(job);
    setDecks(rows => job.active() ? rows.map(row => row.id === deck.id && sameArenaEnrichmentSource(row, deck) ? { ...row, ...patch } : row) : rows);
  }, [own, setDecks]);
  const syncMetadata = useCallback(async () => {
    const work = getWork(); if (!work) return;
    const candidates = latest.current.decks.filter(deck => own(deck) && deck.source_url
      && ['archidekt', 'moxfield'].includes(deck.source_type ?? '') && (!deck.bracket || !deck.commander_image)).slice(0, 3);
    if (!candidates.length) return;
    const job = begin('metadata'); if (!job) return;
    try {
      await delay(4000, job.signal);
      for (const deck of candidates) {
        assertActive(job);
        if (work.decks.has(deck.id)) continue;
        work.decks.add(deck.id);
        try {
          const imported = await importedDeck(deck, job); assertActive(job);
          if (!imported) continue;
          const patch: EnrichmentPatch = {};
          if (!deck.bracket && typeof imported.bracket === 'string') patch.bracket = imported.bracket;
          if (!deck.commander_image && typeof imported.commanderImageUrl === 'string' && imported.commanderImageUrl) patch.commander_image = imported.commanderImageUrl;
          if (Object.keys(patch).length) await save(deck, patch, job);
        } catch { assertActive(job); }
        finally { work.decks.delete(deck.id); }
        await delay(200, job.signal);
      }
    } catch { /* Context cancellation ends the background batch. */ }
    finally { job.finish(); }
  }, [begin, getWork, own, save]);
  const refreshMissingImportedDeckImages = useCallback(async (ids: string[]) => {
    const work = getWork();
    if (!work || !committed()) throw new DOMException('Operation aborted', 'AbortError');
    if (work.images) return work.images;
    const candidates = Array.from(new Set(ids)).map(id => latest.current.decks.find(deck => deck.id === id))
      .filter((deck): deck is Deck => Boolean(deck && own(deck) && !deck.commander_image && deck.commander
        && ((['archidekt', 'moxfield'].includes(deck.source_type ?? '') && deck.source_url) || demo))).slice(0, 3);
    if (!candidates.length) return;
    const job = begin('images'); if (!job) return;
    const run = async () => {
      try {
        await runTasksWithConcurrency(candidates, 2, async deck => {
          assertActive(job);
          if (work.decks.has(deck.id)) return;
          work.decks.add(deck.id);
          try {
            let patch: EnrichmentPatch;
            if (['archidekt', 'moxfield'].includes(deck.source_type ?? '') && deck.source_url) {
              const imported = await importedDeck(deck, job); assertActive(job);
              if (!imported || typeof imported.commanderImageUrl !== 'string' || !imported.commanderImageUrl) return;
              patch = { name: text(imported.name, deck.name), commander: text(imported.commander, deck.commander),
                commander_image: imported.commanderImageUrl, bracket: typeof imported.bracket === 'string' ? imported.bracket : deck.bracket };
            } else {
              const payload = await withRequestDeadline({ abortSignal: async signal => {
                const response = await authenticatedFetch(`/api/scryfall-card-arts?name=${encodeURIComponent(deck.commander)}`, { signal });
                return response.ok ? await response.json() as { data?: Array<{ imageUrl?: string }> } : null;
              } }, 15000, job.signal);
              assertActive(job);
              const image = payload?.data?.[0]?.imageUrl; if (!image) return;
              patch = { commander_image: image };
            }
            await save(deck, patch, job);
          } catch { assertActive(job); }
          finally { work.decks.delete(deck.id); }
        });
        assertActive(job);
      } finally { job.finish(); }
    };
    const flight = run(); work.images = flight;
    try { await flight; } finally { if (work.images === flight) work.images = null; }
  }, [begin, committed, demo, getWork, own, save]);
  const ensureArenaDeckColors = useCallback(async (ids: string[], history?: ArenaColorMatch[]) => {
    const snapshot = latest.current;
    const targets = buildArenaColorTargets(ids, snapshot.decks, snapshot.overrides, history ?? snapshot.matches).slice(0, 5);
    if (!targets.length) return;
    const job = begin('colors'); if (!job) return;
    setColorJob(job);
    try {
      const resolved = await withRequestDeadline({ abortSignal: signal => syncDeckCommanderColors(targets, snapshot.overrides, 5, signal) }, 15000, job.signal);
      assertActive(job);
      updateDeckColors((current, currentDecks) => {
        if (!job.active()) return current;
        const now = latest.current;
        const eligible = buildArenaColorTargets(ids, currentDecks, {}, history ?? now.matches);
        const next = { ...current };
        resolved.forEach((colors, id) => {
          const before = targets.find(deck => deck.id === id), after = eligible.find(deck => deck.id === id);
          if (!current[id]?.length && before && after && before.commander === after.commander && before.source_url === after.source_url && before.source_type === after.source_type) next[id] = colors;
        });
        return next;
      });
    } catch { /* Keep existing colors when background lookup fails or is cancelled. */ }
    finally { if (job.active()) setColorJob(current => current === job && job.active() ? null : current); job.finish(); }
  }, [begin, updateDeckColors]);
  const scheduleArenaDeckColors = useCallback((ids: string[], timeoutMs: number, history?: ArenaColorMatch[]) => {
    const work = getWork();
    if (!work || !committed()) return () => {};
    const cancel = runWhenIdle(async () => { work.idle.delete(cancel); await ensureArenaDeckColors(ids, history); }, { timeoutMs });
    work.idle.add(cancel);
    return () => { cancel(); work.idle.delete(cancel); };
  }, [committed, ensureArenaDeckColors, getWork]);
  useEffect(() => {
    if (!decks.length) return;
    return runWhenIdle(syncMetadata, { timeoutMs: 8000 });
  }, [decks, syncMetadata]);
  useEffect(() => {
    if (!decks.length) return;
    return runWhenIdle(() => refreshMissingImportedDeckImages(decks.map(deck => deck.id)).catch(() => {}), { timeoutMs: 6000 });
  }, [decks, refreshMissingImportedDeckImages]);
  return { refreshMissingImportedDeckImages, scheduleArenaDeckColors, syncingDeckColors: colorJob?.epoch === epoch && colorJob.active() };
}
