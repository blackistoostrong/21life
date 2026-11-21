'use client';
import { useLanguage } from '@/components/language-provider';
import type { PlayerStats } from '@/lib/types/arena-player-report';
import type { ArenaDataStatusProps } from '@/components/arena/arena-data-status';
import type { useArenaGuestCommands } from '@/hooks/use-arena-guest-commands';
import { ArenaDataStatus } from '@/components/arena/arena-data-status';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { type ArenaGuest } from '@/lib/arena-participants';
import { parseParticipantKey, type ParticipantKey } from '@/lib/participant-keys';
import { Users, Trophy, Trash2, User, TrendingUp, Medal, BarChart3 } from 'lucide-react';
import { formatMatchRecord } from '@/lib/win-rate';

type Props = { status: Omit<ArenaDataStatusProps, 'children'>; playerStats: PlayerStats[];
  playerRanksByIndex: number[]; totalMatches: number | undefined;
  guests: ArenaGuest[]; canManageGroup: boolean;
  guestDeletion: Pick<ReturnType<typeof useArenaGuestCommands>, 'deletingGuestIds' | 'handleDeleteGuest'>; };
function PlayerGuestDeleteButton({
  playerKey,
  guests,
  deletingGuestIds,
  onDeleteGuest,
  deleteLabel,
}: {
  playerKey: ParticipantKey;
  guests: ArenaGuest[];
  deletingGuestIds: string[];
  onDeleteGuest: (guest: ArenaGuest) => void;
  deleteLabel: string;
}) {
  const guestId = parseParticipantKey(playerKey)?.id;
  const guest = guests.find((entry) => entry.id === guestId);
  if (!guest) return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
      onClick={() => onDeleteGuest(guest)}
      disabled={deletingGuestIds.includes(guest.id)}
      title={deleteLabel}
    >
      <Trash2 className={`h-4 w-4 ${deletingGuestIds.includes(guest.id) ? 'animate-pulse' : ''}`} />
    </Button>
  );
}
/** Presentation only; report availability never gates membership management. */
export function ArenaPlayerReport({ status, playerStats, playerRanksByIndex, totalMatches, guests, canManageGroup, guestDeletion }: Props) {
  const { copy: t } = useLanguage();
  const { deletingGuestIds, handleDeleteGuest } = guestDeletion;
  return <ArenaDataStatus loading={status.loading} error={status.error}
                onRetry={status.onRetry}>
                {playerStats.length === 0 && (
                  <Card className="bg-card/50 border-border">
                    <CardContent className="py-8 text-center">
                      <User className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        {t({ it: 'Nessuna partita nel periodo selezionato.', en: 'No battles in the selected period.' })}
                      </p>
                    </CardContent>
                  </Card>
                )}
                {playerStats.length > 0 && (
                <>
                <div className="grid gap-3 sm:gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <Card className="bg-gradient-to-br from-emerald-500/20 to-teal-600/20 border-emerald-500/30">
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-2 text-emerald-400 mb-2">
                        <Trophy className="w-5 h-5" />
                        <span className="text-sm font-medium">{t({ it: 'Miglior giocatore', en: 'Top Player' })}</span>
                      </div>
                      <p className="text-2xl font-bold text-foreground">{playerStats[0]?.displayName || '-'}</p>
                      <p className="text-sm text-muted-foreground">{playerStats[0]?.winRate}% {t({ it: 'win rate', en: 'win rate' })}</p>
                    </CardContent>
                  </Card>
                  <Card className="bg-card/50 border-border">
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-2 text-muted-foreground mb-2">
                        <Users className="w-5 h-5" />
                        <span className="text-sm font-medium">{t({ it: 'Giocatori attivi', en: 'Active Players' })}</span>
                      </div>
                      <p className="text-2xl font-bold text-foreground">{playerStats.length}</p>
                      <p className="text-sm text-muted-foreground">{t({ it: 'partecipanti totali', en: 'total participants' })}</p>
                    </CardContent>
                  </Card>
                  <Card className="bg-card/50 border-border">
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-2 text-muted-foreground mb-2">
                        <BarChart3 className="w-5 h-5" />
                        <span className="text-sm font-medium">{t({ it: 'Partite totali', en: 'Total Games' })}</span>
                      </div>
                      <p className="text-2xl font-bold text-foreground">{totalMatches ?? '—'}</p>
                      <p className="text-sm text-muted-foreground">{t({ it: 'partite registrate', en: 'battles recorded' })}</p>
                    </CardContent>
                  </Card>
                  <Card className="bg-card/50 border-border">
                    <CardContent className="pt-6">
                      <div className="flex items-center gap-2 text-muted-foreground mb-2">
                        <TrendingUp className="w-5 h-5" />
                        <span className="text-sm font-medium">{t({ it: 'Win rate medio', en: 'Avg Win Rate' })}</span>
                      </div>
                      <p className="text-2xl font-bold text-foreground">
                        {Math.round(playerStats.reduce((a, b) => a + b.winRate, 0) / playerStats.length)}%
                      </p>
                      <p className="text-sm text-muted-foreground">{t({ it: 'su tutti i giocatori', en: 'across all players' })}</p>
                    </CardContent>
                  </Card>
                </div>

                <Card className="bg-card/50 border-border">
                  <CardHeader>
                    <CardTitle className="text-foreground flex items-center gap-2">
                      <Medal className="w-5 h-5" />
                      {t({ it: 'Classifica giocatori', en: 'Player Leaderboard' })}
                    </CardTitle>
                    <CardDescription>{t({ it: 'Ordinata per win rate', en: 'Rankings by win rate' })}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {playerStats.map((player, index) => {
                        const rank = playerRanksByIndex[index] ?? index + 1;
                        return (
                        <div
                          key={player.key}
                          className={`flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-4 rounded-lg ${
                            rank === 1 ? 'bg-gradient-to-r from-emerald-500/20 to-teal-500/20 border border-emerald-500/30' :
                            rank === 2 ? 'bg-gradient-to-r from-slate-400/10 to-slate-500/10 border border-slate-400/20' :
                            rank === 3 ? 'bg-gradient-to-r from-amber-600/10 to-amber-700/10 border border-amber-600/20' :
                            'bg-secondary/50'
                          }`}
                        >
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg ${
                            rank === 1 ? 'bg-gradient-to-br from-emerald-400 to-teal-600 text-white' :
                            rank === 2 ? 'bg-gradient-to-br from-slate-300 to-slate-400 text-slate-800' :
                            rank === 3 ? 'bg-gradient-to-br from-amber-500 to-amber-600 text-white' :
                            'bg-secondary text-secondary-foreground'
                          }`}>
                            {rank}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-semibold text-foreground">{player.displayName}</p>
                              {player.isGuest && (
                                <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-200">
                                  Guest
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-4 text-sm text-muted-foreground">
                              <span>{player.gamesPlayed} {t({ it: player.gamesPlayed === 1 ? 'partita' : 'partite', en: player.gamesPlayed === 1 ? 'game' : 'games' })}</span>
                              <span>{formatMatchRecord(player)}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 sm:justify-end">
                            <div className="text-left sm:text-right">
                              <p className="text-2xl font-bold text-emerald-400">{player.winRate}%</p>
                              <p className="text-xs text-muted-foreground">{t({ it: 'win rate', en: 'win rate' })}</p>
                            </div>
                            {canManageGroup && player.isGuest && (
                              <PlayerGuestDeleteButton
                                playerKey={player.key}
                                guests={guests}
                                deletingGuestIds={deletingGuestIds}
                                onDeleteGuest={handleDeleteGuest}
                                deleteLabel={t({ it: 'Elimina guest', en: 'Delete guest' })}
                              />
                            )}
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
                </>
                )}
              </ArenaDataStatus>;
}
