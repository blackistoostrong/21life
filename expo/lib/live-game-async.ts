import {withRequestDeadline} from '../../packages/data/request-deadline';
export const LIVE_GAME_FOREGROUND_TIMEOUT_MS = 8_000;

/** Compatibility name and error text for installed live-game callers. */
export function withLiveGameRequestTimeout<T>(
  request:{abortSignal:(signal:AbortSignal)=>PromiseLike<T>},timeoutMs=15000,externalSignal?:AbortSignal,
):Promise<T> {
  return withRequestDeadline(request,timeoutMs,externalSignal,'Live game operation timed out');
}

export async function withLiveGameTimeout<T>(
  operation: Promise<T>,
  timeoutMs = LIVE_GAME_FOREGROUND_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Live game operation timed out')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
