'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type DisplayRecord = { id: string } | null;
type Copy = (value: { it: string; en: string }) => string;
type Notify = (message: { title: string; variant?: 'destructive' }) => unknown;
type DisplayOwner = { wantsDisplay: boolean };

// Fullscreen is document-wide. Store only opaque resource leases, never game or
// account data; an old mount must not restore display over a newer tracker.
const displayOwners = new WeakMap<Document, DisplayOwner>();

type LockableScreenOrientation = ScreenOrientation & {
  lock?: (orientation: 'landscape-primary') => Promise<void>;
  unlock?: () => void;
};

async function lockTrackerLandscapeOrientation(owner: DisplayOwner) {
  const orientation = screen.orientation as LockableScreenOrientation | undefined;
  if (!orientation?.lock) return;
  try {
    await orientation.lock('landscape-primary');
    if ((displayOwners.get(document) !== owner || !owner.wantsDisplay)
      && !displayOwners.get(document)?.wantsDisplay) unlockTrackerOrientation();
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

function restoreBrowserDisplay() {
  unlockTrackerOrientation();
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => undefined);
  }
}

/** Owns table measurements, fullscreen listener and orientation cleanup; no game writes. */
export function useWebTrackerDisplay(
  record: DisplayRecord,
  getRecord: () => DisplayRecord,
  copy: Copy,
  toast: Notify,
) {
  const [tableSize, setTableSize] = useState({ width: 390, height: 760 });
  const [fullscreen, setFullscreen] = useState(false);
  const observerRef = useRef<ResizeObserver | null>(null);
  const ownerRef = useRef<DisplayOwner | null>(null);
  const fullscreenRequest = useRef<object | null>(null);
  const restoreDefaultTrackerDisplay = useCallback(() => {
    fullscreenRequest.current = null;
    const owner = ownerRef.current;
    if (owner) owner.wantsDisplay = false;
    if (owner && displayOwners.get(document) === owner) restoreBrowserDisplay();
  }, []);
  // Follow the actual surface, including a cached game revealed after bootstrap.
  // A record mutation does not replace that surface or its observer.
  const tableRef = useCallback((element: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!element) return;
    const update = () => setTableSize({ width: element.clientWidth, height: element.clientHeight });
    const observer = new ResizeObserver(() => {
      if (observerRef.current === observer) update();
    });
    observerRef.current = observer;
    update();
    observer.observe(element);
  }, []);

  const enterTrackerLandscape = useCallback(() => {
    const owner = ownerRef.current;
    if (!owner || displayOwners.get(document) !== owner) return;
    owner.wantsDisplay = true;
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    if (standalone) {
      void lockTrackerLandscapeOrientation(owner);
      return;
    }
    if (document.fullscreenElement) {
      void lockTrackerLandscapeOrientation(owner);
      return;
    }
    if (document.fullscreenEnabled && document.documentElement.requestFullscreen) {
      if (fullscreenRequest.current) return;
      const attempt = {};
      fullscreenRequest.current = attempt;
      const current = () => displayOwners.get(document) === owner && fullscreenRequest.current === attempt;
      void document.documentElement.requestFullscreen({ navigationUI: 'hide' })
        .then(() => {
          if (current()) return lockTrackerLandscapeOrientation(owner);
          if (!displayOwners.get(document)?.wantsDisplay
            && document.fullscreenElement === document.documentElement) restoreBrowserDisplay();
        })
        .catch(() => {
          if (!current()) return;
          toast({
            title: copy({
              it: 'Il browser non ha consentito lo schermo intero. Riprova dal pulsante del tracker.',
              en: 'The browser did not allow fullscreen. Try again from the tracker button.',
            }),
            variant: 'destructive',
          });
        }).finally(() => {
          if (fullscreenRequest.current === attempt) fullscreenRequest.current = null;
        });
      return;
    }
    void lockTrackerLandscapeOrientation(owner);
    toast({
      title: copy({
        it: 'Per il vero schermo intero su iPad, aggiungi MTG: Commander alla schermata Home.',
        en: 'For true fullscreen on iPad, add MTG: Commander to your Home Screen.',
      }),
    });
  }, [copy, toast]);

  useEffect(() => {
    const owner = { wantsDisplay: false };
    ownerRef.current = owner;
    displayOwners.set(document, owner);
    const updateFullscreen = () => {
      const isFullscreen = Boolean(document.fullscreenElement);
      setFullscreen(isFullscreen);
      if (getRecord() && displayOwners.get(document) === owner) {
        owner.wantsDisplay = true;
        void lockTrackerLandscapeOrientation(owner);
      }
    };
    updateFullscreen();
    document.addEventListener('fullscreenchange', updateFullscreen);
    return () => {
      document.removeEventListener('fullscreenchange', updateFullscreen);
      owner.wantsDisplay = false;
      fullscreenRequest.current = null;
      if (ownerRef.current === owner) ownerRef.current = null;
      if (displayOwners.get(document) === owner) {
        displayOwners.delete(document);
        restoreBrowserDisplay();
      }
    };
  }, [getRecord]);

  const activeOrientationRecordId = record?.id ?? null;
  useEffect(() => {
    if (activeOrientationRecordId) {
      const owner = ownerRef.current;
      if (owner && displayOwners.get(document) === owner) {
        owner.wantsDisplay = true;
        void lockTrackerLandscapeOrientation(owner);
      }
      return;
    }
    restoreDefaultTrackerDisplay();
  }, [activeOrientationRecordId, restoreDefaultTrackerDisplay]);

  return { tableRef, tableSize, fullscreen, enterTrackerLandscape, restoreDefaultTrackerDisplay };
}
