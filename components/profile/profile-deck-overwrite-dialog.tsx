'use client';
import { useLanguage } from '@/components/language-provider';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { ProfileDeckPersistenceControls } from '@/hooks/use-profile-deck-persistence';

export function ProfileDeckOverwriteDialog({ controls }: {
  controls: Pick<ProfileDeckPersistenceControls, 'overwriteConfirm' | 'closeOverwriteConfirm'>;
}) {
  const { copy: t } = useLanguage();
  const { overwriteConfirm, closeOverwriteConfirm } = controls;
  return (<ConfirmDialog
        open={overwriteConfirm !== null}
        onOpenChange={(open) => {
          if (!open) {
            closeOverwriteConfirm(overwriteConfirm?.kind === 'bulk' ? 'cancel' : false);
          }
        }}
        title={
          overwriteConfirm?.kind === 'bulk'
            ? t({ it: 'Mazzi gia presenti', en: 'Decks already saved' })
            : t({ it: 'Mazzo gia presente', en: 'Deck already saved' })
        }
        message={
          overwriteConfirm?.kind === 'bulk'
            ? t({
              it: `${overwriteConfirm.count} mazzi selezionati sono gia nella tua collezione. Vuoi sostituirli con l'import aggiornato?`,
              en: `${overwriteConfirm.count} selected decks are already in your collection. Replace them with the latest import?`,
            })
            : t({
              it: 'Questo link e gia nella tua collezione. Vuoi sostituirlo con l\'import aggiornato?',
              en: 'This deck link is already in your collection. Replace it with the latest import?',
            })
        }
        actions={
          overwriteConfirm?.kind === 'bulk'
            ? [
                {
                  label: t({ it: 'Annulla', en: 'Cancel' }),
                  variant: 'outline',
                  onClick: () => closeOverwriteConfirm('cancel'),
                },
                {
                  label: t({ it: 'Solo nuovi', en: 'Import new only' }),
                  variant: 'outline',
                  onClick: () => closeOverwriteConfirm('skip'),
                },
                {
                  label: t({ it: 'Sostituisci', en: 'Replace' }),
                  variant: 'destructive',
                  onClick: () => closeOverwriteConfirm('overwrite'),
                },
              ]
            : [
                {
                  label: t({ it: 'Annulla', en: 'Cancel' }),
                  variant: 'outline',
                  onClick: () => closeOverwriteConfirm(false),
                },
                {
                  label: t({ it: 'Sostituisci', en: 'Replace' }),
                  variant: 'destructive',
                  onClick: () => closeOverwriteConfirm(true),
                },
              ]
        }
      />);
}
