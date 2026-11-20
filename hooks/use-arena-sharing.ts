'use client';
import { useLanguage } from '@/components/language-provider';
import { useToast } from '@/hooks/use-toast';
import type { Group } from '@/lib/types/arena-catalog';
import type { ArenaSeasonContext } from '@/lib/arena-seasons';
import type { useArenaReports, useArenaReportScope } from '@/hooks/use-arena-reports';
import type { useArenaMatchHistory } from '@/hooks/use-arena-match-history';
import type { Match } from '@/lib/types/arena-match';
import { MANA_COLOR_LABELS } from '@/lib/mana-colors';
import { buildArenaShareText } from '@/lib/arena-share';
import { getParticipantDeckSnapshot, getParticipantDisplayName } from '@/lib/arena-participants';
import { getProfileDisplayName } from '@/lib/profile-display';
import { formatGameDuration } from '@/lib/live-game-duration';
import { formatArenaSeasonLabel } from '@/lib/arena-seasons';
import { format } from 'date-fns';

type Reports = ReturnType<typeof useArenaReports>;
type Input = Pick<Reports, 'analyticsPayload' | 'playerStats' | 'deckStats' | 'colorAnalytics'> & {
  group: Group | null; season: { ready: boolean };
  reportAnalytics: Pick<Reports['reportAnalytics'], 'ready'>;
  history: Pick<ReturnType<typeof useArenaMatchHistory>, 'loading' | 'error' | 'recentMatches'>;
  dateFilter: ReturnType<typeof useArenaReportScope>['dateFilter'];
  seasonContext: ArenaSeasonContext | null;
};
/** Browser sharing consumes acknowledged report/history models; no private reads. */
export function useArenaSharing({ group, season, reportAnalytics, history, dateFilter, seasonContext, analyticsPayload, playerStats, deckStats, colorAnalytics }: Input) {
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

  const getPeriodLabel = () => {
    if (dateFilter === '7d') return t({ it: 'Ultimi 7 giorni', en: 'Last 7 days' });
    if (dateFilter === '30d') return t({ it: 'Ultimi 30 giorni', en: 'Last 30 days' });
    if (dateFilter === '90d') return t({ it: 'Ultimi 90 giorni', en: 'Last 90 days' });
    return seasonContext
      ? formatArenaSeasonLabel(
          seasonContext.currentSeasonStart,
          seasonContext.currentSeasonEnd,
          language === 'it' ? 'it-IT' : 'en-US',
        )
      : t({ it: 'Tutto il periodo', en: 'All time' });
  };

  const handleShareArenaStats = async () => {
    if (!group || !season.ready || !reportAnalytics.ready || history.loading || history.error) return;

    const filteredMatches = history.recentMatches as unknown as Match[];
    const text = buildArenaShareText({
      arenaName: group.name,
      periodLabel: getPeriodLabel(),
      totalMatches: analyticsPayload.totalMatches ?? 0,
      topPlayers: playerStats.slice(0, 5).map((player) => ({
        displayName: player.displayName,
        gamesPlayed: player.gamesPlayed,
        wins: player.wins,
        losses: player.losses,
        draws: player.draws,
        decisiveGames: player.decisiveGames,
        winRate: player.winRate,
      })),
      topDecks: deckStats.slice(0, 5).map((deck) => ({
        name: deck.name,
        commander: deck.commander,
        ownerDisplayName: deck.ownerDisplayName,
        gamesPlayed: deck.gamesPlayed,
        wins: deck.wins,
        losses: deck.losses,
        draws: deck.draws,
        decisiveGames: deck.decisiveGames,
        winRate: deck.winRate,
        bracket: deck.bracket,
      })),
      topColors: colorAnalytics.played.slice(0, 5).map((entry) => ({
        label: t(MANA_COLOR_LABELS[entry.color] || MANA_COLOR_LABELS.C),
        gamesPlayed: entry.appearances,
        percentage: entry.percentage,
      })),
      recentMatches: filteredMatches.slice(0, 3).map((match) => ({
        playedAt: match.played_at,
        notes: match.notes,
        winnerName: getMatchWinnerName(match),
        participants: match.match_participants.map((participant) => {
          const deck = getParticipantDeckSnapshot(participant);
          return {
            displayName: getParticipantDisplayName(participant),
            commander: deck?.commander || null,
            deckName: deck?.name || null,
            isWinner: participant.is_winner,
            bracket: deck?.bracket || null,
          };
        }),
      })),
      publicUrl: group.is_public ? `${window.location.origin}/arena/${group.invite_code}` : null,
    }, {
      arenaStatsTitle: t({ it: 'Statistiche playgroup', en: 'Playgroup stats' }),
      period: t({ it: 'Periodo', en: 'Period' }),
      totalMatches: t({ it: 'Partite', en: 'Matches' }),
      topPlayers: t({ it: 'Top giocatori', en: 'Top players' }),
      topDecks: t({ it: 'Top mazzi', en: 'Top decks' }),
      topColors: t({ it: 'Colori più giocati', en: 'Most played colors' }),
      recentMatches: t({ it: 'Ultime partite', en: 'Recent matches' }),
      winner: t({ it: 'Vincitore', en: 'Winner' }),
      winRate: t({ it: 'win rate', en: 'win rate' }),
      publicPage: t({ it: 'Pagina pubblica', en: 'Public page' }),
      noComment: t({ it: 'Nessun commento', en: 'No comment' }),
    });

    try {
      if (navigator.share) {
        await navigator.share({
          title: `${group.name} - 21Life`,
          text,
        });
        return;
      }

      await navigator.clipboard.writeText(text);
      toast({
        title: t({ it: 'Statistiche copiate', en: 'Stats copied' }),
        description: t({ it: 'Il riepilogo del playgroup è negli appunti', en: 'Playgroup summary copied to clipboard' }),
      });
    } catch (error) {
      if ((error as DOMException)?.name === 'AbortError') return;
      toast({
        title: t({ it: 'Errore', en: 'Error' }),
        description: t({ it: 'Impossibile condividere le statistiche', en: 'Unable to share stats' }),
        variant: 'destructive',
      });
    }
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
  return { copyInviteLink, getWinConditionLabel, handleShareArenaStats, handleShareMatch };
}
