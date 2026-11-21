'use client';
import { Loader2 } from 'lucide-react';
import { useLanguage } from '@/components/language-provider';
import { DeckImage } from '@/components/deck-image';
import type { CommanderArtOption } from '@/lib/profile-commander';

export function CommanderArtPicker({ arts, selectedImageUrl, onSelect, loadingArts, busy }: {
  arts: CommanderArtOption[];
  selectedImageUrl: string | null | undefined;
  onSelect: (art: CommanderArtOption) => void;
  loadingArts: boolean;
  busy: boolean;
}) {
  const { copy: t } = useLanguage();
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground">
        {t({ it: 'Scegli art comandante', en: 'Choose commander art' })}
      </p>
      {loadingArts ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-background/35 px-3 py-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t({ it: 'Caricamento art...', en: 'Loading arts...' })}
        </div>
      ) : arts.length > 0 ? (
        <div className="overflow-x-auto pb-2">
          <div className="grid grid-flow-col auto-cols-[132px] gap-3">
            {arts.map((art) => {
              const selected = selectedImageUrl === art.imageUrl;
              return (
                <button
                  key={`${art.id}-${art.imageUrl}`}
                  type="button"
                  onClick={() => onSelect(art)}
                  className={`rounded-lg border p-2 text-left transition-colors ${
                    selected ? 'border-emerald-500 bg-emerald-500/10' : 'border-border bg-background/25 hover:border-emerald-500/50'
                  }`} disabled={busy}
                >
                  <DeckImage
                    src={art.imageUrl}
                    alt={art.name}
                    className="h-24 w-full rounded object-cover object-top"
                  />
                  <p className="mt-2 truncate text-xs font-medium text-foreground">
                    {art.setName || t({ it: 'Stampa', en: 'Printing' })}
                  </p>
                  {(art.collectorNumber || art.releasedAt) && (
                    <p className="truncate text-xs text-muted-foreground">
                      {[art.collectorNumber, art.releasedAt].filter(Boolean).join(' - ')}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="rounded-lg border border-border/70 bg-background/35 px-3 py-2 text-xs text-muted-foreground">
          {t({ it: 'Nessuna art alternativa trovata su Scryfall.', en: 'No alternate art found on Scryfall.' })}
        </p>
      )}
    </div>
  );
}
