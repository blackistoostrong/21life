'use client';
import { useLayoutEffect, useState } from 'react';
import { useArenaMatchWrite } from '@/hooks/use-arena-match-write';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/components/language-provider';
import { getLastDeckSelectionForParticipant } from '@/lib/arena-participants';
import type { ParticipantKey } from '@/lib/participant-keys';
import { matchDateToIso, toMatchDateValue } from '@/lib/match-datetime';
import type { WinCondition } from '@/packages/domain/live-game-types';
import { getArenaMatchWriteFailureMessage } from '@/packages/domain/arena-match-write';

type Inputs = {
  userId: string | null; groupId: string; matchAccessKey: string; anyOccasionalCreationBusy: boolean;
  matches: Parameters<typeof getLastDeckSelectionForParticipant>[1];
  getParticipantDeckOptions: (key: ParticipantKey) => Array<{ id: string }>;
  refreshMissingImportedDeckImages: (ids: string[]) => Promise<unknown>;
  refreshMatches: () => Promise<unknown>; reloadGuests: () => Promise<unknown>;
};
/** Creation owns its draft, participant selection, validation and atomic command. */
export function useArenaMatchCreation({ userId, groupId, matchAccessKey, anyOccasionalCreationBusy, matches,
  getParticipantDeckOptions, refreshMissingImportedDeckImages, refreshMatches, reloadGuests }: Inputs) {
  const { toast } = useToast();
  const { copy: t, language } = useLanguage();
  const [showMatchModal, setShowMatchModal] = useState(false);

  const [selectedParticipantKeys, setSelectedParticipantKeys] = useState<ParticipantKey[]>([]);

  const [participantDecks, setParticipantDecks] = useState<Record<string, string>>({});

  const [participantDeckSearches, setParticipantDeckSearches] = useState<Record<string, string>>({});

  const [hiddenParticipantDeckLists, setHiddenParticipantDeckLists] = useState<Record<string, boolean>>({});

  const [winnerKey, setWinnerKey] = useState<ParticipantKey | ''>('');

  const [matchIsDraw, setMatchIsDraw] = useState(false);

  const [matchWinCondition, setMatchWinCondition] = useState<WinCondition>('other');

  const [matchNotes, setMatchNotes] = useState('');

  const [matchPlayedAt, setMatchPlayedAt] = useState(() => toMatchDateValue());

  const [savingMatch, setSavingMatch] = useState(false);
  const createWriter = useArenaMatchWrite(userId, groupId, matchAccessKey, showMatchModal);
  useLayoutEffect(() => { if (!showMatchModal) setSavingMatch(false); }, [showMatchModal]);
  useLayoutEffect(() => {
    setShowMatchModal(false);
    setSelectedParticipantKeys([]); setParticipantDecks({}); setParticipantDeckSearches({});
    setHiddenParticipantDeckLists({}); setWinnerKey(''); setMatchIsDraw(false);
    setMatchWinCondition('other'); setMatchNotes(''); setMatchPlayedAt(toMatchDateValue());
    setSavingMatch(false);
  }, [userId, groupId, matchAccessKey]);
  const toggleParticipantSelection = (participantKey: ParticipantKey) => {
    if (anyOccasionalCreationBusy) return;
    setSelectedParticipantKeys((prev) => {
      const selected = prev.includes(participantKey);
      if (selected) {
        setParticipantDecks((current) => {
          const next = { ...current };
          delete next[participantKey];
          return next;
        });
        setParticipantDeckSearches((current) => {
          const next = { ...current };
          delete next[participantKey];
          return next;
        });
        setHiddenParticipantDeckLists((current) => {
          const next = { ...current };
          delete next[participantKey];
          return next;
        });
        if (winnerKey === participantKey) setWinnerKey('');
        return prev.filter((key) => key !== participantKey);
      }

      const deckOptions = getParticipantDeckOptions(participantKey);
      const lastDeckId = getLastDeckSelectionForParticipant(participantKey, matches);
      const preferredDeckId = deckOptions.length === 1
        ? deckOptions[0].id
        : lastDeckId && deckOptions.some((deck) => deck.id === lastDeckId) ? lastDeckId : null;
      if (preferredDeckId) {
        setParticipantDecks((current) => ({ ...current, [participantKey]: preferredDeckId }));
      }

      return [...prev, participantKey];
    });
  };

  const resetMatchForm = () => {
    createWriter.cancel('save');
    setShowMatchModal(false);
    setSelectedParticipantKeys([]);
    setParticipantDecks({});
    setParticipantDeckSearches({});
    setHiddenParticipantDeckLists({});
    setWinnerKey('');
    setMatchIsDraw(false);
    setMatchWinCondition('other');
    setMatchNotes('');
    setMatchPlayedAt(toMatchDateValue());
  };

  const handleCreateMatch = async () => {
    if (anyOccasionalCreationBusy) return;
    if (selectedParticipantKeys.length < 2) {
      toast({ title: t({ it: 'Errore', en: 'Error' }), description: t({ it: 'Seleziona almeno 2 giocatori', en: 'Select at least 2 players' }), variant: 'destructive' });
      return;
    }
    if (!matchIsDraw && !winnerKey) {
      toast({ title: t({ it: 'Errore', en: 'Error' }), description: t({ it: 'Seleziona un vincitore o segna come patta', en: 'Select a winner or mark as draw' }), variant: 'destructive' });
      return;
    }

    const participantMissingDeck = selectedParticipantKeys.find((participantKey) => {
      const deckOptions = getParticipantDeckOptions(participantKey);
      if (deckOptions.length === 0) return false;
      return !participantDecks[participantKey];
    });

    if (participantMissingDeck) {
      toast({
        title: t({ it: 'Errore', en: 'Error' }),
        description: t({ it: 'Seleziona un mazzo per ogni giocatore', en: 'Select a deck for each player' }),
        variant: 'destructive',
      });
      return;
    }

    const playedAtIso = matchDateToIso(matchPlayedAt);
    if (!playedAtIso) {
      toast({
        title: t({ it: 'Errore', en: 'Error' }),
        description: t({ it: 'Data della partita non valida.', en: 'Invalid battle date.' }),
        variant: 'destructive',
      });
      return;
    }

    if (!showMatchModal || !userId) return;
    const job = createWriter.begin('save'); if (!job) return;
    setSavingMatch(true);
    try {
      const input = { mode: 'create' as const, isDraw: matchIsDraw, winnerKey: winnerKey || null,
        notes: matchNotes, playedAt: playedAtIso, winCondition: matchWinCondition,
        players: selectedParticipantKeys.map(key => ({ key, deckId: participantDecks[key] || null })) };
      const userDeckIds = selectedParticipantKeys.filter(key => key.startsWith('user:'))
        .map(key => participantDecks[key]).filter(Boolean);
      await refreshMissingImportedDeckImages(userDeckIds);
      if (!job.active()) return;
      await createWriter.save(job, input);
      if (!job.active()) return;

      toast({
        title: t({ it: 'Partita registrata!', en: 'Battle recorded!' }),
        description: matchIsDraw
          ? t({ it: 'Esito registrato: patta', en: 'Result logged: draw' })
          : t({ it: 'La vittoria è stata salvata', en: 'Victory has been logged' }),
      });
      setShowMatchModal(false);
      setSelectedParticipantKeys([]); setParticipantDecks({}); setParticipantDeckSearches({});
      setHiddenParticipantDeckLists({}); setWinnerKey(''); setMatchIsDraw(false);
      setMatchWinCondition('other'); setMatchNotes(''); setMatchPlayedAt(toMatchDateValue());
      await Promise.allSettled([refreshMatches(), reloadGuests()]);
    } catch (error: unknown) {
      if (job.active()) toast({ title: t({ it: 'Errore', en: 'Error' }), description: getArenaMatchWriteFailureMessage(error, language === 'it' ? 'it' : 'en'), variant: 'destructive' });
    } finally {
      if (job.active()) setSavingMatch(previous => job.active() ? false : previous);
      job.finish();
    }
  };
  return {
    showMatchModal, setShowMatchModal,
    selectedParticipantKeys, setSelectedParticipantKeys,
    participantDecks, setParticipantDecks,
    participantDeckSearches, setParticipantDeckSearches,
    hiddenParticipantDeckLists, setHiddenParticipantDeckLists,
    winnerKey, setWinnerKey, matchIsDraw, setMatchIsDraw,
    matchWinCondition, setMatchWinCondition,
    matchNotes, setMatchNotes, matchPlayedAt, setMatchPlayedAt,
    savingMatch, toggleParticipantSelection, resetMatchForm, handleCreateMatch,
  };
}
