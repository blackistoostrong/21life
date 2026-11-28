import type {ArenaRecapSnapshot} from '../../packages/features/arena-recap/controller';

type Mode = 'ok' | 'cancel' | 'error' | 'hold';
type SharePayload = {title?: string; text?: string; message?: string};
export type RecapHarness = {
  render: (actor?: string, group?: string, language?: 'en' | 'it', token?: string) => void;
  open: () => Promise<boolean>; close: () => void; days: (days: 7 | 30) => Promise<boolean>;
  names: (includeNames: boolean) => void; exportText: (kind: 'share' | 'copy' | 'download') => Promise<boolean>;
  unmount: () => void;
  stats: () => {snapshot: ArenaRecapSnapshot; shares: SharePayload[]; copies: string[]; active: boolean[]};
};
declare global {interface Window {
  arenaRecapHarness: RecapHarness;
  arenaRecapIo: ReturnType<typeof installArenaRecapIo>;
  recapActor: string; recapLanguage: 'en' | 'it';
}}
export function installArenaRecapIo() {
  let shareMode: Mode = 'ok', copyMode: Mode = 'ok';
  const shares: SharePayload[] = [], copies: string[] = [], active: boolean[] = [], pending: (() => void)[] = [];
  const share = async (payload: SharePayload) => {
    shares.push(payload); active.push(navigator.userActivation.isActive);
    if (shareMode === 'hold') await new Promise<void>(resolve => pending.push(resolve));
    if (shareMode === 'cancel') throw new DOMException('Cancelled', 'AbortError');
    if (shareMode === 'error') throw new Error('Synthetic share failure');
  };
  Object.defineProperty(navigator, 'share', {configurable: true, value: share});
  Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: async (text: string) => {
    copies.push(text);
    if (copyMode === 'hold') await new Promise<void>(resolve => pending.push(resolve));
    if (copyMode === 'error') throw new Error('Synthetic clipboard denial');
  }}});
  return {
    shares, copies, active,
    configure: (options: {share?: Mode; copy?: Mode; unavailableShare?: boolean}) => {
      if (options.share) shareMode = options.share; if (options.copy) copyMode = options.copy;
      if (options.unavailableShare !== undefined) Object.defineProperty(navigator, 'share', {configurable: true, value: options.unavailableShare ? undefined : share});
    },
    release: () => {shareMode = 'ok'; copyMode = 'ok'; pending.splice(0).forEach(resolve => resolve());},
    nativeShare: async (payload: SharePayload) => {
      shares.push(payload); active.push(navigator.userActivation.isActive);
      if (shareMode === 'hold') await new Promise<void>(resolve => pending.push(resolve));
      if (shareMode === 'error') throw new Error('Synthetic native share failure');
      return {action: shareMode === 'cancel' ? 'dismissedAction' : 'sharedAction'};
    },
  };
}
