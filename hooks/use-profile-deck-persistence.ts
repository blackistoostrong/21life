'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useLanguage } from '@/components/language-provider';
import { useToast } from '@/hooks/use-toast';
import { useProfileCommandScope, type ProfileCommandJob } from '@/hooks/use-profile-command-scope';
import { supabase } from '@/lib/supabase';
import { getSupabaseErrorMessage } from '@/lib/supabase-errors';
import { delay } from '@/lib/async-utils';
import { deckDataToColorFields, getDefaultImportedCommanderOption } from '@/lib/deck-importers';
import { resolveDeckCommanderCmc } from '@/lib/deck-commander-cmc';
import { lookupCommanderCmcInBrowser } from '@/lib/commander-cmc-client';
import { SCRYFALL_REQUEST_GAP_MS, resolveImportedDeckCommanderImageForSave, manualDeckColorFields } from '@/lib/profile-commander';
import { withRequestDeadline } from '@/packages/data/request-deadline';
import type { CommanderSearchResult, ImportedCommanderOption } from '@/lib/profile-commander';
import type { ProfileDeck as Deck, ProfileImportedDeckPreview as ImportedDeckPreview } from '@/lib/types/profile-deck';

type Input = {
  scopeKey: string | null; open: boolean; mode: string;
  user: { id: string } | null; adminMode: boolean; decks: Deck[];
  getTargetProfileId: () => string | null; getTargetProfileName: () => string | null;
  importedDeck: ImportedDeckPreview | null; selectedImportedCommander: ImportedCommanderOption | null;
  importedUserDecks: ImportedDeckPreview[]; selectedUserDeckUrls: string[];
  selectedUserDeckCommanders: Record<string, ImportedCommanderOption>;
  selectedCommander: CommanderSearchResult | null; selectedPartnerCommander: CommanderSearchResult | null;
  customDeckName: string; closeAddModal: () => void; fetchDecks: () => Promise<void>;
  freezeManualSelection: () => void;
};
type Scope = ReturnType<typeof useProfileCommandScope>;
type Kind = 'single' | 'bulk';
type Choice = 'overwrite' | 'skip' | 'cancel';
type Confirmation = { kind: 'single' } | { kind: 'bulk'; count: number };
type State = { context: Scope['context']; job: ProfileCommandJob | null; kind: Kind; confirm: Confirmation | null };
type Write = { abortSignal: (signal: AbortSignal) => PromiseLike<{ error: unknown }> };
const empty = (context: Scope['context']): State => ({ context, job: null, kind: 'single', confirm: null });

