/** Search preserves the owner of every matching deck and never mutates catalog rows. */
type Deck = { name: string; commander: string };
type Guest<D extends Deck> = { display_name: string; arena_guest_decks?: D[] };
function normalized(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en').trim();
}
export function searchGuestDirectory<D extends Deck, G extends Guest<D>>(guests: readonly G[], query: string) {
  const tokens = normalized(query).split(/\s+/).filter(Boolean);
  return guests.flatMap(guest => {
    const decks = guest.arena_guest_decks ?? [];
    const name = normalized(guest.display_name);
    const ownerMatches = tokens.every(token => name.includes(token));
    const matchedDecks = ownerMatches ? decks : decks.filter(deck => {
      const text = normalized(`${guest.display_name} ${deck.name} ${deck.commander}`);
      return tokens.every(token => text.includes(token));
    });
    return ownerMatches || matchedDecks.length ? [{ guest, decks: matchedDecks, searching: tokens.length > 0 }] : [];
  });
}
