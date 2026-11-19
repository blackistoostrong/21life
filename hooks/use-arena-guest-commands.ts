'use client';
import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useCommandScope, type CommandJob } from '@/hooks/use-command-scope';
import { useLanguage } from '@/components/language-provider';
import { saveArenaGuestDeck, deleteArenaGuest } from '@/lib/arena-guest-write';
import { normalizeGuestName, toGuestParticipantKey, type ParticipantKey } from '@/lib/participant-keys';
import { getSupabaseErrorMessage } from '@/lib/supabase-errors';
import type { ArenaGuest } from '@/lib/arena-participants';
import type { CommanderSearchResult } from '@/lib/scryfall';

type Mode = 'pick-existing' | 'create' | 'manage-create' | 'add-deck';
type Draft = {
  epoch: CommandJob['epoch']; opening: number; mode: Mode; targetId: string | null;
  name: string; deckName: string; commander: CommanderSearchResult | null; partner: CommanderSearchResult | null;
};
type Inputs = {
  userId: string | null; adminMode: boolean; groupId: string; guests: ArenaGuest[]; canManageGroup: boolean;
  reloadGuests: () => Promise<unknown>; refreshMatches: () => Promise<unknown>;
  setSelectedParticipantKeys: Dispatch<SetStateAction<ParticipantKey[]>>;
  setParticipantDecks: Dispatch<SetStateAction<Record<string, string>>>;
  updateDeckColors: (action: (previous: Record<string, string[]>) => Record<string, string[]>) => void;
  setWinnerKey: Dispatch<SetStateAction<ParticipantKey | ''>>;
  toggleParticipantSelection: (key: ParticipantKey) => void;
};
function assertActive(job: CommandJob) {
  job.signal.throwIfAborted();
  if (!job.active()) throw new DOMException('Operation aborted', 'AbortError');
}

