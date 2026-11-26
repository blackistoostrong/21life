/** Storage owns serialization. Register each write now, then track durable completion. */
export function queueLiveGameJournalWrite(
  previous: Promise<void>,
  write: () => Promise<void>,
  onResult: (saved: boolean) => void,
): Promise<void> {
  // Deferring registration until `previous` resolves lets a remount read or
  // matching clear enter storage's account queue before an accepted snapshot.
  let accepted: Promise<void>;
  try { accepted = write(); }
  catch (error) { accepted = Promise.reject(error); }
  const next = Promise.all([previous.catch(() => undefined), accepted]).then(
    () => { onResult(true); },
    error => { onResult(false); throw error; },
  );
  // Fire-and-forget owners still receive onResult. Awaiting `next` continues
  // to reject, so archival/replacement cannot proceed after a failed save.
  void next.catch(() => undefined);
  return next;
}
