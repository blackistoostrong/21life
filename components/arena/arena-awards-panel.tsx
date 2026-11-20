'use client';
import { useLanguage } from '@/components/language-provider';
import type { ArenaDataStatusProps } from '@/components/arena/arena-data-status';
import type { Dispatch, SetStateAction } from 'react';
import type { ArenaAward } from '@/lib/deck-performance-analytics';
import type { PlayerAward } from '@/lib/player-awards';
import { ArenaDataStatus } from '@/components/arena/arena-data-status';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TabsContent } from '@/components/ui/tabs';
import { DeckImage } from '@/components/deck-image';
import { formatGameDuration } from '@/lib/live-game-duration';
import { PlayerAwards } from '@/components/arena/player-awards';
import { Trophy, Target, Skull, TrendingUp, Award, Gauge, Flame, Crosshair, Crown } from 'lucide-react';

type Props = { status: Omit<ArenaDataStatusProps, 'children'>;
  awardsView: 'players' | 'decks'; setAwardsView: Dispatch<SetStateAction<'players' | 'decks'>>;
  arenaAwards: ArenaAward[]; arenaAwardGroups: ArenaAward[][]; playerAwards: PlayerAward[];
};
/** Present one report; data loading and shared filters remain with their owners. */
export function ArenaAwardsPanel({ status, awardsView, setAwardsView, arenaAwards, arenaAwardGroups, playerAwards }: Props) {
  const { copy: t, language } = useLanguage();
  return <TabsContent value="awards">
            <ArenaDataStatus loading={status.loading} error={status.error}
              onRetry={status.onRetry}>
            <div className="space-y-5">
              <div>
                <h2 className="flex items-center gap-2 text-xl font-bold text-foreground">
                  <Award className="h-5 w-5 text-emerald-300" /> Awards
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t({
                    it: 'Top 3 per ogni premio. I primati usano tutte le partite registrate; solo il premio Più veloce richiede almeno 3 partite tracciate.',
                    en: 'Top 3 for each award. Records use every saved match; only the Fastest award requires at least 3 tracked games.',
                  })}
                </p>
              </div>
              <div className="flex w-fit rounded-xl border border-border bg-background/40 p-1">
                {(['decks', 'players'] as const).map((view) => <Button key={view} size="sm" variant={awardsView === view ? 'default' : 'ghost'} onClick={() => setAwardsView(view)}>{view === 'players' ? t({ it: 'Giocatori', en: 'Players' }) : t({ it: 'Mazzi', en: 'Decks' })}</Button>)}
              </div>
              {awardsView === 'decks' ? (arenaAwards.length === 0 ? (
                <Card className="phyrexian-panel">
                  <CardContent className="py-12 text-center">
                    <Award className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
                    <h3 className="text-lg font-medium text-foreground">
                      {t({ it: 'Awards non ancora disponibili', en: 'No awards yet' })}
                    </h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {t({ it: 'Completa altre partite con il tracking realtime per sbloccare i primati.', en: 'Complete more realtime-tracked games to unlock playgroup records.' })}
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
                  {arenaAwardGroups.map((awards) => {
                    const leadAward = awards[0];
                    const presentation = leadAward.kind === 'fastest'
                      ? { icon: Gauge, title: t({ it: 'Fastest Deck', en: 'Fastest Deck' }), tone: 'text-cyan-300', badge: 'border-cyan-300/40 bg-cyan-400/10 shadow-cyan-400/20' }
                      : leadAward.kind === 'group_slugger'
                        ? { icon: Flame, title: 'Group Slugger', tone: 'text-orange-300', badge: 'border-orange-300/40 bg-orange-400/10 shadow-orange-400/20' }
                        : leadAward.kind === 'executioner'
                          ? { icon: Crosshair, title: t({ it: 'Executioner', en: 'Executioner' }), tone: 'text-rose-300', badge: 'border-rose-300/40 bg-rose-400/10 shadow-rose-400/20' }
                          : leadAward.kind === 'runner_up'
                            ? { icon: Crown, title: t({ it: 'Eterno Secondo', en: 'Runner-up' }), tone: 'text-amber-300', badge: 'border-amber-300/50 bg-amber-400/15 shadow-amber-400/25' }
                            : leadAward.kind === 'archenemy'
                              ? { icon: Skull, title: 'Archenemy', tone: 'text-red-300', badge: 'border-red-300/40 bg-red-400/10 shadow-red-400/20' }
                              : leadAward.kind === 'comebacker'
                                ? { icon: TrendingUp, title: 'Comebacker', tone: 'text-emerald-300', badge: 'border-emerald-300/40 bg-emerald-400/10 shadow-emerald-400/20' }
                                : leadAward.kind === 'one_trick'
                                  ? { icon: Target, title: 'The one-trick', tone: 'text-blue-300', badge: 'border-blue-300/40 bg-blue-400/10 shadow-blue-400/20' }
                                  : leadAward.kind === 'combo_winner'
                                    ? { icon: Flame, title: 'I think I won', tone: 'text-teal-300', badge: 'border-teal-300/40 bg-teal-400/10 shadow-teal-400/20' }
                                    : { icon: Trophy, title: 'Junk Master', tone: 'text-lime-300', badge: 'border-lime-300/40 bg-lime-400/10 shadow-lime-400/20' };
                    const Icon = presentation.icon;
                    const awardDescription = leadAward.kind === 'fastest'
                      ? t({ it: 'Le vittorie più rapide tra i mazzi tracciati.', en: 'Fastest wins among tracked decks.' })
                      : leadAward.kind === 'group_slugger'
                        ? t({ it: 'Il mazzo che ha inflitto più danni al tavolo.', en: 'The deck that dealt the most damage to the table.' })
                        : leadAward.kind === 'executioner'
                          ? t({ it: 'Il mazzo con più eliminazioni.', en: 'The deck with the most eliminations.' })
                          : leadAward.kind === 'runner_up'
                            ? t({ it: 'Il mazzo arrivato più spesso al secondo posto.', en: 'The deck that finished second most often.' })
                            : leadAward.kind === 'archenemy'
                              ? t({ it: 'Il mazzo sconfitto per primo più spesso.', en: 'The deck eliminated first most often.' })
                              : leadAward.kind === 'comebacker'
                                ? t({ it: 'Le vittorie ottenute dopo essere stato in svantaggio.', en: 'Wins earned after falling behind.' })
                                : leadAward.kind === 'one_trick'
                                  ? t({ it: 'Il mazzo portato al tavolo più spesso.', en: 'The deck brought to the table most often.' })
                                  : leadAward.kind === 'combo_winner'
                                    ? t({ it: 'Le vittorie concluse con una combo.', en: 'Wins completed with a combo.' })
                                    : t({ it: 'Le vittorie ottenute con condizioni alternative.', en: 'Wins achieved through alternate conditions.' });
                    return (
                      <Card key={leadAward.kind} className="phyrexian-panel overflow-hidden border-white/10 bg-card/70">
                        <CardContent className="p-4">
                          <div className="mb-4 flex items-center justify-between gap-3 border-b border-white/10 pb-3">
                            <span className={`relative grid h-10 w-10 place-items-center overflow-hidden rounded-xl border shadow-lg ${presentation.badge}`}>
                              <Trophy aria-hidden="true" className="absolute -right-1 -top-1 h-5 w-5 text-white/10" />
                              <Icon className={`relative h-5 w-5 ${presentation.tone}`} />
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{presentation.title}</p>
                              <p className={`text-sm font-bold ${presentation.tone}`}>{t({ it: 'Top 3 mazzi', en: 'Top 3 decks' })}</p>
                            </div>
                            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                              {awards.length}/3
                            </span>
                          </div>
                          <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{awardDescription}</p>
                          <div className="space-y-3">
                            {awards.map((award) => {
                              const podium = award.rank === 1
                                ? { label: t({ it: 'Oro', en: 'Gold' }), tone: 'border-yellow-300 bg-yellow-300 text-yellow-950' }
                                : award.rank === 2
                                  ? { label: t({ it: 'Argento', en: 'Silver' }), tone: 'border-slate-200 bg-slate-200 text-slate-950' }
                                  : { label: t({ it: 'Bronzo', en: 'Bronze' }), tone: 'border-orange-500 bg-orange-600 text-white' };
                              const value = award.kind === 'fastest' ? formatGameDuration(award.value) : String(award.value);

                              return (
                                <div key={`${award.kind}:${award.rank}:${award.deck.key}`} className="flex items-center gap-3 rounded-xl border border-white/10 bg-background/35 p-2.5">
                                  <span aria-label={`${podium.label}, ${award.rank}`} className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-black ${podium.tone}`}>
                                    {award.rank}
                                  </span>
                                  <DeckImage src={award.deck.commanderImage} alt={award.deck.commander} className="h-14 w-10 shrink-0 rounded object-cover object-top" />
                                  <div className="min-w-0 flex-1">
                                    <p className="line-clamp-1 font-semibold text-foreground">{award.deck.name}</p>
                                    <p className="line-clamp-1 text-xs text-emerald-300">{award.deck.commander}</p>
                                    <p className="line-clamp-1 text-[11px] text-muted-foreground">{t({ it: 'Proprietario', en: 'Owner' })}: {award.deck.ownerDisplayName}</p>
                                    <p className="mt-1 text-[11px] text-muted-foreground">
                                      {award.kind === 'one_trick' ? award.deck.gamesPlayed : award.deck.trackedGames}{' '}
                                      {award.kind === 'one_trick'
                                        ? t({ it: 'partite', en: 'games' })
                                        : t({ it: 'partite tracciate', en: 'tracked games' })}
                                    </p>
                                  </div>
                                  <span className={`shrink-0 text-sm font-black tabular-nums ${presentation.tone}`}>
                                    {value}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )) : <PlayerAwards awards={playerAwards} language={language} />}
            </div>

            </ArenaDataStatus>
</TabsContent>;
}
