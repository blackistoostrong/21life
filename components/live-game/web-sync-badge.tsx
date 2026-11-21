'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CircleDot, Clock3, CloudUpload, Loader2, WifiOff } from 'lucide-react';
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
  const fullLabel = label + (pendingOperations > 0 ? ` · ${pendingOperations}` : '');
  return <span className="relative block h-4 w-4 shrink-0">
    <span role="status" aria-live="polite" className="sr-only">{getLiveGameSyncCopy(announcedState,language).label}</span>
    {visible ? <button type="button" onClick={onRetry} data-testid="live-sync-indicator"
      aria-label={fullLabel}
      className={`absolute -inset-2 grid place-items-center rounded-full focus-visible:outline-none focus-visible:ring-1 ${indicator === 'error' ? 'text-rose-200' : indicator === 'offline' || indicator === 'pending' ? 'text-amber-200' : 'text-emerald-200'}`}
      title={hint || errorDetail || fullLabel}>
      {indicator === 'syncing' ? <Loader2 aria-hidden="true" className="h-2.5 w-2.5 animate-spin" /> : indicator === 'offline' ? <WifiOff aria-hidden="true" className="h-2.5 w-2.5" /> : indicator === 'error' ? <AlertTriangle aria-hidden="true" className="h-2.5 w-2.5" /> : indicator === 'pending' ? <CloudUpload aria-hidden="true" className="h-2.5 w-2.5" /> : <CircleDot aria-hidden="true" className="h-2.5 w-2.5" />}
      {pendingOperations > 0 ? <span aria-hidden="true" className="absolute right-0.5 top-0.5 rounded bg-zinc-900 px-0.5 text-[7px] leading-none">{pendingOperations > 9 ? '9+' : pendingOperations}</span> : null}
    </button> : <Clock3 className="h-4 w-4" />}
  </span>;
}
