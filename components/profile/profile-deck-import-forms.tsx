'use client';
import type { ReactNode } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { useLanguage } from '@/components/language-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DeckImage } from '@/components/deck-image';
import { BracketBadge } from '@/components/deck/bracket-badge';
import { EdhrecDeckInsights } from '@/components/deck/edhrec-badge';
import { DeckSourceBadge } from './deck-source-badge';
import { getDefaultImportedCommanderOption, isImportedCommanderOptionSelected } from '@/lib/deck-importers';
import type { ProfileUrlImportControls } from '@/hooks/use-profile-url-import';
import type { ProfileArchidektImportControls } from '@/hooks/use-profile-archidekt-import';
import type { ProfileDeck } from '@/lib/types/profile-deck';
import type { CommanderArtOption } from '@/lib/profile-commander';

export function ProfileDeckImportForms({ urlControls, archidektControls, addMode, savingDeck,
  savingUserDecks, decks, targetProfileId, onChooseMode, onSaveUrl, onSaveBulk, renderArtPicker }: {
  urlControls: ProfileUrlImportControls;
  archidektControls: ProfileArchidektImportControls;
  addMode: string;
  savingDeck: boolean;
  savingUserDecks: boolean;
  decks: ProfileDeck[];
  targetProfileId: string | null;
  onChooseMode: () => void;
  onSaveUrl: () => void;
  onSaveBulk: () => void;
  renderArtPicker: (arts: CommanderArtOption[], selected: string | null | undefined,
    select: (art: CommanderArtOption) => void, loading: boolean) => ReactNode;
}) {
  const { copy: t } = useLanguage();
  const { importDeckUrl, setImportDeckUrl, importingDeck, importedDeck, selectedImportedCommander,
    importedCommanderArts, loadingImportedCommanderArts, handleUrlImport, resetUrlImport,
    selectImportedCommander, selectImportedArt } = urlControls;
  const { archidektUsername, setArchidektUsername, importingUserDecks, importedUserDecks,
    selectedUserDeckCommanders, setSelectedUserDeckCommanders, selectedUserDeckUrls,
    setSelectedUserDeckUrls, handleArchidektUserImport, clearArchidektPreview } = archidektControls;
  return <>
{addMode === 'archidekt-user' && importedUserDecks.length === 0 && (
    <div className="space-y-4">
      <Input
        value={archidektUsername}
        disabled={importingUserDecks}
        onChange={(e) => setArchidektUsername(e.target.value)}
        placeholder={t({ it: 'Username Archidekt', en: 'Archidekt username' })}
        className="bg-background/50 border-border text-foreground placeholder:text-muted-foreground"
      />
      <p className="text-xs text-muted-foreground">
        {t({
          it: 'Precompilato dal profilo. Puoi modificarlo per questa importazione; Archidekt restituisce solo i mazzi pubblici.',
          en: 'Pre-filled from your profile. You can change it for this import; Archidekt returns public decks only.',
        })}
      </p>
      <div className="flex gap-3">
        <Button
          variant="outline"
          className="flex-1 border-border text-foreground"
          onClick={onChooseMode}
        >
          {t({ it: 'Indietro', en: 'Back' })}
        </Button>
        <Button
          className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-700"
          onClick={handleArchidektUserImport}
          disabled={importingUserDecks || !archidektUsername.trim()}
        >
          {importingUserDecks ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {t({ it: 'Caricamento...', en: 'Loading...' })}
            </>
          ) : (
            t({ it: 'Carica mazzi', en: 'Load Decks' })
          )}
        </Button>
      </div>
    </div>
  )}

