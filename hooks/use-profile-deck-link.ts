'use client';
import { useState, type Dispatch, type SetStateAction } from 'react';
import { useLanguage } from '@/components/language-provider';
import { useToast } from '@/hooks/use-toast';
import { useProfileCommandScope, type ProfileCommandJob } from '@/hooks/use-profile-command-scope';
import { withRequestDeadline } from '@/packages/data/request-deadline';
import { supabase } from '@/lib/supabase';
import { authenticatedFetch } from '@/lib/authenticated-fetch';
import { deckDataToColorFields, isImportedDeckSource } from '@/lib/deck-importers';
import { resolveDeckCommanderCmc } from '@/lib/deck-commander-cmc';
import { lookupCommanderCmcInBrowser } from '@/lib/commander-cmc-client';
import { getSupabaseErrorMessage } from '@/lib/supabase-errors';
import type { ProfileDeck as Deck, ProfileImportedDeckPreview } from '@/lib/types/profile-deck';

type Scope = ReturnType<typeof useProfileCommandScope>;
type State = { context: Scope['context']; deck: Deck | null; url: string; job: ProfileCommandJob | null };
const empty = (context: Scope['context']): State => ({ context, deck: null, url: '', job: null });

export function useProfileDeckLink(key: string | null, decks: Deck[], setDecks: Dispatch<SetStateAction<Deck[]>>) {
  const { copy: t } = useLanguage();
  const { toast } = useToast();
  const { context, epoch, committed, begin, cancel, pending } = useProfileCommandScope(key, true);
  const [state, setState] = useState<State>(() => empty(context));
  const current = state.context === context ? state : empty(context);
  const savingDeckLink = current.job?.epoch === epoch && current.job.active();
  const update = (action: (previous: State) => State, job?: ProfileCommandJob) => {
    if (!committed() || (job && !job.active())) return;
    setState(previous => !committed() || (job && !job.active()) ? previous
      : action(previous.context === context ? previous : empty(context)));
  };
  const openDeckLink = (deck: Deck) => {
    cancel('save');
    update(() => ({ context, deck: structuredClone(deck), url: deck.source_url || '', job: null }));
  };
  const closeDeckLink = () => { cancel('save'); update(() => empty(context)); };
  const setLinkDeckUrl = (url: string) => {
    if (!pending('save')) update(previous => ({ ...previous, url }));
  };
  const handleLinkDeckToExternalSource = async () => {
    if (!current.deck || !current.url.trim()) return;
    const job = begin('save');
    if (!job) return;
    const deck = structuredClone(current.deck);
    const url = current.url;
    const catalog = structuredClone(decks);
    const assertActive = () => {
      job.signal.throwIfAborted();
      if (!job.active()) throw new DOMException('Operation aborted', 'AbortError');
    };
    update(previous => ({ ...previous, job }), job);
    try {
      const imported = await withRequestDeadline({ abortSignal: async signal => {
        const response = await authenticatedFetch('/api/deck-import', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }), signal,
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error || t({ it: 'Link non valido.', en: 'Invalid link.' }));
        }
        return await response.json() as ProfileImportedDeckPreview;
      } }, 15000, job.signal);
      assertActive();
      if (!isImportedDeckSource(imported.sourceType) || !imported.sourceUrl) {
        throw new Error(t({ it: 'Sono supportati solo Archidekt e Moxfield.', en: 'Only Archidekt and Moxfield are supported.' }));
      }
      if (catalog.some(entry => entry.id !== deck.id && entry.user_id === deck.user_id && entry.source_url === imported.sourceUrl)) {
        throw new Error(t({ it: 'Questa lista e gia collegata a un altro tuo mazzo.', en: 'This list is already linked to another one of your decks.' }));
      }
      const colorFields = deckDataToColorFields({ commanderOptions: imported.commanderOptions || [], colorIdentity: imported.colorIdentity || [] });
      const commanderCmc = await withRequestDeadline({ abortSignal: signal => resolveDeckCommanderCmc(
        { commander: deck.commander, commander_options: colorFields.commander_options },
        name => { signal.throwIfAborted(); return lookupCommanderCmcInBrowser(name, signal); },
      ) }, 15000, job.signal);
      assertActive();
      const payload = { source_url: imported.sourceUrl, source_type: imported.sourceType,
        bracket: imported.bracket, commander_cmc: commanderCmc ?? deck.commander_cmc, ...colorFields };
      const { error } = await withRequestDeadline({ abortSignal: signal => {
        assertActive();
        return supabase.from('decks').update(payload).eq('id', deck.id).abortSignal(signal);
      } }, 15000, job.signal);
      if (error) throw error;
      assertActive();
      setDecks(previous => job.active() ? previous.map(entry => entry.id === deck.id ? { ...entry, ...payload } : entry) : previous);
      update(() => empty(context), job);
      toast({ title: t({ it: 'Lista collegata', en: 'List linked' }), description: t({
        it: 'Il mazzo manterra comandante e nome; da ora puo aggiornarsi dalla sorgente.',
        en: 'The deck keeps its commander and name; it can now refresh from its source.',
      }) });
    } catch (error) {
      if (job.active()) toast({ title: t({ it: 'Errore', en: 'Error' }), description: getSupabaseErrorMessage(error,
        t({ it: 'Impossibile collegare la lista.', en: 'Unable to link the list.' })), variant: 'destructive' });
    } finally {
      update(previous => ({ ...previous, job: null }), job);
      job.finish();
    }
  };
  return { linkingDeck: current.deck, linkDeckUrl: current.url, savingDeckLink,
    openDeckLink, closeDeckLink, setLinkDeckUrl, handleLinkDeckToExternalSource };
}
export type ProfileDeckLinkControls = ReturnType<typeof useProfileDeckLink>;
