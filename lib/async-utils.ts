export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  const aborted = () => { const error = new Error('Operation aborted'); error.name = 'AbortError'; return error; };
  if (signal?.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(aborted()); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function runTasksWithConcurrency<TItem, TResult>(
  items: TItem[],
  concurrency: number,
  task: (item: TItem, index: number) => Promise<TResult>,
): Promise<TResult[]> {
  if (items.length === 0) return [];

  const limit = Math.max(1, concurrency);
  const results = new Array<TResult>(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await task(items[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
}
