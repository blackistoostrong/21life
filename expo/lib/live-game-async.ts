export const LIVE_GAME_FOREGROUND_TIMEOUT_MS = 8_000;

/** Bound durable sync attempts and cancel their transport before allowing retry. */
export async function withLiveGameRequestTimeout<T>(
  request: { abortSignal: (signal: AbortSignal) => PromiseLike<T> },
  timeoutMs = 15_000,
  externalSignal?: AbortSignal,
): Promise<T> {
  const aborted = () => { const error = new Error('Operation aborted'); error.name = 'AbortError'; return error; };
  if (externalSignal?.aborted) throw aborted();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const externalAbort = externalSignal ? new Promise<never>((_resolve,reject) => {
    onAbort = () => { controller.abort(); reject(aborted()); };
    externalSignal.addEventListener('abort',onAbort,{ once: true });
  }) : null;
  try {
    return await Promise.race([
      Promise.resolve(request.abortSignal(controller.signal)),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error('Live game operation timed out'));
          controller.abort();
        }, timeoutMs);
      }),
      ...(externalAbort ? [externalAbort] : []),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) externalSignal?.removeEventListener('abort',onAbort);
  }
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
