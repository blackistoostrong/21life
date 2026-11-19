'use client';
import { Search } from 'lucide-react';
import { useLanguage } from '@/components/language-provider';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MANA_COLOR_LABELS, MANA_COLOR_ORDER } from '@/lib/mana-colors';
import { getProfileDisplayName } from '@/lib/profile-display';
import type { ProfileDirectoryEntry } from '@/lib/types/profile-directory';
import type { ProfileDeckCollectionControls } from '@/hooks/use-profile-deck-collection';

export function ProfileDeckFilters({ controls, adminMode, targetProfiles }: {
  controls: Pick<ProfileDeckCollectionControls, 'visibleDecks' | 'deckSearchQuery' | 'setDeckSearchQuery'
    | 'deckColorFilter' | 'setDeckColorFilter' | 'deckPlayerFilter' | 'setDeckPlayerFilter'
    | 'deckSort' | 'setDeckSort'>;
  adminMode: boolean;
  targetProfiles: ProfileDirectoryEntry[];
}) {
  const { copy: t } = useLanguage();
  const { visibleDecks, deckSearchQuery, setDeckSearchQuery, deckColorFilter, setDeckColorFilter,
    deckPlayerFilter, setDeckPlayerFilter, deckSort, setDeckSort } = controls;
  return <>{visibleDecks.length > 0 && (
    <div className="mb-6 grid gap-3 rounded-lg border border-border/70 bg-black/20 p-3 md:grid-cols-2 xl:grid-cols-4">
      {adminMode && (
        <Select
          value={deckPlayerFilter}
          onValueChange={setDeckPlayerFilter}
          disabled={targetProfiles.length === 0}
        >
          <SelectTrigger className="border-border bg-background/50 text-foreground md:col-span-2 xl:col-span-1">
            <SelectValue placeholder={t({ it: 'Filtra per giocatore', en: 'Filter by player' })} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {t({ it: 'Tutti i giocatori', en: 'All players' })}
            </SelectItem>
            {targetProfiles.map((profile) => (
              <SelectItem key={profile.id} value={profile.id}>
                {getProfileDisplayName(profile)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <div className="relative min-w-0">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={deckSearchQuery}
          onChange={(event) => setDeckSearchQuery(event.target.value)}
          placeholder={t({ it: 'Cerca per nome o comandante...', en: 'Search by name or commander...' })}
          className="border-border bg-background/50 pl-9 text-foreground placeholder:text-muted-foreground"
        />
      </div>
      <div className="flex min-h-10 items-center gap-1 rounded-md border border-border bg-background/50 px-2" aria-label={t({ it: 'Filtra per colori', en: 'Filter by colors' })}>
        <button type="button" onClick={() => setDeckColorFilter([])} className={`rounded px-1.5 py-1 text-xs font-bold ${deckColorFilter.length === 0 ? 'bg-emerald-500/20 text-emerald-200' : 'text-muted-foreground'}`}>{t({ it: 'Tutti', en: 'All' })}</button>
        {MANA_COLOR_ORDER.map((color) => <button key={color} type="button" onClick={() => setDeckColorFilter((current) => current.includes(color) ? current.filter((item) => item !== color) : [...current, color])} className={`grid h-7 w-7 place-items-center rounded-full text-xs font-black ${deckColorFilter.includes(color) ? 'bg-emerald-400 text-emerald-950' : 'bg-secondary text-muted-foreground'}`} title={t(MANA_COLOR_LABELS[color])}>{color}</button>)}
      </div>
      <Select value={deckSort} onValueChange={(value) => setDeckSort(value as typeof deckSort)}>
        <SelectTrigger aria-label={t({ it: 'Ordina mazzi', en: 'Sort decks' })} className="border-border bg-background/50 text-foreground">
          <SelectValue placeholder={t({ it: 'Ordina per', en: 'Sort by' })} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="recent">{t({ it: 'Aggiunti di recente', en: 'Recently added' })}</SelectItem>
          <SelectItem value="winRate">Win rate</SelectItem>
          <SelectItem value="gamesPlayed">{t({ it: 'Partite giocate', en: 'Games played' })}</SelectItem>
          <SelectItem value="damage">{t({ it: 'Danni inflitti', en: 'Damage dealt' })}</SelectItem>
          <SelectItem value="eliminations">KO</SelectItem>
          <SelectItem value="fastest">{t({ it: 'Vittoria più veloce', en: 'Fastest win' })}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )}</>;
}
