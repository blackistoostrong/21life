import { buildProfileCatalogMetric, type ProfileCatalogMetrics } from '@/packages/domain/profile-catalog-metrics';
import type { DeckPerformanceStats } from '@/lib/deck-performance-analytics';

type CatalogLabel = { id: string;name: string;commander: string;commander_image: string | null;bracket: string | null };
export function buildWebProfileMetricMaps(report: ProfileCatalogMetrics, catalog: CatalogLabel[]) {
  const labels = new Map(catalog.map(deck=>[deck.id,deck]));
  const performance = new Map<string,DeckPerformanceStats>();
  for (const row of report.decks) {
    const deck=labels.get(row.deck_id);
    if (!deck) continue;
    performance.set(row.deck_id,{ ...buildProfileCatalogMetric(row),key: `deck:${row.deck_id}`,deckId: row.deck_id,
      isGuestDeck: false,name: deck.name,commander: deck.commander,commanderImage: deck.commander_image,
      bracket: deck.bracket,ownerDisplayName: 'Player' });
  }
  // Every displayed catalog entry must have explicit aggregate counts, including zero-game decks.
  if (catalog.some(deck=>!performance.has(deck.id))) throw new Error('ANALYTICS_CATALOG_CHANGED');
  return { performance,winRates: performance };
}
