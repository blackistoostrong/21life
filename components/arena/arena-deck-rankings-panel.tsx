'use client';
import { useLanguage } from '@/components/language-provider';
import type { ArenaDataStatusProps } from '@/components/arena/arena-data-status';
import type { Dispatch, SetStateAction } from 'react';
import type { DeckPerformanceStats } from '@/lib/deck-performance-analytics';
import { ArenaDataStatus } from '@/components/arena/arena-data-status';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TabsContent } from '@/components/ui/tabs';
import { DeckImage } from '@/components/deck-image';
import { ArenaDeckSummary } from '@/components/arena/arena-deck-summary';
import { BracketBadge } from '@/components/deck/bracket-badge';
import { EdhrecBadge } from '@/components/deck/edhrec-badge';
import { isProvisionalDeckRanking } from '@/lib/deck-ranking-visibility';
import { Swords, Trophy } from 'lucide-react';
import { formatMatchRecord, formatWinRate } from '@/lib/win-rate';

type Props = { status: Omit<ArenaDataStatusProps, 'children'>;
  deckStats: DeckPerformanceStats[]; visibleDeckStats: DeckPerformanceStats[];
  deckStatsSort: 'winRate' | 'gamesPlayed'; provisionalDeckCount: number;
  showProvisionalDecks: boolean; setShowProvisionalDecks: Dispatch<SetStateAction<boolean>>;
  commanderRanksByIndex: number[];
};
/** Present one report; data loading and shared filters remain with their owners. */
export function ArenaDeckRankingsPanel({ status, deckStats, visibleDeckStats, deckStatsSort, provisionalDeckCount, showProvisionalDecks, setShowProvisionalDecks, commanderRanksByIndex }: Props) {
  const { copy: t } = useLanguage();
  return <TabsContent value="commanders">
            <ArenaDataStatus loading={status.loading} error={status.error}
              onRetry={status.onRetry}>
            {deckStats.length === 0 ? (
              <Card className="bg-card/50 border-border">
                <CardContent className="py-12 text-center">
                  <Swords className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-foreground mb-2">{t({ it: 'Nessuna statistica mazzo', en: 'No deck stats yet' })}</h3>
                  <p className="text-muted-foreground">{t({ it: 'Aggiungi mazzi e gioca partite per vedere le statistiche', en: 'Add decks and play battles to see deck statistics' })}</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-6">
                <ArenaDeckSummary visibleDeckStats={visibleDeckStats} totalDecks={deckStats.length} />

                <Card className="bg-card/50 border-border">
                  <CardHeader>
                    <CardTitle className="text-foreground flex items-center gap-2">
                      <Swords className="w-5 h-5" />
                      {t({ it: 'Classifica mazzi', en: 'Deck Rankings' })}
                    </CardTitle>
                    <CardDescription>
                      {deckStatsSort === 'winRate' && t({ it: 'Ordinata per win rate, vittorie e partite giocate', en: 'Sorted by win rate, wins, and games played' })}
                      {deckStatsSort === 'gamesPlayed' && t({ it: 'Ordinata per partite giocate', en: 'Sorted by games played' })}
                    </CardDescription>
                    <p className="text-sm leading-relaxed text-muted-foreground">{t({ it: 'Win rate = vittorie / partite con un vincitore; le patte sono escluse. Senza partite decisive: —. Considera anche quanti giocatori siedono al tavolo: duelli e tavoli multiplayer hanno contesti diversi.', en: 'Win rate = wins / games with a winner; draws are excluded. No decisive games: —. Consider table size too: duels and multiplayer tables have different contexts.' })}</p>
                    <p className="text-sm leading-relaxed text-muted-foreground">{t({ it: 'Meno di 5 partite: campione ridotto, nascosto di default. La soglia di 5 regola la visibilità, non garantisce affidabilità statistica.', en: 'Under 5 games: low sample, hidden by default. The 5-game threshold controls visibility; it does not guarantee statistical reliability.' })}</p>
                    {provisionalDeckCount > 0 ? (
                      <button
                        type="button"
                        aria-pressed={showProvisionalDecks}
                        onClick={() => setShowProvisionalDecks((value) => !value)}
                        className="w-fit rounded-full border border-border bg-background/50 px-3 py-1.5 text-xs font-semibold text-muted-foreground transition hover:border-emerald-500/50 hover:text-emerald-200"
                      >
                        {showProvisionalDecks
                          ? t({ it: 'Nascondi mazzi con meno di 5 partite', en: 'Hide decks under 5 games' })
                          : t({ it: `Mostra ${provisionalDeckCount} mazzi con meno di 5 partite`, en: `Show ${provisionalDeckCount} decks under 5 games` })}
                      </button>
                    ) : null}
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {visibleDeckStats.map((deck, index) => {
                        const isRanked = !isProvisionalDeckRanking(deck.gamesPlayed);
                        const rank = commanderRanksByIndex[index] ?? index + 1;
                        return (
                          <div
                            key={deck.key}
                            className={`flex flex-col gap-3 rounded-lg p-3 sm:flex-row sm:items-start sm:gap-4 ${
                              isRanked && rank === 1 ? 'bg-gradient-to-r from-emerald-500/20 to-teal-500/20 border border-emerald-500/30' :
                              'bg-secondary/50'
                            }`}
                          >
                            <div className="flex items-start gap-3 sm:contents">
                            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                              rank === 1 ? 'bg-gradient-to-br from-emerald-400 to-teal-600 text-white' :
                              rank === 2 ? 'bg-gradient-to-br from-slate-300 to-slate-400 text-slate-800' :
                              rank === 3 ? 'bg-gradient-to-br from-amber-500 to-amber-600 text-white' :
                              'bg-secondary text-secondary-foreground'
                            }`}>
                              {rank}
                            </div>
                            <DeckImage
                              src={deck.commanderImage}
                              alt={deck.commander}
                              className="h-14 w-20 shrink-0 rounded object-cover object-top"
                            />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2 mb-1">
                                {isRanked && rank === 1 && <Trophy className="w-4 h-4 text-emerald-400" />}
                              <p className="font-semibold text-foreground break-words">{deck.commander}</p>
                              {!isRanked ? <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-200">{t({ it: 'Campione ridotto', en: 'Low sample' })}</span> : null}
                              <p className="w-full text-xs text-muted-foreground">{t({ it: 'Proprietario', en: 'Owner' })}: {deck.ownerDisplayName}</p>
                                {deck.bracket && <BracketBadge bracket={deck.bracket} />}
                                <EdhrecBadge commander={deck.commander} />
                              </div>
                              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                                <span>{deck.gamesPlayed} {t({ it: deck.gamesPlayed === 1 ? 'partita' : 'partite', en: deck.gamesPlayed === 1 ? 'game' : 'games' })}</span>
                                <span>{formatMatchRecord(deck)}</span>
                              </div>
                              <div className="mt-2 h-2 bg-secondary rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-gradient-to-r from-emerald-500 to-teal-600 rounded-full"
                                  style={{ width: `${deck.winRate}%` }}
                                />
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center justify-between gap-2 sm:block sm:text-right">
                              <p className="text-xs text-muted-foreground sm:hidden">{t({ it: 'win rate', en: 'win rate' })}</p>
                              <div>
                                <p className="text-2xl font-bold text-emerald-400">{formatWinRate(deck)}</p>
                                <p className="hidden text-xs text-muted-foreground sm:block">{t({ it: 'win rate', en: 'win rate' })}</p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      {visibleDeckStats.length === 0 ? (
                        <p className="py-5 text-center text-sm text-muted-foreground">{t({ it: 'Nessun mazzo ha ancora raggiunto 5 partite.', en: 'No deck has reached 5 games yet.' })}</p>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            </ArenaDataStatus>
</TabsContent>;
}
