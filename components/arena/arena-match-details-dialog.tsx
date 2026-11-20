'use client';
import { useLanguage } from '@/components/language-provider';
import type { useArenaMatchDetails } from '@/hooks/use-arena-match-details';
import type { Match } from '@/lib/types/arena-match';
import { Button } from '@/components/ui/button';
import { DeckImage } from '@/components/deck-image';
import { LiveGameRecapView } from '@/components/live-game/live-game-recap';
import { ModalCard, ModalOverlay } from '@/components/ui/modal-shell';
import { getParticipantDeckSnapshot, getParticipantDisplayName } from '@/lib/arena-participants';
import { formatGameDuration } from '@/lib/live-game-duration';
import { buildHistoricalLiveGameRecord } from '@/lib/live-game-recap';
import { format } from 'date-fns';
import { BarChart3, Clock3 } from 'lucide-react';

type Props = { controls: ReturnType<typeof useArenaMatchDetails>; groupName: string;
  getWinConditionLabel: (condition: Match['win_condition']) => string };
export function ArenaMatchDetailsDialog({ controls, groupName, getWinConditionLabel }: Props) {
  const { copy: t } = useLanguage();
  const { detailsMatch, setDetailsMatch, detailsLiveGame, detailsRecapLoading } = controls;
  return <>{detailsMatch && (
        <ModalOverlay>
          <ModalCard size="lg">
            <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
                  <BarChart3 className="h-5 w-5 text-cyan-300" />
                  {t({ it: 'Dettagli della partita', en: 'Match details' })}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {detailsMatch.played_at ? format(new Date(detailsMatch.played_at), 'PPP') : t({it:'Data non disponibile',en:'Date unavailable'})} · {groupName}
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setDetailsMatch(null)} aria-label={t({ it: 'Chiudi', en: 'Close' })}>
                <span className="text-xl leading-none">×</span>
              </Button>
            </div>
            <div className="max-h-[75vh] space-y-4 overflow-y-auto p-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-border/70 bg-background/35 p-3">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Clock3 className="h-3.5 w-3.5" />{t({ it: 'Durata', en: 'Duration' })}</p>
                  <p className="mt-1 font-bold text-foreground">{detailsMatch.duration_seconds != null ? formatGameDuration(detailsMatch.duration_seconds) : '—'}</p>
                </div>
                <div className="rounded-xl border border-border/70 bg-background/35 p-3">
                  <p className="text-xs text-muted-foreground">{t({ it: 'Vittoria', en: 'Win condition' })}</p>
                  <p className="mt-1 font-bold text-foreground">{detailsMatch.is_draw ? t({ it: 'Patta', en: 'Draw' }) : getWinConditionLabel(detailsMatch.win_condition)}</p>
                </div>
              </div>

              {detailsRecapLoading ? <div className="rounded-xl border border-cyan-400/20 bg-cyan-500/5 p-6 text-center text-sm text-cyan-100">{t({ it: 'Caricamento riepilogo…', en: 'Loading recap…' })}</div> : null}
              {(detailsLiveGame || (detailsMatch.tracking_version != null && detailsMatch.played_at && detailsMatch.created_by)) ? <LiveGameRecapView record={detailsLiveGame ?? buildHistoricalLiveGameRecord({ ...detailsMatch, played_at: detailsMatch.played_at!, created_by: detailsMatch.created_by! })} labels={{ timeline: t({ it: 'Stato finale', en: 'Final state' }), highlights: t({ it: 'Momenti chiave', en: 'Highlights' }), empty: t({ it: 'Nessun momento chiave registrato.', en: 'No highlights recorded.' }) }} /> : null}

              <div className="space-y-3">
                {detailsMatch.match_participants
                  .slice()
                  .sort((a, b) => (a.placement ?? 99) - (b.placement ?? 99))
                  .map((participant) => {
                    const deck = getParticipantDeckSnapshot(participant);
                    const impact = (participant.life_damage_dealt || 0) + (participant.commander_damage_dealt || 0) + (participant.infect_dealt || 0);
                    const damage = participant.life_damage_dealt || 0;
                    const gained = participant.life_gained || 0;
                    const lost = participant.life_lost || 0;
                    const activity = Math.max(1, damage + gained + lost);
                    const damageEnd = (damage / activity) * 100;
                    const gainedEnd = damageEnd + (gained / activity) * 100;
                    const maxImpact = Math.max(1, ...detailsMatch.match_participants.map((entry) => (
                      (entry.life_damage_dealt || 0) + (entry.commander_damage_dealt || 0) + (entry.infect_dealt || 0)
                    )));
                    return (
                      <div key={participant.id} className={`rounded-xl border p-3 ${participant.is_winner ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-border/70 bg-background/25'}`}>
                        <div className="mb-3 flex items-center gap-3">
                          <DeckImage src={deck?.commander_image} alt={deck?.commander || ''} className="h-14 w-10 shrink-0 rounded object-cover object-top" />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-semibold text-foreground">{getParticipantDisplayName(participant)}</p>
                              {participant.placement ? <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">#{participant.placement}</span> : null}
                              {participant.was_starting_player ? <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[11px] text-cyan-200">{t({ it: 'Ha iniziato', en: 'Started' })}</span> : null}
                            </div>
                            <p className="line-clamp-1 text-xs text-emerald-300">{deck?.name || deck?.commander}</p>
                          </div>
                          <div className="ml-auto hidden shrink-0 items-center gap-2 sm:flex">
                            <div className="grid h-14 w-14 place-items-center rounded-full" style={{ background: `conic-gradient(#fb7185 0 ${damageEnd}%, #34d399 ${damageEnd}% ${gainedEnd}%, #38bdf8 ${gainedEnd}% 100%)` }}>
                              <div className="grid h-9 w-9 place-items-center rounded-full bg-card text-[10px] font-black text-foreground">{activity}</div>
                            </div>
                            <div className="text-[10px] leading-4 text-muted-foreground"><p><span className="text-rose-300">●</span> {t({ it: 'danni', en: 'damage' })}</p><p><span className="text-emerald-300">●</span> {t({ it: 'cura', en: 'healing' })}</p><p><span className="text-sky-300">●</span> {t({ it: 'subiti', en: 'taken' })}</p></div>
                          </div>
                        </div>
                        <div className="mb-3 rounded-lg border border-border/60 bg-background/35 p-2.5">
                          <div className="mb-1.5 flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
                            <span>{t({ it: 'Pressione sul tavolo', en: 'Table pressure' })}</span>
                            <span className="font-bold text-foreground">{impact}</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-secondary">
                            <div className={`h-full rounded-full ${participant.is_winner ? 'bg-emerald-400' : 'bg-cyan-400'}`} style={{ width: `${(impact / maxImpact) * 100}%` }} />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                          {[
                            [t({ it: 'Danni inflitti', en: 'Damage dealt' }), participant.life_damage_dealt || 0],
                            ['KO', participant.eliminations_caused || 0],
                            [t({ it: 'Danno commander', en: 'Commander damage' }), participant.commander_damage_dealt || 0],
                            [t({ it: 'Infect inflitto', en: 'Infect dealt' }), participant.infect_dealt || 0],
                          ].filter(([, value]) => Number(value) > 0).map(([label, value]) => (
                            <div key={String(label)} className="rounded-lg bg-secondary/45 px-2.5 py-2">
                              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
                              <p className="font-bold text-foreground">{value}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          </ModalCard>
        </ModalOverlay>
      )}</>;
}
