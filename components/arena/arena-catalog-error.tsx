'use client';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/components/language-provider';

export function ArenaCatalogError({ resource, onRetry }: {
  resource: 'group' | 'guests' | 'decks'; onRetry: () => unknown;
}) {
  const { copy: t } = useLanguage();
  const message = resource === 'group'
    ? t({ it: 'Playgroup non disponibile.', en: 'Playgroup unavailable.' })
    : resource === 'guests'
      ? t({ it: 'Guest non disponibili.', en: 'Guests unavailable.' })
      : t({ it: 'Mazzi dei membri non disponibili.', en: 'Member decks unavailable.' });
  return <div role="alert" className="my-4 rounded-xl border border-amber-400/30 p-4">
    <p>{message}</p>
    <Button variant="outline" size="sm" className="mt-2" onClick={() => void onRetry()}>{t({ it: 'Riprova', en: 'Retry' })}</Button>
  </div>;
}