/** One owner for guest drafts, scoped private commands and acknowledged selection updates. */
export function useArenaGuestCommands({ userId, adminMode, groupId, guests, canManageGroup, reloadGuests, refreshMatches,
  setSelectedParticipantKeys, setParticipantDecks, updateDeckColors, setWinnerKey, toggleParticipantSelection }: Inputs) {
  const { toast } = useToast();
  const { copy: t } = useLanguage();
  const key = userId && groupId ? JSON.stringify([userId, groupId, adminMode, canManageGroup]) : null;
  const { epoch, begin, cancel, committed, pending } = useCommandScope<'save' | `delete:${string}`>(key, true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [savingJob, setSavingJob] = useState<CommandJob | null>(null);
  const [deleteJobs, setDeleteJobs] = useState<Array<{ id: string; job: CommandJob }>>([]);
  const opening = useRef(0);
  const current = draft?.epoch === epoch ? draft : null;
  const savingGuest = savingJob?.epoch === epoch && savingJob.active();
  const deletingGuestIds = deleteJobs.filter(entry => entry.job.epoch === epoch && entry.job.active()).map(entry => entry.id);
  const resetGuestModal = () => {
    if (!committed()) return;
    cancel('save');
    setDraft(previous => previous?.epoch === epoch ? null : previous);
    setSavingJob(previous => previous?.epoch === epoch ? null : previous);
  };
  const openGuestModal = (mode: Mode, guest?: ArenaGuest) => {
    if (!committed() || (guest && (guest.group_id !== groupId || pending(`delete:${guest.id}`)))) return;
    cancel('save');
    setSavingJob(null);
    setDraft({ epoch, opening: ++opening.current, mode, targetId: guest?.id ?? null,
      name: guest?.display_name ?? '', deckName: '', commander: null, partner: null });
  };
  const updateDraft = (patch: Partial<Pick<Draft, 'mode' | 'targetId' | 'name' | 'deckName' | 'commander' | 'partner'>>) => {
    if (!committed() || pending('save') || !current) return;
    setDraft(previous => previous?.epoch === epoch && previous.opening === current.opening ? { ...previous, ...patch } : previous);
  };
  const handleSaveGuestModal = async () => {
    if (!current || !committed()) return;
    const { mode, targetId, commander, partner, name, deckName } = current;
    if (!commander || (mode === 'add-deck' ? !targetId : !name.trim())) {
      toast({ title: t({ it: 'Errore', en: 'Error' }), variant: 'destructive', description: t(mode === 'add-deck'
        ? { it: 'Seleziona un comandante per il nuovo mazzo', en: 'Select a commander for the new deck' }
        : { it: 'Inserisci nome guest e seleziona un comandante', en: 'Enter a guest name and select a commander' }) });
      return;
    }
    if (targetId && !guests.some(guest => guest.id === targetId && guest.group_id === groupId)) return;
    const existing = targetId ?? guests.find(guest => normalizeGuestName(guest.display_name) === normalizeGuestName(name))?.id;
    if (existing && pending(`delete:${existing}`)) return;
    const job = begin('save'); if (!job) return;
    setSavingJob(job);
    try {
      const deck = await saveArenaGuestDeck({ groupId, guestId: mode === 'add-deck' ? targetId : null,
        name, deckName, commander, partner }, guests, job.signal);
      assertActive(job);
      await Promise.allSettled([reloadGuests()]);
      assertActive(job);
      if (mode !== 'add-deck' && mode !== 'manage-create') {
        const participantKey = toGuestParticipantKey(deck.guest_id);
        setSelectedParticipantKeys(previous => job.active() && !previous.includes(participantKey) ? [...previous, participantKey] : previous);
        setParticipantDecks(previous => job.active() ? { ...previous, [participantKey]: deck.id } : previous);
      }
      const colors = deck.color_identity;
      if (colors?.length) updateDeckColors(previous => job.active() ? { ...previous, [deck.id]: colors } : previous);
      setDraft(previous => job.active() && previous?.epoch === epoch && previous.opening === current.opening ? null : previous);
      toast({ title: t(mode === 'add-deck' ? { it: 'Mazzo aggiunto', en: 'Deck added' } : { it: 'Guest aggiunto', en: 'Guest added' }),
        description: t(mode === 'add-deck' ? { it: 'Il mazzo è stato aggiunto al guest', en: 'Deck added to guest' }
          : mode === 'manage-create' ? { it: 'Guest e mazzo aggiunti al playgroup', en: 'Guest and deck added to playgroup' }
            : { it: 'Il guest è stato aggiunto alla partita', en: 'Guest added to this battle' }) });
    } catch (error) {
      if (job.active()) toast({ title: t({ it: 'Errore', en: 'Error' }), variant: 'destructive',
        description: getSupabaseErrorMessage(error, t(mode === 'add-deck'
          ? { it: 'Impossibile salvare il mazzo', en: 'Failed to save deck' }
          : { it: 'Impossibile salvare il guest', en: 'Failed to save guest' })) });
    } finally {
      if (job.active()) setSavingJob(previous => job.active() && previous === job ? null : previous);
      job.finish();
    }
  };
  const handleDeleteGuest = async (guest: ArenaGuest) => {
    const slot = `delete:${guest.id}` as const;
    if (!committed() || !canManageGroup || guest.group_id !== groupId || pending(slot) || pending('save')) return;
    const deckCount = guest.arena_guest_decks?.length || 0;
    if (!confirm(t({
      it: `Eliminare il guest "${guest.display_name}"? Verranno rimossi anche ${deckCount} ${deckCount === 1 ? 'mazzo' : 'mazzi'} e le sue presenze nelle partite registrate.`,
      en: `Delete guest "${guest.display_name}"? This also removes ${deckCount} ${deckCount === 1 ? 'deck' : 'decks'} and their entries from recorded battles.`,
    }))) return;
    const job = begin(slot); if (!job) return;
    setDeleteJobs(previous => [...previous.filter(entry => entry.job.epoch === epoch && entry.job.active()), { id: guest.id, job }]);
    try {
      await deleteArenaGuest(groupId, guest.id, job.signal);
      assertActive(job);
      const participantKey = toGuestParticipantKey(guest.id);
      setSelectedParticipantKeys(previous => job.active() ? previous.filter(value => value !== participantKey) : previous);
      setParticipantDecks(previous => {
        if (!job.active()) return previous;
        const next = { ...previous }; delete next[participantKey]; return next;
      });
      setWinnerKey(previous => job.active() && previous === participantKey ? '' : previous);
      await Promise.allSettled([reloadGuests(), refreshMatches()]);
      assertActive(job);
      toast({ title: t({ it: 'Guest eliminato', en: 'Guest deleted' }), description: guest.display_name });
    } catch (error) {
      if (job.active()) toast({ title: t({ it: 'Errore', en: 'Error' }), variant: 'destructive',
        description: getSupabaseErrorMessage(error, t({ it: 'Impossibile eliminare il guest', en: 'Failed to delete guest' })) });
    } finally {
      if (job.active()) setDeleteJobs(previous => job.active() ? previous.filter(entry => entry.job !== job) : previous);
      job.finish();
    }
  };
  const addExistingGuestToMatch = (guest: ArenaGuest) => {
    if (!committed() || !current || guest.group_id !== groupId) return;
    toggleParticipantSelection(toGuestParticipantKey(guest.id));
    resetGuestModal();
  };
  return {
    showGuestModal: Boolean(current), dialogKey: current ? `${key}:${current.opening}` : 'closed',
    guestModalMode: current?.mode ?? 'pick-existing', guestDeckTargetId: current?.targetId ?? null,
    guestName: current?.name ?? '', guestDeckName: current?.deckName ?? '',
    guestSelectedCommander: current?.commander ?? null, guestSelectedPartnerCommander: current?.partner ?? null,
    savingGuest: Boolean(savingGuest), deletingGuestIds, openGuestModal, resetGuestModal, handleSaveGuestModal, handleDeleteGuest,
    openAddGuestDeckModal: (guest: ArenaGuest) => openGuestModal('add-deck', guest), addExistingGuestToMatch,
    setGuestModalMode: (mode: Mode) => updateDraft({ mode }),
    setGuestDeckTargetId: (targetId: string | null) => updateDraft({ targetId }),
    setGuestName: (name: string) => updateDraft({ name }),
    setGuestDeckName: (deckName: string) => updateDraft({ deckName }),
    setGuestSelectedCommander: (commander: CommanderSearchResult | null) => updateDraft({ commander }),
    setGuestSelectedPartnerCommander: (partner: CommanderSearchResult | null) => updateDraft({ partner }),
  };
}
