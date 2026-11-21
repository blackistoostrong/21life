type IdleWorkOptions = {
  /** Run within this many ms even if the browser stays busy. */
  timeoutMs?: number;
};

export function runWhenIdle(
  task: () => void | Promise<void>,
  options: IdleWorkOptions = {},
) {
  let active = true;
  const run = () => {
    if (!active) return;
    active = false;
    void task();
  };
  if (typeof window === 'undefined') {
    run();
    return () => {};
  }

  const timeoutMs = options.timeoutMs ?? 4000;
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(run, { timeout: timeoutMs });
    return () => {
      if (!active) return;
      active = false;
      window.cancelIdleCallback?.(id);
    };
  }

  const timer = globalThis.setTimeout(run, Math.min(timeoutMs, 1500));
  return () => {
    active = false;
    globalThis.clearTimeout(timer);
  };
}
