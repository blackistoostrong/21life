'use client';
import { useLayoutEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { useArenaMatchWrite } from '@/hooks/use-arena-match-write';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/components/language-provider';
import { getParticipantKey, getParticipantDisplayName, getParticipantDeckId, resolveWinnerParticipantKey, type ArenaGuest, type ArenaGuestDeck } from '@/lib/arena-participants';
import { parseParticipantKey, toUserParticipantKey, toGuestParticipantKey, type ParticipantKey } from '@/lib/participant-keys';
import { isoToMatchDateValue, matchDateToIso, toMatchDateValue } from '@/lib/match-datetime';
import { getArenaMatchWriteFailureMessage } from '@/packages/domain/arena-match-write';
import type { WinCondition } from '@/packages/domain/live-game-types';
import type { Profile, Deck } from '@/lib/types/arena-catalog';
import type { Match } from '@/lib/types/arena-match';

type Inputs = {
  userId: string | null; groupId: string; matchAccessKey: string; canManageGroup: boolean; anyOccasionalCreationBusy: boolean;
  members: Profile[]; guests: ArenaGuest[]; decks: Deck[]; occasionalChoices: Deck[];
  setOccasionalChoices: Dispatch<SetStateAction<Deck[]>>;
  getParticipantDeckOptions: (key: ParticipantKey) => Array<Deck | ArenaGuestDeck>;
  refreshMissingImportedDeckImages: (ids: string[]) => Promise<unknown>;
  refreshMatches: () => Promise<unknown>;
};
/** Own the historical editor snapshot, assignments, validation and atomic save. */
export function useArenaMatchEditor({ userId, groupId, matchAccessKey, canManageGroup, anyOccasionalCreationBusy,
  members, guests, decks, occasionalChoices, setOccasionalChoices, getParticipantDeckOptions,
  refreshMissingImportedDeckImages, refreshMatches }: Inputs) {
  const { toast } = useToast();
  const { copy: t, language } = useLanguage();
  const [editingMatch, setEditingMatch] = useState<Match | null>(null);
  const [editMatchWinnerKey, setEditMatchWinnerKey] = useState<ParticipantKey | ''>('');
  const [editMatchIsDraw, setEditMatchIsDraw] = useState(false);
  const [editMatchWinCondition, setEditMatchWinCondition] = useState<WinCondition>('other');
  const [editMatchNotes, setEditMatchNotes] = useState('');
  const [editMatchPlayedAt, setEditMatchPlayedAt] = useState(() => toMatchDateValue());
  const [editMatchPlayerKeys, setEditMatchPlayerKeys] = useState<Record<string, ParticipantKey>>({});
  const [editMatchPlayerDecks, setEditMatchPlayerDecks] = useState<Record<string, string>>({});
  const [editMatchDeckSearches, setEditMatchDeckSearches] = useState<Record<string, string>>({});
  const [hiddenEditMatchDeckLists, setHiddenEditMatchDeckLists] = useState<Record<string, boolean>>({});
  const [savingEditMatch, setSavingEditMatch] = useState(false);
  const editWriter = useArenaMatchWrite(userId, groupId, matchAccessKey, editingMatch?.id ?? null);
  const editMatchPlayerOptions = useMemo(() => {
    const options = new Map<ParticipantKey, string>();
    members.forEach((member) => {
      options.set(toUserParticipantKey(member.id), member.display_name?.trim() || member.username);
    });
    guests.forEach((guest) => {
      options.set(toGuestParticipantKey(guest.id), guest.display_name);
    });
    editingMatch?.match_participants.forEach((participant) => {
      const key = getParticipantKey(participant);
      if (!key || options.has(key)) return;
      options.set(key, getParticipantDisplayName(participant));
    });
    return Array.from(options, ([key, label]) => ({ key, label }));
  }, [editingMatch, guests, members]);
  useLayoutEffect(() => { if (!editingMatch) setSavingEditMatch(false); }, [editingMatch]);
  useLayoutEffect(() => {
    setEditingMatch(null); setSavingEditMatch(false);
    setEditMatchPlayerKeys({}); setEditMatchPlayerDecks({}); setEditMatchDeckSearches({});
    setHiddenEditMatchDeckLists({}); setEditMatchWinnerKey(''); setEditMatchIsDraw(false);
    setEditMatchWinCondition('other'); setEditMatchNotes(''); setEditMatchPlayedAt(toMatchDateValue());
  }, [userId, groupId, matchAccessKey]);
  const getFilteredEditMatchDeckOptions = (participantId: string, participantKey: ParticipantKey) => {
    const query = (editMatchDeckSearches[participantId] || '').trim().toLowerCase();
    const deckList = getParticipantDeckOptions(participantKey);
    if (!query) return deckList;
    return deckList.filter((deck) => [
      deck.name,
      deck.commander,
      'source_type' in deck ? deck.source_type : 'guest',
      deck.bracket ? `bracket ${deck.bracket}` : null,
    ].filter(Boolean).some((value) => String(value).toLowerCase().includes(query)));
  };

  const getSelectedEditMatchDeck = (participantId: string, participantKey: ParticipantKey) => {
    const deckId = editMatchPlayerDecks[participantId];
    if (!deckId) return null;
    const parsed = parseParticipantKey(participantKey);
    if (!parsed) return null;
    if (parsed.type === 'user') return [...decks, ...occasionalChoices].find((deck) => deck.id === deckId && deck.user_id === parsed.id) || null;
    const guest = guests.find((entry) => entry.id === parsed.id);
    return guest?.arena_guest_decks?.find((deck) => deck.id === deckId) || null;
  };

  const openEditMatch = (match: Match) => {
    setOccasionalChoices(match.match_participants.flatMap((p) =>
      p.deck_id && p.user_id && p.decks?.source_type === 'occasional'
        ? [{ ...p.decks, id: p.deck_id, user_id: p.user_id, group_id: groupId, is_favorite: false, source_url: null, created_at: '' } as Deck] : []));
    setEditingMatch(match);
    setEditMatchWinnerKey(resolveWinnerParticipantKey(match) || '');
    setEditMatchIsDraw(Boolean(match.is_draw));
    setEditMatchWinCondition(match.win_condition || 'other');
    setEditMatchNotes(match.notes || '');
    setEditMatchPlayedAt(isoToMatchDateValue(match.played_at));
    setEditMatchDeckSearches({});
    setEditMatchPlayerKeys(Object.fromEntries(
      match.match_participants.flatMap((participant) => {
        const key = getParticipantKey(participant);
        return key ? [[participant.id, key]] : [];
      }),
    ));
    setHiddenEditMatchDeckLists(Object.fromEntries(
      match.match_participants.map((participant) => [participant.id, true]),
    ));
    const deckMap: Record<string, string> = {};
    match.match_participants.forEach((p) => {
      const deckId = getParticipantDeckId(p);
      if (deckId) deckMap[p.id] = deckId;
    });
    setEditMatchPlayerDecks(deckMap);
    void refreshMissingImportedDeckImages(
      match.match_participants.flatMap((participant) => {
        const deckId = deckMap[participant.id];
        return deckId && getParticipantKey(participant)?.startsWith('user:') ? [deckId] : [];
      }),
    ).catch(() => {});
  };

  const handleSaveEditMatch = async () => {
    if (anyOccasionalCreationBusy) return;
    if (!editingMatch) return;
    if (!editMatchIsDraw && !editMatchWinnerKey) {
      toast({ title: t({ it: 'Errore', en: 'Error' }), description: t({ it: 'Seleziona un vincitore o segna come patta', en: 'Select a winner or mark as draw' }), variant: 'destructive' });
      return;
    }
    const assignments = editingMatch.match_participants.map((participant) => ({
      participant,
      originalKey: getParticipantKey(participant),
      selectedKey: editMatchPlayerKeys[participant.id] || getParticipantKey(participant),
    }));
    const selectedKeys = assignments.map((assignment) => assignment.selectedKey).filter((key): key is ParticipantKey => Boolean(key));
    const hasReplacement = assignments.some(({ originalKey, selectedKey }) => originalKey !== selectedKey);
    if (hasReplacement && !canManageGroup) {
      toast({ title: t({ it: 'Permesso negato', en: 'Permission denied' }), description: t({ it: 'Solo il proprietario dell’arena può sostituire un giocatore.', en: 'Only the arena owner can replace a player.' }), variant: 'destructive' });
      return;
    }
    if (selectedKeys.length !== assignments.length || new Set(selectedKeys).size !== selectedKeys.length) {
      toast({ title: t({ it: 'Giocatori non validi', en: 'Invalid players' }), description: t({ it: 'Ogni posto deve essere assegnato a un giocatore diverso.', en: 'Each seat must be assigned to a different player.' }), variant: 'destructive' });
      return;
    }
    if (!editMatchIsDraw && !selectedKeys.includes(editMatchWinnerKey as ParticipantKey)) {
      toast({ title: t({ it: 'Vincitore non valido', en: 'Invalid winner' }), description: t({ it: 'Seleziona come vincitore uno dei giocatori attuali.', en: 'Select one of the current players as the winner.' }), variant: 'destructive' });
      return;
    }
    const playedAtIso = matchDateToIso(editMatchPlayedAt, editingMatch?.played_at);
    const preserveUnknownDate = editingMatch?.played_at === null && editMatchPlayedAt.trim() === '';
    if (!playedAtIso && !preserveUnknownDate) {
      toast({
        title: t({ it: 'Errore', en: 'Error' }),
        description: t({ it: 'Data della partita non valida.', en: 'Invalid battle date.' }),
        variant: 'destructive',
      });
      return;
    }

    if (!userId) return;
    const job = editWriter.begin('save'); if (!job) return;
    setSavingEditMatch(true);
    try {
      const players = assignments.map(({ participant, selectedKey }) => {
        const selectedPlayer = editMatchPlayerOptions.find(option => option.key === selectedKey);
        if (!selectedKey || !selectedPlayer) throw new Error('MATCH_PARTICIPANT_INVALID');
        return { id: participant.id, key: selectedKey, deckId: editMatchPlayerDecks[participant.id] || null,
          snapshotName: selectedPlayer.label };
      });
      await editWriter.save(job, { mode: 'edit', isDraw: editMatchIsDraw, winnerKey: editMatchWinnerKey || null,
        notes: editMatchNotes, playedAt: playedAtIso, winCondition: editMatchWinCondition, players }, editingMatch.id);
      if (!job.active()) return;
      toast({ title: t({ it: 'Partita aggiornata!', en: 'Battle updated!' }) });
      setEditingMatch(null);
      setEditMatchDeckSearches({});
      setHiddenEditMatchDeckLists({});
      await Promise.allSettled([refreshMatches()]);
    } catch (error: unknown) {
      if (job.active()) toast({ title: t({ it: 'Errore', en: 'Error' }), description: getArenaMatchWriteFailureMessage(error, language === 'it' ? 'it' : 'en'), variant: 'destructive' });
    } finally {
      if (job.active()) setSavingEditMatch(previous => job.active() ? false : previous);
      job.finish();
    }
  };
  return {
    editingMatch,
    setEditingMatch,
    editMatchWinnerKey,
    setEditMatchWinnerKey,
    editMatchIsDraw,
    setEditMatchIsDraw,
    editMatchWinCondition,
    setEditMatchWinCondition,
    editMatchNotes,
    setEditMatchNotes,
    editMatchPlayedAt,
    setEditMatchPlayedAt,
    editMatchPlayerKeys,
    setEditMatchPlayerKeys,
    editMatchPlayerDecks,
    setEditMatchPlayerDecks,
    editMatchDeckSearches,
    setEditMatchDeckSearches,
    hiddenEditMatchDeckLists,
    setHiddenEditMatchDeckLists,
    savingEditMatch,
    editMatchPlayerOptions,
    getFilteredEditMatchDeckOptions,
    getSelectedEditMatchDeck,
    openEditMatch,
    handleSaveEditMatch,
  };
}
