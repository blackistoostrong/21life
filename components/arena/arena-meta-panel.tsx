'use client';
import { useLanguage } from '@/components/language-provider';
import type { ArenaDataStatusProps } from '@/components/arena/arena-data-status';
import type { ArenaAnalyticsReport } from '@/packages/domain/arena-analytics';
import type { ArenaColorAnalytics } from '@/lib/arena-color-analytics';
import { ArenaDataStatus } from '@/components/arena/arena-data-status';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TabsContent } from '@/components/ui/tabs';
import { ManaColorPairs, ManaColorReport } from '@/components/arena/mana-color-charts';
import { Palette, Loader2 } from 'lucide-react';

type Props = { status: Omit<ArenaDataStatusProps, 'children'>;
  analyticsPayload: Partial<ArenaAnalyticsReport>; colorAnalytics: ArenaColorAnalytics; syncingDeckColors: boolean;
};
/** Present one report; data loading and shared filters remain with their owners. */
export function ArenaMetaPanel({ status, analyticsPayload, colorAnalytics, syncingDeckColors }: Props) {
  const { copy: t } = useLanguage();
  return <TabsContent value="meta">
            <ArenaDataStatus loading={status.loading} error={status.error}
              onRetry={status.onRetry}>
            {analyticsPayload.totalMatches === 0 ? (
              <Card className="phyrexian-panel">
                <CardContent className="py-12 text-center">
                  <Palette className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
                  <h3 className="mb-2 text-lg font-medium text-foreground">
                    {t({ it: 'Nessun dato meta ancora', en: 'No meta data yet' })}
                  </h3>
                  <p className="text-muted-foreground">
                    {t({ it: 'Gioca partite con mazzi tracciati per vedere il meta colori del playgroup.', en: 'Play tracked-deck battles to see this playgroup\'s color meta.' })}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-5">
                {(syncingDeckColors || colorAnalytics.missingColorGames > 0) && (
                  <Card className="border-border/70 bg-card/50">
                    <CardContent className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        {syncingDeckColors && <Loader2 className="h-4 w-4 animate-spin text-emerald-300" />}
                        <span>
                          {syncingDeckColors
                            ? t({ it: 'Sto aggiornando i colori dei mazzi mancanti...', en: 'Updating missing deck colors...' })
                            : t({
                                it: `${colorAnalytics.missingColorGames} partite hanno ancora mazzi senza colori risolti.`,
                                en: `${colorAnalytics.missingColorGames} games still have decks without resolved colors.`,
                              })}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                )}

                <Card className="phyrexian-panel">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-foreground">
                      <Palette className="h-5 w-5 text-emerald-300" />
                      {t({ it: 'Meta colori', en: 'Color meta' })}
                    </CardTitle>
                    <CardDescription>
                      {t({
                        it: 'Statistiche per W, U, B, R, G e incolore (C). I colori senza partite restano visibili ma attenuati.',
                        en: 'Stats for W, U, B, R, G, and colorless (C). Colors with no games stay visible but muted.',
                      })}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ManaColorReport
                      played={colorAnalytics.played}
                      won={colorAnalytics.won}
                      winRates={colorAnalytics.winRates}
                      missingColorGames={colorAnalytics.missingColorGames}
                      emptyLabel={t({
                        it: 'Nessun colore risolto nel periodo selezionato. Attendi la sincronizzazione o verifica che i mazzi abbiano il comandante impostato.',
                        en: 'No resolved colors in the selected period. Wait for sync or make sure decks have a commander set.',
                      })}
                    />
                  </CardContent>
                </Card>

                <Card className="phyrexian-panel">
                  <CardHeader>
                    <CardTitle className="text-foreground">
                      {t({ it: 'Identità multicolore', en: 'Multicolor identities' })}
                    </CardTitle>
                    <CardDescription>
                      {t({
                        it: 'Le 5 combinazioni più frequenti: gilde, tricolori (Naya, Grixis, Jeskai, Mardu, ecc.) o Pentacolor.',
                        en: 'Top 5 combinations: guilds, three-color identities (Naya, Grixis, Jeskai, Mardu, etc.), or Pentacolor.',
                      })}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ManaColorPairs
                      pairs={colorAnalytics.pairs}
                      emptyLabel={t({
                        it: 'Nessuna identità multicolore nel periodo selezionato.',
                        en: 'No multicolor identities in the selected period.',
                      })}
                    />
                  </CardContent>
                </Card>
              </div>
            )}

            </ArenaDataStatus>
</TabsContent>;
}