{addMode === 'archidekt-user' && importedUserDecks.length > 0 && (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">
            {selectedUserDeckUrls.length}/{importedUserDecks.length} {t({ it: importedUserDecks.length === 1 ? 'mazzo selezionato' : 'mazzi selezionati', en: importedUserDecks.length === 1 ? 'deck selected' : 'decks selected' })}
          </p>
          <p className="text-xs text-muted-foreground">
            {t({
              it: 'Scegli quale comandante mostrare sui mazzi partner/DFC. Le art si cambiano dal profilo dopo l\'import.',
              en: 'Choose which commander to display on partner/DFC decks. Change art from your profile after import.',
            })}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setSelectedUserDeckUrls(importedUserDecks.map((deck) => deck.sourceUrl))} disabled={savingDeck || savingUserDecks}
          >
            {t({ it: 'Tutti', en: 'All' })}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setSelectedUserDeckUrls([])} disabled={savingDeck || savingUserDecks}
          >
            {t({ it: 'Nessuno', en: 'None' })}
          </Button>
        </div>
      </div>
      <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
        {importedUserDecks.map((deck) => {
          const selectedCommander = selectedUserDeckCommanders[deck.sourceUrl] || getDefaultImportedCommanderOption(deck);
          const alreadySaved = decks.some((savedDeck) =>
            savedDeck.user_id === targetProfileId &&
            savedDeck.source_url === deck.sourceUrl
          );
          const selectedForImport = selectedUserDeckUrls.includes(deck.sourceUrl);

          return (
            <div key={deck.sourceUrl} className={`rounded-lg border p-3 transition-colors ${
              selectedForImport ? 'border-border bg-background/40' : 'border-border/60 bg-background/20 opacity-70'
            }`}>
              <div className="flex gap-3">
                <button
                  type="button"
                  className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
                    selectedForImport
                      ? 'border-emerald-500 bg-emerald-500 text-white'
                      : 'border-border bg-background'
                  }`}
                  onClick={() => setSelectedUserDeckUrls((current) =>
                    selectedForImport
                      ? current.filter((url) => url !== deck.sourceUrl)
                      : [...current, deck.sourceUrl]
                  )}
                  aria-label={selectedForImport
                    ? t({ it: 'Escludi mazzo', en: 'Exclude deck' })
                    : t({ it: 'Includi mazzo', en: 'Include deck' })} disabled={savingDeck || savingUserDecks}
                >
                  {selectedForImport && <Check className="h-3.5 w-3.5" />}
                </button>
                <DeckImage
                  src={selectedCommander.imageUrl}
                  alt={selectedCommander.name}
                  className="w-20 h-14 object-cover object-top rounded"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    {<DeckSourceBadge sourceType={deck.sourceType} />}
                    <BracketBadge
                      bracket={deck.bracket}
                      className="rounded-full border border-emerald-500/30 px-2"
                    />
                    {alreadySaved && (
                      <span className="rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">
                        {t({ it: 'Gia presente', en: 'Already saved' })}
                      </span>
                    )}
                  </div>
                  <p className="font-semibold text-foreground truncate">{deck.name}</p>
                  <p className="text-sm text-emerald-400 truncate">{selectedCommander.name}</p>
                </div>
              </div>
              {(deck.commanderOptions?.length || 0) > 1 && (
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {deck.commanderOptions?.map((commander) => {
                    const selected = isImportedCommanderOptionSelected(selectedCommander, commander);
                    return (
                      <button
                        key={`${deck.sourceUrl}-${commander.name}`}
                        type="button"
                        onClick={() => setSelectedUserDeckCommanders((current) => ({
                          ...current,
                          [deck.sourceUrl]: commander,
                        }))}
                        className={`flex items-center gap-2 rounded-lg border p-2 text-left transition-colors ${
                          selected
                            ? 'border-emerald-500 bg-emerald-500/10'
                            : 'border-border hover:border-emerald-500/50'
                        }`} disabled={savingDeck || savingUserDecks}
                      >
                        <DeckImage
                          src={commander.imageUrl}
                          alt={commander.name}
                          className="h-12 w-16 rounded object-cover object-top"
                        />
                        <span className="min-w-0 flex-1 text-xs font-medium text-foreground">{commander.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex gap-3">
        <Button
          variant="outline"
          className="flex-1 border-border text-foreground"
          onClick={clearArchidektPreview}
      >
          {t({ it: 'Indietro', en: 'Back' })}
        </Button>
        <Button
          className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-700"
          onClick={onSaveBulk}
          disabled={savingUserDecks || selectedUserDeckUrls.length === 0 || !targetProfileId}
        >
          {savingUserDecks ? t({ it: 'Salvataggio...', en: 'Saving...' }) : t({ it: 'Salva mazzi', en: 'Save Decks' })}
        </Button>
      </div>
    </div>
  )}

{addMode === 'import-url' && !importedDeck && (
    <div className="space-y-4">
      <Input
        value={importDeckUrl}
        disabled={importingDeck}
        onChange={(e) => setImportDeckUrl(e.target.value)}
        placeholder="https://archidekt.com/decks/123456 o https://www.moxfield.com/decks/..."
        className="bg-background/50 border-border text-foreground placeholder:text-muted-foreground"
      />
      <p className="text-xs text-muted-foreground">
        {t({
          it: 'Supporta link pubblici Archidekt e Moxfield. I mazzi privati non possono essere importati.',
          en: 'Supports public Archidekt and Moxfield links. Private decks cannot be imported.',
        })}
      </p>
      <div className="flex gap-3">
        <Button
          variant="outline"
          className="flex-1 border-border text-foreground"
          onClick={onChooseMode}
        >
          {t({ it: 'Indietro', en: 'Back' })}
        </Button>
        <Button
          className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-700"
          onClick={handleUrlImport}
          disabled={importingDeck || !importDeckUrl.trim()}
        >
          {importingDeck ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {t({ it: 'Analisi...', en: 'Importing...' })}
            </>
          ) : (
            t({ it: 'Analizza mazzo', en: 'Import Deck' })
          )}
        </Button>
      </div>
    </div>
  )}

{addMode === 'import-url' && importedDeck && (
    <div className="space-y-4">
      <div className="flex gap-4 p-4 rounded-lg bg-background/50 border-border">
        <DeckImage
          src={selectedImportedCommander?.imageUrl || importedDeck.commanderImageUrl}
          alt={selectedImportedCommander?.name || importedDeck.commander}
          className="w-28 h-20 object-cover object-top rounded"
        />
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            {<DeckSourceBadge sourceType={importedDeck.sourceType} />}
            <BracketBadge
              bracket={importedDeck.bracket}
              className="rounded-full border border-emerald-500/30 px-2"
            />
          </div>
          <h4 className="font-semibold text-foreground line-clamp-1">
            {importedDeck.name}
          </h4>
          <p className="text-sm text-emerald-400">{selectedImportedCommander?.name || importedDeck.commander}</p>
          <EdhrecDeckInsights
            commander={selectedImportedCommander?.name || importedDeck.commander}
            localBracket={importedDeck.bracket}
            showBracketComparison
            layout="stacked"
            linkVariant="chip"
            linkClassName="w-full sm:w-auto"
            className="mt-2"
          />
        </div>
      </div>
      {(importedDeck.commanderOptions?.length || 0) > 1 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">
            {t({ it: 'Scegli comandante da mostrare', en: 'Choose commander to display' })}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {importedDeck.commanderOptions?.map((commander) => {
              const selected = isImportedCommanderOptionSelected(selectedImportedCommander, commander);
              return (
                <button
                  key={commander.name}
                  type="button"
                  onClick={() => selectImportedCommander(commander)}
                  className={`flex items-center gap-3 rounded-lg border p-2 text-left transition-colors ${
                    selected
                      ? 'border-emerald-500 bg-emerald-500/10'
                      : 'border-border hover:border-emerald-500/50'
                  }`} disabled={savingDeck || savingUserDecks}
                >
                  <DeckImage
                    src={commander.imageUrl}
                    alt={commander.name}
                    className="h-14 w-20 rounded object-cover object-top"
                  />
                  <span className="min-w-0 flex-1 text-sm font-medium text-foreground">{commander.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {selectedImportedCommander && renderArtPicker(
        importedCommanderArts,
        selectedImportedCommander.imageUrl,
        selectImportedArt,
        loadingImportedCommanderArts
      )}
      <div className="flex gap-3">
        <Button
          variant="outline"
          className="flex-1 border-border text-foreground"
          onClick={resetUrlImport}
        >
          {t({ it: 'Annulla', en: 'Cancel' })}
        </Button>
        <Button
          className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-700"
          onClick={onSaveUrl}
          disabled={savingDeck || !targetProfileId}
        >
          {savingDeck ? t({ it: 'Salvataggio...', en: 'Saving...' }) : t({ it: 'Salva mazzo', en: 'Save Deck' })}
        </Button>
      </div>
    </div>
  )}
  </>;
}
