'use client';
import {useWebLiveCatalog} from '@/hooks/use-web-live-catalog';


import { useParams, useRouter } from 'next/navigation';
import { WebLiveGame } from '@/components/live-game/web-live-game';
import { AppLoader } from '@/components/ui/app-loader';
import { useAuth } from '@/hooks/use-auth';
import { useLanguage } from '@/components/language-provider';





export default function WebLiveGamePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { copy } = useLanguage();
  const groupId = params.id;
  // Stable across Supabase token refreshes: depending on `user` re-ran the
  // catalog load on every refresh, and a transient empty read redirected an
  // in-progress tracker to the dashboard.
  const userId = user?.id ?? null;

  const {loading,loadError,arenaName,participants,load}=useWebLiveCatalog(groupId,userId);

  if (authLoading || loading || !user) {
    return <AppLoader label={copy({ it: 'Caricamento tracker...', en: 'Loading tracker...' })} />;
  }

  if (loadError) return <div className="mx-auto max-w-md space-y-4 p-6">
    <p role="alert">{copy({ en: 'Could not load this arena. It may no longer be available, or the connection failed. Retry before entering the tracker.', it: 'Impossibile caricare questa arena. Potrebbe non essere più disponibile o la connessione è fallita. Riprova prima di entrare nel tracker.' })}</p>
    <div className="flex flex-wrap gap-3">
      <button type="button" onClick={() => void load()} className="rounded-xl border border-border p-3">{copy({ en: 'Retry', it: 'Riprova' })}</button>
      <button type="button" onClick={() => router.push('/dashboard')} className="rounded-xl border border-border p-3 text-muted-foreground">{copy({ en: 'Back to dashboard', it: 'Torna alla dashboard' })}</button>
    </div>
  </div>;

  return (
    <WebLiveGame
      groupId={groupId}
      arenaName={arenaName}
      userId={user.id}
      participants={participants}
    />
  );
}
