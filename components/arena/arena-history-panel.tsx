'use client';
import { useLanguage } from '@/components/language-provider';
import type { useArenaMatchHistory } from '@/hooks/use-arena-match-history';
import type { useArenaSeasonContext } from '@/hooks/use-arena-season-context';
import type { ArenaSeasonContext } from '@/lib/arena-seasons';
import type { ArenaMatchDayGroup } from '@/lib/arena-session';
import type { Match } from '@/lib/types/arena-match';
import { ArenaHistoryPagination } from '@/components/arena/arena-history-pagination';
import { ArenaDataStatus } from '@/components/arena/arena-data-status';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TabsContent } from '@/components/ui/tabs';
import { DeckImage } from '@/components/deck-image';
import { PreviousSeasonsPanel } from '@/components/arena/previous-seasons-panel';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { FormattedMarkdown } from '@/components/ui/formatted-markdown';
import { getParticipantDeckSnapshot, getParticipantDisplayName } from '@/lib/arena-participants';
import { Trophy, Trash2, ChevronDown, Download, Target, Skull, Pencil, Eye, Share2, Flame, Crown, Shield, Flag } from 'lucide-react';

type Props = {
  season: Pick<ReturnType<typeof useArenaSeasonContext>, 'loading' | 'error' | 'reload'>;
  history: Pick<ReturnType<typeof useArenaMatchHistory>, 'loading' | 'error' | 'total' | 'from' | 'to' | 'canGoNext' | 'canGoPrevious' | 'next' | 'previous' | 'retry'>;
  seasonContext: ArenaSeasonContext | null;
  matchDayGroups: ArenaMatchDayGroup<Match>[]; expandedDayKeys: Set<string>;
  toggleDayGroup: (dayKey: string, open: boolean) => void;
  onCreateMatch: () => void;
  actions: {
    openDayExportModal: (dayKey: string) => void; setDetailsMatch: (match: Match | null) => void;
    handleShareMatch: (match: Match) => Promise<void>; openEditMatch: (match: Match) => void;
    deletingMatch: boolean; handleDeleteMatch: (id: string) => Promise<void>;
  };
};
/** Historical rows and controls; queries and command lifetimes remain in owners. */
export function ArenaHistoryPanel({ season, history, seasonContext, matchDayGroups, expandedDayKeys, toggleDayGroup, onCreateMatch, actions }: Props) {
  const { copy: t } = useLanguage();
  const { openDayExportModal, setDetailsMatch, handleShareMatch, openEditMatch, deletingMatch, handleDeleteMatch } = actions;
  return <TabsContent value="matches">
            <ArenaDataStatus loading={season.loading} error={season.error} onRetry={season.reload}>
            <ArenaHistoryPagination loading={history.loading} error={history.error} total={history.total} from={history.from} to={history.to}
              canGoNext={history.canGoNext} canGoPrevious={history.canGoPrevious} onNext={history.next} onPrevious={history.previous} onRetry={history.retry} />
            {!history.loading && !history.error && history.total === 0 ? (
              <Card className="phyrexian-panel">
                <CardContent className="py-12 text-center">
                  <Skull className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-foreground mb-2">{t({ it: 'Nessuna partita', en: 'No battles yet' })}</h3>
                  <p className="text-muted-foreground mb-4">{t({ it: 'Registra la prima partita per iniziare a tracciare i risultati', en: 'Record your first battle to begin tracking' })}</p>
                  <Button
                    onClick={onCreateMatch}
                    className="bg-gradient-to-r from-emerald-600 to-teal-700"
                  >
                    <Target className="w-4 h-4 mr-2" /> {t({ it: 'Registra la prima partita', en: 'Record First Battle' })}
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {matchDayGroups.map((dayGroup) => {
                  const isExpanded = expandedDayKeys.has(dayGroup.dayKey);
                  return (
                    <Collapsible
                      key={dayGroup.dayKey}
                      open={isExpanded}
                      onOpenChange={(open) => toggleDayGroup(dayGroup.dayKey, open)}
                    >
                      <Card className="phyrexian-panel overflow-hidden">
                        <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
                          <CollapsibleTrigger asChild>
                            <button
                              type="button"
                              className="flex min-w-0 flex-1 items-center gap-2 text-left"
                            >
                              <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                              <span className="font-medium text-foreground">{dayGroup.label}</span>
                              <span className="text-sm text-muted-foreground">
                                · {dayGroup.matchCount}{' '}
                                {t({
                                  it: dayGroup.matchCount === 1 ? 'partita' : 'partite',
                                  en: dayGroup.matchCount === 1 ? 'match' : 'matches',
                                })}
                              </span>
                            </button>
                          </CollapsibleTrigger>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="shrink-0 border-border/80 bg-background/40"
                            onClick={() => openDayExportModal(dayGroup.dayKey)}
                          >
                            <Download className="mr-2 h-4 w-4" />
                            {t({ it: 'Export', en: 'Export' })}
                          </Button>
                        </div>
                        <CollapsibleContent>
                          <div className="space-y-3 p-3">
                            {dayGroup.matches.length === 0 && isExpanded ? (
                              <p className="py-4 text-center text-sm text-muted-foreground">
                                {t({ it: 'Nessuna partita in questa giornata', en: 'No matches on this day' })}
                              </p>
                            ) : null}
                            {dayGroup.matches.map((match) => (
                              <Card key={match.id} className="border-border/70 bg-background/20 transition-colors hover:border-emerald-500/40">
                                <CardContent className="py-4">
                                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                    <div className="min-w-0 flex-1">
                                      <p className="mb-2 text-sm text-muted-foreground">{match.match_participants.length} {t({ it: match.match_participants.length === 1 ? 'giocatore' : 'giocatori', en: match.match_participants.length === 1 ? 'player' : 'players' })}</p>
                                      <div className="mb-3 flex flex-col gap-2">
                                        {match.match_participants.map((p) => {
                                          const deck = getParticipantDeckSnapshot(p);
                                          const displayName = getParticipantDisplayName(p);
                                          return (
                                            <div
                                              key={p.id}
                                              className={`flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-sm ${
                                                p.is_winner
                                                  ? 'border border-emerald-500/30 bg-emerald-500/20 text-emerald-300'
                                                  : 'bg-secondary/80 text-secondary-foreground'
                                              }`}
                                            >
                                              <DeckImage
                                                src={deck?.commander_image}
                                                alt={deck?.commander || displayName}
                                                className="h-[4.5rem] w-[3.25rem] shrink-0 rounded object-cover object-top"
                                                fallbackClassName="h-[4.5rem] w-[3.25rem] shrink-0 rounded"
                                              />
                                              <div className="min-w-0 flex-1">
                                                <div className="flex flex-wrap items-center gap-1.5">
                                                  {p.is_winner && <Trophy className="h-3.5 w-3.5 shrink-0" />}
                                                  {p.is_winner && match.win_condition === 'last_standing' ? <Shield className="h-3.5 w-3.5 shrink-0" /> : null}
                                                  {p.is_winner && match.win_condition === 'combo' ? <Flame className="h-3.5 w-3.5 shrink-0" /> : null}
                                                  {p.is_winner && match.win_condition === 'concession' ? <Flag className="h-3.5 w-3.5 shrink-0" /> : null}
                                                  {p.is_winner && match.win_condition === 'alternate_card' ? <Crown className="h-3.5 w-3.5 shrink-0" /> : null}
                                                  {p.is_winner && match.win_condition === 'other' ? <Target className="h-3.5 w-3.5 shrink-0" /> : null}
                                                  <span className="font-semibold">{displayName}</span>
                                                  {deck?.bracket && (
                                                    <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] text-emerald-300">
                                                      B{deck.bracket}
                                                    </span>
                                                  )}
                                                </div>
                                                {deck?.name ? (
                                                  <p className="mt-0.5 line-clamp-1 text-sm font-medium text-foreground">{deck.name}</p>
                                                ) : null}
                                                {deck?.commander ? (
                                                  <p className="line-clamp-2 text-xs leading-snug text-muted-foreground">{deck.commander}</p>
                                                ) : null}
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                      {match.is_draw ? (
                                        <span className="mb-2 inline-flex rounded-full border border-slate-400/40 bg-slate-500/15 px-2.5 py-0.5 text-xs font-medium text-slate-200">
                                          {t({ it: 'Patta', en: 'Draw' })}
                                        </span>
                                      ) : null}
                                      {match.notes ? <FormattedMarkdown value={match.notes} className="italic" /> : null}
                                    </div>
                                    <div className="flex items-center gap-1">
                                      {(match.tracking_version || match.duration_seconds != null) ? (
                                        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-cyan-300" onClick={() => setDetailsMatch(match)} title={t({ it: 'Dettagli tracking', en: 'Tracking details' })}>
                                          <Eye className="h-4 w-4" />
                                          <span className="hidden lg:inline">{t({ it: 'Dettagli', en: 'Details' })}</span>
                                        </Button>
                                      ) : null}
                                      <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-emerald-300" onClick={() => handleShareMatch(match)} title={t({ it: 'Condividi log', en: 'Share log' })}>
                                        <Share2 className="h-4 w-4" />
                                      </Button>
                                      <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground" onClick={() => openEditMatch(match)}>
                                        <Pencil className="h-4 w-4" />
                                      </Button>
                                      <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" disabled={deletingMatch} onClick={() => handleDeleteMatch(match.id)}>
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  </div>
                                </CardContent>
                              </Card>
                            ))}
                          </div>
                        </CollapsibleContent>
                      </Card>
                    </Collapsible>
                  );
                })}
              </div>
            )}
            {seasonContext ? <PreviousSeasonsPanel archives={seasonContext.archives} /> : null}

            </ArenaDataStatus>
</TabsContent>;
}
