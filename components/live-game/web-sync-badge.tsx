'use client';

import { useEffect, useState } from 'react';
import { CircleDot, Loader2, WifiOff } from 'lucide-react';
import { useLanguage } from '@/components/language-provider';
import { getLiveGameSyncCopy, getLiveGameSyncIndicator, type LiveGameSyncState } from '@/lib/live-game-sync-presentation';

/** Owns its visibility timer. Transport, queue and persistence remain with the controller. */
export function WebSyncBadge({ state, pendingOperations, errorDetail, onRetry }: {
  state: LiveGameSyncState;
  pendingOperations: number;
  errorDetail: string | null;
  onRetry: () => void;
}) {
  const { language } = useLanguage();
  const [visible, setVisible] = useState(true);
  const [announcedState, setAnnouncedState] = useState(state);
  const { label, hint } = getLiveGameSyncCopy(state,language);
  const indicator = getLiveGameSyncIndicator(state);
  useEffect(() => {
    setVisible(true);
    if (state !== 'synced' && state !== 'offline') return;
    const timer = window.setTimeout(() => setVisible(false),15000);
    return () => window.clearTimeout(timer);
  },[state]);
  useEffect(() => {
    if (state === 'authentication_required' || state === 'storage_unavailable') {
      setAnnouncedState(state);
      return;
    }
    const timer = window.setTimeout(() => setAnnouncedState(state),1500);
    return () => window.clearTimeout(timer);
  },[state]);
  return <>
    <span role="status" aria-live="polite" className="sr-only">{getLiveGameSyncCopy(announcedState,language).label}</span>
    {visible ? <button type="button" onClick={onRetry}
      className={`absolute right-2 top-[calc(env(safe-area-inset-top)+.5rem)] z-40 flex items-center gap-1.5 rounded-full border bg-black/75 px-2.5 py-1 text-[10px] font-bold backdrop-blur ${indicator === 'error' ? 'border-rose-400/50 text-rose-200' : indicator === 'offline' ? 'border-amber-400/40 text-amber-200' : 'border-emerald-400/30 text-emerald-200'}`}
      title={hint || errorDetail || undefined}>
      {indicator === 'syncing' ? <Loader2 className="h-3 w-3 animate-spin" /> : indicator === 'offline' ? <WifiOff className="h-3 w-3" /> : <CircleDot className="h-3 w-3" />}
      {label}{pendingOperations > 0 ? ` · ${pendingOperations}` : ''}
    </button> : null}
  </>;
}
