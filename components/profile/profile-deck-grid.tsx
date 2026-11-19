'use client';
import { Archive, ChevronRight, Image as ImageIcon, Link2, RefreshCw, Star, Trash2, Trophy } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MotionItem, MotionList } from '@/components/ui/motion';
import { useLanguage } from '@/components/language-provider';
import { DeckImage } from '@/components/deck-image';
import { DeckMasteryBadge } from './deck-mastery-badge';
import { DeckSourceBadge } from './deck-source-badge';
import { BracketBadge } from '@/components/deck/bracket-badge';
import { DeckExternalLinkChip } from '@/components/deck/deck-external-link-chip';
import { EdhrecDeckInsights } from '@/components/deck/edhrec-badge';
import { ManaColorPills } from '@/components/ui/mana-color-pills';
import { getDeckDisplayColors } from '@/lib/deck-metadata';
import { isImportedDeckSource } from '@/lib/deck-importers';
import { getDeckMastery } from '@/lib/deck-mastery';
import { getProfileDisplayName } from '@/lib/profile-display';
import { formatMatchRecord } from '@/lib/win-rate';
import type { ProfileDeck } from '@/lib/types/profile-deck';
import type { DeckPerformanceStats } from '@/lib/deck-performance-analytics';

export function ProfileDeckGrid({ filteredDecks, deckPerformance, deckWinRates, adminMode, userId,
  metricsLoading, metricsError, refreshingDeckIds, refreshCommandsBusy, onDetails, onFavorite, onArchive, onLink,
  onRefresh, onEditCommander, onDelete }: {
  filteredDecks: ProfileDeck[];
  deckPerformance: ReadonlyMap<string, DeckPerformanceStats>;
  deckWinRates: ReadonlyMap<string, DeckPerformanceStats>;
  adminMode: boolean;
  userId: string | undefined;
  metricsLoading: boolean;
  metricsError: boolean;
  refreshingDeckIds: string[];
  refreshCommandsBusy: boolean;
  onDetails: (deck: ProfileDeck) => void;
  onFavorite: (deck: ProfileDeck) => void;
  onArchive: (deck: ProfileDeck) => void;
  onLink: (deck: ProfileDeck) => void;
  onRefresh: (deck: ProfileDeck) => void;
  onEditCommander: (deck: ProfileDeck) => void;
  onDelete: (id: string, name: string) => void;
}) {
  const { copy: t } = useLanguage();
  const getSourceLinkLabel = (sourceType: string | null) => {
    if (sourceType === 'moxfield') return t({ it: 'Vedi su Moxfield', en: 'View on Moxfield' });
    if (sourceType === 'archidekt') return t({ it: 'Vedi su Archidekt', en: 'View on Archidekt' });
    return t({ it: 'Vedi sorgente', en: 'View source' });
  };

  const getDeckWinRateBadge = (deckId: string) => {
    const stats = deckWinRates.get(deckId);
    if (!stats || stats.gamesPlayed === 0) return null;

    return (
      <span
        title={t({
          it: `${stats.wins} vittorie su ${stats.gamesPlayed} partite`,
          en: `${stats.wins} wins in ${stats.gamesPlayed} games`,
        })}
        className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-200"
      >
        <Trophy className="h-3 w-3" />
        {stats.winRate}%
        <span className="opacity-75">· {formatMatchRecord(stats)}</span>
      </span>
    );
  };
  return <MotionList className="web-deck-grid space-y-3 sm:space-y-4">
    {filteredDecks.map((deck) => {
      const performance = deckPerformance.get(deck.id);
      const gamesPlayed = performance?.gamesPlayed ?? 0;
      const wins = performance?.wins ?? 0;
      const mastery = getDeckMastery(gamesPlayed, wins);

      return (
        <MotionItem key={deck.id}>
          <Card
            className="phyrexian-panel group relative min-h-[15rem] cursor-pointer overflow-hidden border-2 transition-[border-color,box-shadow] hover:brightness-110"
            style={gamesPlayed > 0 ? {
              borderColor: mastery.color,
              boxShadow: `0 0 24px ${mastery.color}26`,
            } : undefined}
            onClick={() => onDetails(deck)}
          >
            <DeckImage
              src={deck.commander_image}
              alt={deck.commander}
              className="absolute inset-0 h-full w-full rounded-none object-cover object-top"
              fallbackClassName="absolute inset-0 h-full w-full rounded-none"
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/90 via-black/65 to-black/45" />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-black/35" />

            <CardContent className="relative flex min-h-[15rem] flex-col gap-4 p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="line-clamp-2 text-lg font-black leading-tight text-white sm:text-xl">
                    {deck.name}
                  </h3>
                  <p className="mt-1 line-clamp-2 text-sm font-semibold text-white/75">{deck.commander}</p>
                </div>
                <ManaColorPills colors={getDeckDisplayColors(deck)} size="xs" gap="tight" className="shrink-0" />
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {<DeckSourceBadge sourceType={deck.source_type} />}
                <BracketBadge bracket={deck.bracket} className="rounded-full border border-emerald-500/30 px-2" />
                {getDeckWinRateBadge(deck.id)}
                {adminMode && deck.profiles?.username ? (
                  <span className="rounded-full border border-white/15 bg-black/35 px-2 py-1 text-[10px] text-white/70">
                    {getProfileDisplayName(deck.profiles)}
                  </span>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2" onClick={(event) => event.stopPropagation()}>
                {deck.source_url ? (
                  <DeckExternalLinkChip
                    href={deck.source_url}
                    label={getSourceLinkLabel(deck.source_type)}
                    tone={deck.source_type === 'moxfield' ? 'blue' : deck.source_type === 'archidekt' ? 'teal' : 'emerald'}
                  />
                ) : null}
                <EdhrecDeckInsights
                  commander={deck.commander}
                  localBracket={deck.bracket}
                  showBadge={false}
                  showBracketComparison={false}
                  linkVariant="chip"
                />
              </div>

              <div className="web-deck-footer mt-auto flex flex-col gap-3 lg:flex-row lg:items-end">
                <div className="flex min-w-0 flex-1 items-center gap-4 sm:gap-7">
                  {!metricsLoading && !metricsError ? <DeckMasteryBadge gamesPlayed={gamesPlayed} wins={wins} /> : null}
                  <div className="min-w-[4.75rem] text-center">
                    <p className="text-2xl font-black text-white">{performance?.winRate ?? 0}%</p>
                    <p className="text-xs text-white/60">Win rate</p>
                  </div>
                </div>

                <div
                  className="flex flex-wrap items-center justify-end gap-1 rounded-xl border border-white/10 bg-black/50 p-1"
                  onClick={(event) => event.stopPropagation()}
                >
                  {deck.user_id === userId ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-pressed={deck.is_favorite}
                      className={`h-11 w-11 ${deck.is_favorite ? 'text-amber-300 hover:text-amber-200' : 'text-white/60 hover:text-amber-300'}`}
                      onClick={() => void onFavorite(deck)}
                      title={t({
                        it: deck.is_favorite ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti',
                        en: deck.is_favorite ? 'Remove from favorites' : 'Add to favorites',
                      })}
                    >
                      <Star className={`h-4 w-4 ${deck.is_favorite ? 'fill-current' : ''}`} />
                    </Button>
                  ) : null}
                  {deck.user_id === userId ? (
                    <Button variant="ghost" size="icon" className="h-11 w-11 text-white/60 hover:text-emerald-300" onClick={() => onArchive(deck)} title={t({ it: 'Archivia mazzo', en: 'Archive deck' })}>
                      <Archive className="h-4 w-4" />
                    </Button>
                  ) : null}
                  <Button variant="ghost" size="sm" className="min-h-11 gap-1 px-3 text-emerald-200" onClick={() => onDetails(deck)}>
                    {t({ it: 'Dettagli', en: 'Details' })} <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11 text-white/60 hover:text-emerald-300"
                    onClick={() => onLink(deck)}
                    title={t({ it: 'Collega lista Archidekt o Moxfield', en: 'Link an Archidekt or Moxfield list' })}
                  >
                    <Link2 className="h-4 w-4" />
                  </Button>
                  {isImportedDeckSource(deck.source_type) && deck.source_url ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-11 w-11 text-white/60 hover:text-emerald-300"
                      onClick={() => onRefresh(deck)}
                      disabled={refreshCommandsBusy}
                      title={t({ it: 'Aggiorna da sorgente', en: 'Refresh from source' })}
                    >
                      <RefreshCw className={`h-4 w-4 ${refreshingDeckIds.includes(deck.id) ? 'animate-spin' : ''}`} />
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11 text-white/60 hover:text-white"
                    onClick={() => onEditCommander(deck)}
                    title={t({ it: 'Modifica comandante', en: 'Edit commander' })}
                  >
                    <ImageIcon className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11 text-white/60 hover:text-destructive"
                    onClick={() => onDelete(deck.id, deck.name)}
                    title={t({ it: 'Elimina mazzo', en: 'Delete deck' })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </MotionItem>
      );
    })}
  </MotionList>;
}
