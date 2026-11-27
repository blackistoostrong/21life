'use client';
import { useLanguage } from '@/components/language-provider';
import { useToast } from '@/hooks/use-toast';
import type { Group } from '@/lib/types/arena-catalog';
import type { Match } from '@/lib/types/arena-match';
import { getParticipantDeckSnapshot, getParticipantDisplayName } from '@/lib/arena-participants';
import { getProfileDisplayName } from '@/lib/profile-display';
import { formatGameDuration } from '@/lib/live-game-duration';
import { format } from 'date-fns';

/** Existing invitation and single-match sharing remain independent of period recap. */
export function useArenaSharing({group}: {group: Group | null}) {
  const { copy: t, language } = useLanguage();
  const { toast } = useToast();
  const copyInviteLink = () => {
    if (!group) return;
    navigator.clipboard.writeText(`${window.location.origin}/join/${group.invite_code}`);
    toast({
      title: t({ it: 'Copiato!', en: 'Copied!' }),
      description: t({ it: 'Link invito copiato negli appunti', en: 'Invite link copied to clipboard' }),
    });
  };

  const getMatchWinnerName = (match: Match) => {
    if (match.winner_guest?.display_name) return match.winner_guest.display_name;
    return getProfileDisplayName(match.winner);
  };

  const getWinConditionLabel = (condition: Match['win_condition']) => {
    if (condition === 'last_standing') return t({ it: 'Ultimo in piedi', en: 'Last standing' });
    if (condition === 'combo') return 'Combo';
    if (condition === 'concession') return t({ it: 'Resa', en: 'Concession' });
    if (condition === 'alternate_card') return t({ it: 'Vittoria alternativa', en: 'Alternate card' });
    if (condition === 'other') return t({ it: 'Altro', en: 'Other' });
    return t({ it: 'Non indicata', en: 'Not specified' });
  };

  const buildMatchShareText = (match: Match) => {
    const participants = match.match_participants
      .map((participant) => {
        const playerName = getParticipantDisplayName(participant);
        const deck = getParticipantDeckSnapshot(participant);
        const deckName = deck?.name || t({ it: 'Mazzo non indicato', en: 'No deck selected' });
        const commanderName = deck?.commander ? ` (${deck.commander})` : '';
        return `- ${playerName}: ${deckName}${commanderName}`;
      })
      .join('\n');
    const winnerName = match.is_draw
      ? t({ it: 'Patta', en: 'Draw' })
      : getMatchWinnerName(match);
    const comment = match.notes?.trim() || t({ it: 'Nessun commento', en: 'No comment' });

    return [
      `${t({ it: 'Partita 21Life', en: '21Life match' })} - ${group?.name || ''}`,
      match.played_at ? format(new Date(match.played_at), 'PPP') : t({it:'Data non disponibile',en:'Date unavailable'}),
      match.duration_seconds != null
        ? `${t({ it: 'Durata', en: 'Duration' })}: ${formatGameDuration(match.duration_seconds)}`
        : null,
      match.win_condition
        ? `${t({ it: 'Condizione di vittoria', en: 'Win condition' })}: ${getWinConditionLabel(match.win_condition)}`
        : null,
      '',
      t({ it: 'Partecipanti e mazzi:', en: 'Players and decks:' }),
      participants,
      '',
      `${t({ it: 'Vincitore', en: 'Winner' })}: ${winnerName}`,
      '',
      `${t({ it: 'Commento', en: 'Comment' })}:`,
      comment,
      ...(match.tracking_version || match.duration_seconds != null ? [
        '',
        t({ it: 'Statistiche realtime:', en: 'Realtime stats:' }),
        ...match.match_participants.map((participant) => (
          `- ${getParticipantDisplayName(participant)}: ${participant.life_damage_dealt || 0} dmg · ${participant.eliminations_caused || 0} KO`
        )),
      ] : []),
    ].filter((line): line is string => line !== null).join('\n');
  };

  const handleShareMatch = async (match: Match) => {
    const text = buildMatchShareText(match);
    const shareData = {
      title: t({ it: 'Log partita 21Life', en: '21Life match log' }),
      text,
    };

    try {
      if (navigator.share && (!navigator.canShare || navigator.canShare(shareData))) {
        await navigator.share(shareData);
        return;
      }

      await navigator.clipboard.writeText(text);
      const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
      window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
      toast({
        title: t({ it: 'Log copiato', en: 'Log copied' }),
        description: t({ it: 'Ho aperto WhatsApp con il testo pronto da inviare.', en: 'WhatsApp opened with the match text ready.' }),
      });
    } catch (error) {
      if ((error as DOMException)?.name === 'AbortError') return;
      try {
        await navigator.clipboard.writeText(text);
        toast({
          title: t({ it: 'Log copiato', en: 'Log copied' }),
          description: t({ it: 'Il testo della partita è negli appunti.', en: 'The match text is in your clipboard.' }),
        });
      } catch {
        toast({
          title: t({ it: 'Errore', en: 'Error' }),
          description: t({ it: 'Impossibile condividere il log partita', en: 'Unable to share match log' }),
          variant: 'destructive',
        });
      }
    }
  };
  return { copyInviteLink, getWinConditionLabel, handleShareMatch };
}
