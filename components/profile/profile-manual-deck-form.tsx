'use client';
import type { ReactNode } from 'react';
import { Search, Loader2, Swords, X } from 'lucide-react';
import { useLanguage } from '@/components/language-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DeckImage } from '@/components/deck-image';
import type { CommanderArtOption } from '@/lib/profile-commander';
import type { ProfileManualDeckControls } from '@/hooks/use-profile-manual-deck';

export function ProfileManualDeckForm({ controls, addMode, savingDeck, savingUserDecks, hasTarget, onSave,
  onChooseMode, renderArtPicker }: {
  controls: ProfileManualDeckControls; addMode: string; savingDeck: boolean; savingUserDecks: boolean;
  hasTarget: boolean; onSave: () => void; onChooseMode: () => void;
  renderArtPicker: (arts: CommanderArtOption[], selected: string | null | undefined,
    select: (art: CommanderArtOption) => void, loading: boolean) => ReactNode;
}) {
  const { copy: t } = useLanguage();
  const {
    selectedCommander, setSelectedCommander, selectedPartnerCommander, setSelectedPartnerCommander,
    searchQuery, setSearchQuery, searchResults, setSearchResults,
    searching, partnerSearchQuery, setPartnerSearchQuery, partnerSearchResults,
    setPartnerSearchResults, searchingPartner, manualCommanderArts, loadingManualCommanderArts,
    customDeckName, setCustomDeckName, manualPartnerMode, manualPartnerCopy,
    handleSelectCommander,
  } = controls;
  return <>{addMode === 'manual' && !selectedCommander && (
                <div className="space-y-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={t({ it: 'Cerca comandante per nome...', en: 'Search commander by name...' })}
                      className="pl-9 bg-background/50 border-border text-foreground placeholder:text-muted-foreground" disabled={savingDeck || savingUserDecks}
                    />
                    {searching && (
                      <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
                    )}
                  </div>

                  {searchResults.length > 0 && (
                    <div className="max-h-64 overflow-y-auto space-y-2 border border-border rounded-lg p-2">
                      {searchResults.map((result) => (
                        <button
                          key={result.id}
                          className="w-full flex items-center gap-3 p-2 rounded hover:bg-accent transition-colors text-left"
                          onClick={() => handleSelectCommander(result)}
                        >
                          {result.imageUrl ? (
                            <DeckImage
                              src={result.imageUrl}
                              alt={result.name}
                              className="w-12 h-16 rounded object-cover object-top"
                            />
                          ) : (
                            <div className="w-12 h-16 bg-secondary rounded flex items-center justify-center">
                              <Swords className="w-4 h-4 text-muted-foreground" />
                            </div>
                          )}
                          <div>
                            <p className="font-medium text-foreground">{result.name}</p>
                            <p className="text-xs text-muted-foreground">{result.typeLine}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {searchQuery.length >= 2 && searchResults.length === 0 && !searching && (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      {t({ it: 'Nessun comandante trovato per', en: 'No commanders found for' })} &quot;{searchQuery}&quot;
                    </p>
                  )}

                  <Button
                    variant="outline"
                    className="w-full border-border text-foreground"
                    onClick={() => {
                      onChooseMode();
                      setSearchQuery('');
                      setSearchResults([]);
                    }}
                  >
                    {t({ it: 'Indietro', en: 'Back' })}
                  </Button>
                </div>
              )}
{addMode === 'manual' && selectedCommander && (
                <div className="space-y-4">
                  <div className="flex gap-4 p-4 rounded-lg bg-background/50 border-border">
                    {selectedCommander.imageUrl ? (
                      <DeckImage
                        src={selectedCommander.imageUrl}
                        alt={selectedCommander.name}
                        className="w-20 h-28 object-cover object-top rounded"
                      />
                    ) : (
                      <div className="w-20 h-28 bg-secondary rounded flex items-center justify-center">
                        <Swords className="w-6 h-6 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1">
                      <p className="text-sm text-muted-foreground mb-1">{t({ it: 'Comandante', en: 'Commander' })}</p>
                      <p className="font-semibold text-foreground">{selectedCommander.name}</p>
                      <p className="text-xs text-muted-foreground">{selectedCommander.typeLine}</p>
                    </div>
                  </div>

                  {renderArtPicker(
                    manualCommanderArts,
                    selectedCommander.imageUrl,
                    (art) => setSelectedCommander((current) => current ? { ...current, imageUrl: art.imageUrl } : current),
                    loadingManualCommanderArts
                  )}

                  {manualPartnerMode && manualPartnerCopy && (
                    <div className="space-y-3 rounded-lg border border-border bg-background/35 p-4">
                      <div>
                        <p className="text-sm font-medium text-foreground">{manualPartnerCopy.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {t({ it: 'Aggiungi un secondo comandante se vuoi salvare la coppia.', en: 'Add a second commander if you want to save the pair.' })}
                        </p>
                      </div>

                      {selectedPartnerCommander && (
                        <div className="flex items-center gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-2">
                          {selectedPartnerCommander.imageUrl ? (
                            <DeckImage
                              src={selectedPartnerCommander.imageUrl}
                              alt={selectedPartnerCommander.name}
                              className="h-16 w-12 rounded object-cover object-top"
                            />
                          ) : (
                            <div className="h-16 w-12 rounded bg-secondary flex items-center justify-center">
                              <Swords className="h-4 w-4 text-muted-foreground" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-foreground">{selectedPartnerCommander.name}</p>
                            <p className="text-xs text-muted-foreground">{selectedPartnerCommander.typeLine}</p>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-11 w-11 shrink-0"
                            onClick={() => {
                              const combinedName = `${selectedCommander.name} // ${selectedPartnerCommander.name}`;
                              setSelectedPartnerCommander(null);
                              setPartnerSearchQuery('');
                              setPartnerSearchResults([]);
                              if (customDeckName === combinedName) setCustomDeckName(selectedCommander.name);
                            }} disabled={savingDeck || savingUserDecks}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      )}

                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          value={partnerSearchQuery}
                          onChange={(e) => setPartnerSearchQuery(e.target.value)}
                          placeholder={manualPartnerCopy.placeholder}
                          className="pl-9 bg-background/50 border-border text-foreground placeholder:text-muted-foreground" disabled={savingDeck || savingUserDecks}
                        />
                        {searchingPartner && (
                          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
                        )}
                      </div>

                      {partnerSearchResults.length > 0 && (
                        <div className="max-h-52 overflow-y-auto space-y-2 rounded-lg border border-border p-2">
                          {partnerSearchResults.map((result) => (
                            <button
                              key={result.id}
                              type="button"
                              className="w-full flex items-center gap-3 rounded p-2 text-left transition-colors hover:bg-accent"
                              onClick={() => {
                                setSelectedPartnerCommander(result);
                                setPartnerSearchQuery(result.name);
                                setPartnerSearchResults([]);
                                const combinedName = `${selectedCommander.name} // ${result.name}`;
                                if (!customDeckName || customDeckName === selectedCommander.name) setCustomDeckName(combinedName);
                              }} disabled={savingDeck || savingUserDecks}
                            >
                              {result.imageUrl ? (
                                <DeckImage
                                  src={result.imageUrl}
                                  alt={result.name}
                                  className="h-16 w-12 rounded object-cover object-top"
                                />
                              ) : (
                                <div className="h-16 w-12 rounded bg-secondary flex items-center justify-center">
                                  <Swords className="h-4 w-4 text-muted-foreground" />
                                </div>
                              )}
                              <div className="min-w-0">
                                <p className="font-medium text-foreground">{result.name}</p>
                                <p className="text-xs text-muted-foreground">{result.typeLine}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}

                      {partnerSearchQuery.length >= 2 && partnerSearchResults.length === 0 && !searchingPartner && !selectedPartnerCommander && (
                        <p className="text-sm text-muted-foreground text-center py-2">
                          {manualPartnerCopy.empty}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">{t({ it: 'Nome mazzo', en: 'Deck Name' })}</label>
                    <Input
                      value={customDeckName}
                      onChange={(e) => setCustomDeckName(e.target.value)}
                      placeholder={`${selectedCommander.name}`}
                      className="bg-background/50 border-border text-foreground placeholder:text-muted-foreground" disabled={savingDeck || savingUserDecks}
                    />
                  </div>

                  <div className="flex gap-3">
                    <Button
                      variant="outline"
                      className="flex-1 border-border text-foreground"
                      onClick={() => {
                        setSelectedCommander(null);
                        setPartnerSearchQuery('');
                        setPartnerSearchResults([]);
                        setSelectedPartnerCommander(null);
                        setCustomDeckName('');
                      }}
                    >
                      {t({ it: 'Indietro', en: 'Back' })}
                    </Button>
                    <Button
                      className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-700"
                      onClick={onSave}
                      disabled={savingDeck || !hasTarget}
                    >
                      {savingDeck ? t({ it: 'Salvataggio...', en: 'Saving...' }) : t({ it: 'Aggiungi mazzo', en: 'Add Deck' })}
                    </Button>
                  </div>
                </div>
              )}</>;
}
