/** Serialize durable snapshots while retaining failure for callers that require it. */
export function queueLiveGameJournalWrite(
  previous: Promise<void>,
  write: () => Promise<void>,
  onResult: (saved: boolean) => void,
): Promise<void> {
  const next = previous.catch(() => undefined).then(write).then(
    () => { onResult(true); },
    error => { onResult(false); throw error; },
  );
  // Fire-and-forget owners still receive onResult. Awaiting `next` continues
  // to reject, so archival/replacement cannot proceed after a failed save.
  void next.catch(() => undefined);
  return next;
}
