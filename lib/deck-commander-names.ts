import { expandDeckCommanderNames } from '@/packages/domain/commander-names';
import { getCommanderOptions, type DeckColorRecord } from '@/lib/deck-metadata';

/** Names are independent of collection statistics and CMC aggregation. */
export function getDeckCommanderNames(deck: Pick<DeckColorRecord, 'commander_options'> & { commander: string }) {
  const optionNames = getCommanderOptions(deck)
    .map((option) => option.name.trim())
    .filter(Boolean);

  if (optionNames.length > 0) {
    return Array.from(new Set(optionNames));
  }

  return expandDeckCommanderNames(deck.commander);
}