/** One owned command includes confirmation, metadata and persistence, not just HTTP. */
export function useProfileDeckPersistence(input: Input) {
  const { copy: t } = useLanguage();
  const { toast } = useToast();
  const targetId = input.getTargetProfileId();
  const key = input.scopeKey ? `${input.scopeKey}:${targetId || ''}:${input.mode}` : null;
  // Equivalent optional-art acknowledgments may allocate a new object. Only a
  // change in the active draft's values supersedes the submitted snapshot.
  const draft = useMemo(() => JSON.stringify(input.mode === 'import-url'
    ? { deck: input.importedDeck, selected: input.selectedImportedCommander }
    : input.mode === 'archidekt-user'
      ? { decks: input.importedUserDecks, urls: input.selectedUserDeckUrls, selections: input.selectedUserDeckCommanders }
      : { primary: input.selectedCommander, partner: input.selectedPartnerCommander, name: input.customDeckName }),
  [input.mode, input.importedDeck, input.selectedImportedCommander, input.importedUserDecks, input.selectedUserDeckUrls,
    input.selectedUserDeckCommanders, input.selectedCommander, input.selectedPartnerCommander, input.customDeckName]);
  const ready = input.mode === 'import-url' ? Boolean(input.importedDeck)
    : input.mode === 'archidekt-user' ? Boolean(input.importedUserDecks.length) : input.mode === 'manual' && Boolean(input.selectedCommander);
  const { context, epoch, committed, begin } = useProfileCommandScope(key,
    input.open && ready && Boolean(targetId), draft);
  const [state, setState] = useState<State>(() => empty(context));
  const current = state.context === context ? state : empty(context);
  const waiter = useRef<{ job: ProfileCommandJob; settle: (choice: Choice) => void } | null>(null);
  const update = useCallback((action: (previous: State) => State, job: ProfileCommandJob) => {
    if (!committed() || !job.active()) return;
    setState(previous => !committed() || !job.active() ? previous : action(previous.context === context ? previous : empty(context)));
  }, [committed, context]);
  const confirm = (job: ProfileCommandJob, value: Confirmation): Promise<Choice> => {
    if (!job.active()) return Promise.resolve('cancel');
    return new Promise(resolve => {
      const abort = () => entry.settle('cancel');
      const entry = { job, settle: (choice: Choice) => {
        if (waiter.current !== entry) return;
        waiter.current = null;
        job.signal.removeEventListener('abort', abort);
        update(previous => ({ ...previous, confirm: null }), job);
        resolve(choice);
      } };
      waiter.current = entry;
      job.signal.addEventListener('abort', abort, { once: true });
      update(previous => ({ ...previous, confirm: value }), job);
    });
  };
  const closeOverwriteConfirm = (value: boolean | Choice) => {
    const entry = waiter.current;
    if (!entry || entry.job !== current.job || !entry.job.active()) return;
    entry.settle(value === true || value === 'overwrite' ? 'overwrite' : value === 'skip' ? 'skip' : 'cancel');
  };
  const execute = async (kind: Kind, action: (job: ProfileCommandJob) => Promise<void>) => {
    const job = begin('save');
    if (!job) return;
    update(previous => ({ ...previous, job, kind, confirm: null }), job);
    try { await action(job); }
    catch (error) {
      if (job.active()) toast({ title: t({ it: 'Errore', en: 'Error' }),
        description: getSupabaseErrorMessage(error, kind === 'bulk'
          ? t({ it: 'Salvataggio mazzi non riuscito', en: 'Failed to save decks' })
          : t({ it: 'Salvataggio mazzo non riuscito', en: 'Failed to save deck' })), variant: 'destructive' });
    } finally {
      update(previous => ({ ...previous, job: null, confirm: null }), job);
      job.finish();
    }
  };
  const persist = async (request: Write, job: ProfileCommandJob) => {
    if (!job.active()) throw Object.assign(new Error('Operation aborted'), { name: 'AbortError' });
    const { error } = await withRequestDeadline(request, 15000, job.signal);
    if (error) throw error;
  };
  const acknowledge = (job: ProfileCommandJob, title: string, description: string) => {
    if (!job.active()) return;
    toast({ title, description });
    input.closeAddModal();
    void input.fetchDecks();
  };
  const prepareImported = (deck: ImportedDeckPreview, selected: ImportedCommanderOption, name: string,
    preserveImage: string | null | undefined, job: ProfileCommandJob) => withRequestDeadline({ abortSignal: async signal => {
    const colorFields = deckDataToColorFields({ commanderOptions: deck.commanderOptions || [], colorIdentity: deck.colorIdentity || [] });
    const cmc = await resolveDeckCommanderCmc({ commander: name, commander_options: colorFields.commander_options },
      value => lookupCommanderCmcInBrowser(value, signal));
    const image = await resolveImportedDeckCommanderImageForSave(selected, deck, preserveImage, signal);
    signal.throwIfAborted();
    return { name: deck.name, commander: name, commander_image: image, source_url: deck.sourceUrl,
      source_type: deck.sourceType, bracket: deck.bracket, commander_cmc: cmc, ...colorFields };
  } }, 15000, job.signal);

  const saveArchidektDeck = async () => {
    if (!input.importedDeck || !targetId) return;
    await execute('single', async job => {
      const deck = structuredClone(input.importedDeck!);
      const selected = structuredClone(input.selectedImportedCommander || getDefaultImportedCommanderOption(deck));
      const existing = input.decks.find(value => value.user_id === targetId && value.source_url === deck.sourceUrl);
      const existingId = existing?.id; const existingImage = existing?.commander_image;
      const targetName = input.getTargetProfileName();
      if (existingId && await confirm(job, { kind: 'single' }) !== 'overwrite') return;
      if (!job.active()) return;
      const payload = await prepareImported(deck, selected, selected.name || deck.commander, existingImage, job);
      await persist(existingId ? supabase.from('decks').update(payload).eq('id', existingId)
        : supabase.from('decks').insert({ user_id: targetId, group_id: null, ...payload }), job);
      acknowledge(job, t({ it: existingId ? 'Mazzo aggiornato!' : 'Mazzo aggiunto!', en: existingId ? 'Deck updated!' : 'Deck added!' }),
        input.adminMode && targetName ? `${deck.name} - ${targetName}` : deck.name);
    });
  };
  const saveArchidektUserDecks = async () => {
    if (!targetId || !input.importedUserDecks.length) return;
    await execute('bulk', async job => {
      const selectedDecks = structuredClone(input.importedUserDecks.filter(deck => input.selectedUserDeckUrls.includes(deck.sourceUrl)));
      const selections = structuredClone(input.selectedUserDeckCommanders);
      const existingByUrl = new Map(input.decks.filter(deck => deck.user_id === targetId && deck.source_url)
        .map(deck => [deck.source_url!, { id: deck.id, commander_image: deck.commander_image }]));
      const duplicateCount = selectedDecks.filter(deck => existingByUrl.has(deck.sourceUrl)).length;
      const choice = duplicateCount ? await confirm(job, { kind: 'bulk', count: duplicateCount }) : 'skip';
      if (choice === 'cancel' || !job.active()) return;
      const inserts = [];
      const updates = [];
      for (const deck of selectedDecks) {
        if (!job.active()) return;
        const existing = existingByUrl.get(deck.sourceUrl);
        if (existing && choice !== 'overwrite') continue;
        const selected = selections[deck.sourceUrl] || getDefaultImportedCommanderOption(deck);
        const payload = await prepareImported(deck, selected, selected.name, existing?.commander_image, job);
        if (existing) updates.push({ id: existing.id, payload });
        else inserts.push({ user_id: targetId, group_id: null, ...payload });
        await delay(SCRYFALL_REQUEST_GAP_MS, job.signal);
      }
      if (!job.active()) return;
      if (!inserts.length && !updates.length) {
        toast({ title: t({ it: 'Nessun nuovo mazzo', en: 'No new decks' }),
          description: t({ it: 'I mazzi pubblici trovati sono gia presenti in quel profilo.', en: 'The public decks found are already saved in that profile.' }) });
        return;
      }
      if (targetId === input.user?.id) {
        await persist(supabase.rpc('sync_archidekt_decks', { p_decks: [...inserts, ...updates.map(entry => entry.payload)] }), job);
      } else {
        // Preserve the existing administrator path; each transmitted write can
        // commit independently. Client cancellation does not roll back SQL.
        if (inserts.length) await persist(supabase.from('decks').insert(inserts), job);
        for (const entry of updates) await persist(supabase.from('decks').update(entry.payload).eq('id', entry.id), job);
      }
      acknowledge(job, t({ it: 'Mazzi importati!', en: 'Decks imported!' }), t({
        it: updates.length ? `${inserts.length} aggiunti · ${updates.length} aggiornati`
          : `${inserts.length} ${inserts.length === 1 ? 'mazzo aggiunto' : 'mazzi aggiunti'} al profilo.`,
        en: updates.length ? `${inserts.length} added · ${updates.length} updated`
          : `${inserts.length} ${inserts.length === 1 ? 'deck added' : 'decks added'} to your profile.`,
      }));
    });
  };
  const saveManualDeck = async () => {
    if (!input.selectedCommander || !targetId) return;
    await execute('single', async job => {
      input.freezeManualSelection();
      const primary = structuredClone(input.selectedCommander!);
      const partner = structuredClone(input.selectedPartnerCommander);
      const displayName = partner ? `${primary.name} // ${partner.name}` : primary.name;
      const name = input.customDeckName || displayName;
      const targetName = input.getTargetProfileName();
      const colorFields = manualDeckColorFields(primary, partner);
      const cmc = await withRequestDeadline({ abortSignal: async signal => {
        const value = await resolveDeckCommanderCmc({ commander: displayName, commander_options: colorFields.commander_options },
          commander => lookupCommanderCmcInBrowser(commander, signal));
        signal.throwIfAborted(); return value;
      } }, 15000, job.signal);
      await persist(supabase.from('decks').insert({ user_id: targetId, group_id: null, name,
        commander: displayName, commander_image: primary.imageUrl, source_url: null, source_type: 'manual',
        bracket: null, commander_cmc: cmc, ...colorFields }), job);
      acknowledge(job, t({ it: 'Mazzo creato!', en: 'Deck created!' }), input.adminMode && targetName ? `${name} - ${targetName}` : name);
    });
  };
  const visible = current.job?.epoch === epoch && current.job.active();
  return { savingDeck: visible && current.kind === 'single', savingUserDecks: visible && current.kind === 'bulk',
    overwriteConfirm: visible ? current.confirm : null, closeOverwriteConfirm,
    saveArchidektDeck, saveArchidektUserDecks, saveManualDeck };
}
export type ProfileDeckPersistenceControls = ReturnType<typeof useProfileDeckPersistence>;
