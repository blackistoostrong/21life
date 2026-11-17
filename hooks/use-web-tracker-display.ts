'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

type DisplayRecord = { id: string } | null;
type Copy = (value: { it: string; en: string }) => string;
type Notify = (message: { title: string; variant?: 'destructive' }) => unknown;

type LockableScreenOrientation = ScreenOrientation & {
  lock?: (orientation: 'landscape-primary') => Promise<void>;
  unlock?: () => void;
};

async function lockTrackerLandscapeOrientation() {
  const orientation = screen.orientation as LockableScreenOrientation | undefined;
  if (!orientation?.lock) return;
  try {
    await orientation.lock('landscape-primary');
  } catch {
    // Safari and some embedded browsers do not expose orientation locking.
  }
}

function unlockTrackerOrientation() {
  const orientation = screen.orientation as LockableScreenOrientation | undefined;
  try {
    orientation?.unlock?.();
  } catch {
    // Ignore unsupported orientation APIs.
  }
}

function restoreDefaultTrackerDisplay() {
  unlockTrackerOrientation();
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => undefined);
  }
}

/** Owns table measurements, fullscreen listener and orientation cleanup; no game writes. */
export function useWebTrackerDisplay(
  record: DisplayRecord,
  recordRef: RefObject<DisplayRecord>,
  copy: Copy,
  toast: Notify,
) {
  const tableRef = useRef<HTMLDivElement | null>(null);
  const [tableSize, setTableSize] = useState({ width: 390, height: 760 });
  const [fullscreen, setFullscreen] = useState(false);

  const enterTrackerLandscape = useCallback(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    if (standalone) {
      void lockTrackerLandscapeOrientation();
      return;
    }
    if (document.fullscreenElement) {
      void lockTrackerLandscapeOrientation();
      return;
    }
    if (document.fullscreenEnabled && document.documentElement.requestFullscreen) {
      void document.documentElement.requestFullscreen({ navigationUI: 'hide' })
        .then(() => lockTrackerLandscapeOrientation())
        .catch(() => {
          toast({
            title: copy({
              it: 'Il browser non ha consentito lo schermo intero. Riprova dal pulsante del tracker.',
              en: 'The browser did not allow fullscreen. Try again from the tracker button.',
            }),
            variant: 'destructive',
          });
        });
      return;
    }
    void lockTrackerLandscapeOrientation();
    toast({
      title: copy({
        it: 'Per il vero schermo intero su iPad, aggiungi MTG: Commander alla schermata Home.',
        en: 'For true fullscreen on iPad, add MTG: Commander to your Home Screen.',
      }),
    });
  }, [copy, toast]);

  useEffect(() => {
    const updateFullscreen = () => {
      const isFullscreen = Boolean(document.fullscreenElement);
      setFullscreen(isFullscreen);
      if (recordRef.current) {
        void lockTrackerLandscapeOrientation();
      }
    };
    updateFullscreen();
    document.addEventListener('fullscreenchange', updateFullscreen);
    return () => {
      document.removeEventListener('fullscreenchange', updateFullscreen);
      restoreDefaultTrackerDisplay();
    };
  }, [recordRef]);

  const activeOrientationRecordId = record?.id ?? null;
  useEffect(() => {
    if (activeOrientationRecordId) {
      void lockTrackerLandscapeOrientation();
      return;
    }
    restoreDefaultTrackerDisplay();
  }, [activeOrientationRecordId]);

  useEffect(() => {
    const element = tableRef.current;
    if (!element) return;
    const update = () => setTableSize({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [record]);

  return { tableRef, tableSize, fullscreen, enterTrackerLandscape, restoreDefaultTrackerDisplay };
}
