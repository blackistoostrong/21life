import type { ArenaGuestDeck } from '@/lib/arena-participants';

export type DeckOption = {
  id: string;
  name: string;
  commander: string;
  commander_image: string | null;
  bracket: string | null;
  source_type?: string | null;
  is_favorite?: boolean;
};

export function toDeckOption(deck: DeckOption | ArenaGuestDeck): DeckOption {
  return {
    id: deck.id,
    name: deck.name,
    commander: deck.commander,
    commander_image: deck.commander_image,
    bracket: deck.bracket,
    source_type: 'source_type' in deck ? deck.source_type : 'guest',
    is_favorite: 'is_favorite' in deck ? Boolean(deck.is_favorite) : false,
  };
}
