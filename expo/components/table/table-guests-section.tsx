import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CommanderArt } from '@/components/deck/commander-art';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { colors } from '@/constants/theme';
import type { ArenaGuest, ArenaGuestDeck } from '@/lib/arena-participants';
import { searchGuestDirectory } from '../../../packages/domain/guest-directory';

type TableGuestsSectionProps = {
  guests: ArenaGuest[];
  language: 'it' | 'en';
  canManage: boolean;
  labels: {
    guestManagement: string;
    addGuest: string;
    noGuestsBody: string;
    guestBadge: string;
    upgradeGuest: string;
    addDeckToGuest: string;
    deleteGuest: string;
  };
  onAddGuest: () => void;
  onAddDeckToGuest: (guestId: string) => void;
  onDeleteGuest: (guestId: string) => void;
  onUpgradeGuest: (guestId: string) => void;
};

export function TableGuestsSection({guests, language, canManage, labels, onAddGuest, onAddDeckToGuest, onDeleteGuest, onUpgradeGuest}: TableGuestsSectionProps) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string[]>([]);
  const it = language === 'it';
  const rows = searchGuestDirectory<ArenaGuestDeck, ArenaGuest>(guests, query);
  return <View style={styles.section}>
    {canManage ? <Button label={labels.addGuest} onPress={onAddGuest} /> : null}
    {guests.length ? <>
      <Input value={query} onChangeText={setQuery} autoCorrect={false}
        label={it ? 'Cerca guest, mazzo o comandante' : 'Search guest, deck or commander'} />
      {query ? <Button variant="ghost" label={it ? 'Azzera ricerca' : 'Clear search'} onPress={() => setQuery('')} /> : null}
      <Text accessibilityLiveRegion="polite" style={styles.hint}>{rows.length} / {guests.length} guest</Text>
    </> : <Text style={styles.hint}>{labels.noGuestsBody}</Text>}
    {guests.length > 0 && !rows.length ? <Text style={styles.hint}>{it ? 'Nessun risultato. Prova un altro nome.' : 'No results. Try another name.'}</Text> : null}
    {rows.map(({guest, decks, searching}) => {
      const open = searching || expanded.includes(guest.id);
      const count = guest.arena_guest_decks?.length ?? 0;
      return <View key={guest.id} style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.name}>{guest.display_name}</Text>
          <Text style={styles.hint}>{count} {it ? 'mazzi' : 'decks'}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityState={{expanded: open}}
          accessibilityLabel={`${open ? (it ? 'Nascondi mazzi' : 'Hide decks') : (it ? 'Mostra mazzi' : 'Show decks')}: ${guest.display_name}`}
          disabled={searching} onPress={() => setExpanded(ids => ids.includes(guest.id) ? ids.filter(id => id !== guest.id) : [...ids, guest.id])}
          style={styles.toggle}>
          <Text style={styles.link}>{it ? 'Mazzi del guest' : 'Guest decks'} {open ? '▴' : '▾'}</Text>
        </Pressable>
        {open ? <View style={styles.section}>
          {!decks.length ? <Text style={styles.hint}>{it ? 'Nessun mazzo registrato.' : 'No decks yet.'}</Text> : null}
          {decks.map(deck => <View key={deck.id} style={styles.deck}>
            <CommanderArt uri={deck.commander_image} alt={deck.commander} size="xs" />
            <View style={styles.info}><Text style={styles.deckName}>{deck.name}</Text><Text style={styles.hint}>{deck.commander}</Text></View>
          </View>)}
        </View> : null}
        {canManage ? <View style={styles.actions}>
          <Button variant="outline" label={`${labels.addDeckToGuest}: ${guest.display_name}`} onPress={() => onAddDeckToGuest(guest.id)} />
          <Button variant="outline" label={`${labels.upgradeGuest}: ${guest.display_name}`} onPress={() => onUpgradeGuest(guest.id)} />
          <Button variant="ghost" label={`${labels.deleteGuest}: ${guest.display_name}`} onPress={() => onDeleteGuest(guest.id)} />
        </View> : null}
      </View>;
    })}
  </View>;
}
const styles = StyleSheet.create({
  section: {gap: 12},
  card: {gap: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, backgroundColor: colors.successSurface},
  header: {gap: 4},
  name: {color: colors.foreground, fontSize: 16, fontWeight: '700', flexShrink: 1},
  hint: {color: colors.muted, fontSize: 13, lineHeight: 19},
  link: {color: colors.primaryMuted, fontSize: 14, fontWeight: '600'},
  toggle: {minHeight: 44, justifyContent: 'center'},
  actions: {gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12},
  deck: {flexDirection: 'row', gap: 10, alignItems: 'center'},
  info: {flex: 1, gap: 3},
  deckName: {color: colors.foreground, fontSize: 14, fontWeight: '600'},
});
