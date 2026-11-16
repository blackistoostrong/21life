import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, Text } from 'react-native';
import { Button } from '@/components/ui/button';
import { PhyrexianPanel } from '@/components/ui/phyrexian-panel';
import { PersonalAnalyticsSection } from '@/components/dashboard/personal-analytics-section';
import { StatsSkeleton } from '@/components/ui/screen-skeletons';
import { Screen } from '@/components/ui/screen';
import { useAuth } from '@/contexts/auth-context';
import { useLanguage } from '@/contexts/language-context';
import { colors } from '@/constants/theme';
import { usePersonalAnalytics } from '@/hooks/use-personal-analytics';
import { useScreenInsets } from '@/hooks/use-screen-insets';

export default function StatsScreen() {
  const { user } = useAuth();
  const { copy, language } = useLanguage();
  const { analytics, loading, error, refresh } = usePersonalAnalytics(user?.id);
  const [refreshing, setRefreshing] = useState(false);
  const { scrollContentStyle } = useScreenInsets();

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await refresh(); } finally { setRefreshing(false); }
  }, [refresh]);

  if (loading && !analytics) {
    return <StatsSkeleton contentStyle={scrollContentStyle} />;
  }

  return (
    <Screen scroll={false} padded={false}>
      <ScrollView
        contentContainerStyle={scrollContentStyle}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
        }
      >
        {error ? <PhyrexianPanel><Text accessibilityRole="alert" style={{ color: colors.foreground }}>{language === 'it'
          ? 'Statistiche non disponibili. Nessun risultato parziale viene mostrato.'
          : 'Statistics unavailable. Partial results are not displayed.'}</Text><Button label={language === 'it' ? 'Riprova' : 'Retry'} onPress={()=>void refresh()} /></PhyrexianPanel> : <PersonalAnalyticsSection
          analytics={analytics}
          language={language}
          title={copy('personalAnalytics')}
          subtitle={copy('personalAnalyticsHint')}
          emptyTitle={copy('noPersonalDataTitle')}
          emptyBody={copy('noPersonalDataBody')}
          topDecksTitle={copy('topDecks')}
          topDecksSubtitle={copy('topDecksHint')}
          decksPlayedLabel={copy('decksPlayed')}
          winsLabel={copy('wins')}
          winRateLabel={copy('winRate')}
          winLabel={copy('win')}
          colorsTitle={copy('mostPlayedColors')}
          colorWinRatesTitle={copy('colorWinRatesTitle')}
          currentWinStreakLabel={copy('currentWinStreak')}
          longestWinStreakLabel={copy('longestWinStreak')}
          bestDeckTitle={copy('bestDeck')}
          bestDeckHint={copy('personalBestDeckHint')}
          trackedGamesLabel={copy('trackedGamesTitle')}
          showProvisionalDecksLabel={copy('showProvisionalDecks')}
          hideProvisionalDecksLabel={copy('hideProvisionalDecks')}
          provisionalDeckSampleLabel={copy('provisionalDeckSample')}
          noRankedDecksLabel={copy('noRankedDecks')}
        />}
      </ScrollView>
    </Screen>
  );
}
