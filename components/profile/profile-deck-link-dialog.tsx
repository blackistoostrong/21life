'use client';
import { Link2 } from 'lucide-react';
import { useLanguage } from '@/components/language-provider';
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ModalCard, ModalOverlay } from '@/components/ui/modal-shell';
import type { ProfileDeckLinkControls } from '@/hooks/use-profile-deck-link';

export function ProfileDeckLinkDialog({ controls }: { controls: ProfileDeckLinkControls }) {
  const { copy: t } = useLanguage();
  const { linkingDeck, setLinkingDeck, linkDeckUrl, setLinkDeckUrl, savingDeckLink, handleLinkDeckToExternalSource } = controls;
  return <>{linkingDeck && (
        <ModalOverlay>
          <ModalCard size="md">
            <CardHeader className="shrink-0 border-b border-border/70">
              <CardTitle className="text-foreground">{t({ it: 'Collega lista esterna', en: 'Link external list' })}</CardTitle>
              <CardDescription className="text-muted-foreground">
                {t({
                  it: 'Il nome e il comandante attuali restano invariati. Il link abilita aggiornamenti, bracket e metadati dalla lista.',
                  en: 'Your current name and commander stay unchanged. The link enables source refreshes, bracket and metadata.',
                })}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 py-6">
              <Input
                value={linkDeckUrl}
                onChange={(event) => setLinkDeckUrl(event.target.value)}
                placeholder="https://archidekt.com/decks/... oppure https://moxfield.com/decks/..."
                autoFocus
                className="bg-background/50 border-border text-foreground placeholder:text-muted-foreground"
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="border-border text-foreground"
                  disabled={savingDeckLink}
                  onClick={() => {
                    setLinkingDeck(null);
                    setLinkDeckUrl('');
                  }}
                >
                  {t({ it: 'Annulla', en: 'Cancel' })}
                </Button>
                <Button
                  type="button"
                  disabled={savingDeckLink || !linkDeckUrl.trim()}
                  className="bg-gradient-to-r from-emerald-600 to-teal-700"
                  onClick={() => void handleLinkDeckToExternalSource()}
                >
                  <Link2 className="mr-2 h-4 w-4" />
                  {savingDeckLink ? t({ it: 'Collegamento...', en: 'Linking...' }) : t({ it: 'Collega lista', en: 'Link list' })}
                </Button>
              </div>
            </CardContent>
          </ModalCard>
        </ModalOverlay>
      )}</>;
}
