import type { SupabaseClient } from '@supabase/supabase-js';
import type { ArchivedLiveGameOperation } from '@/lib/live-game-offline';
import { acknowledgeLiveGameOutboxItem, loadLiveGameOutbox } from '@/lib/live-game-offline';
import { ensureLiveGameCreated, applyQueuedLiveGameMutations, finalizePendingLiveGame, cancelLiveGame } from '@/lib/live-game-service';
import { LIVE_GAME_SYNC_BATCH_SIZE } from '@/lib/live-game-sync-policy';

/** Replay one captured account archive; callers own lifecycle and feedback. */
export async function replayLiveGameOutbox(supabase: SupabaseClient, currentUserId: string,
  setRecoveryOutbox: (items: ArchivedLiveGameOperation[]) => void, isCurrent: () => boolean,
  notifyMatch: (matchId: string) => void) {
    if (!currentUserId || !isCurrent()) return;
    let outbox = await loadLiveGameOutbox(currentUserId);
    if (!isCurrent()) return;
    setRecoveryOutbox(outbox);
    while (outbox.length > 0) {
      if (!isCurrent()) return;
      const item = outbox[0];
      let expected = JSON.stringify(item);
      const acknowledge = async (next: ArchivedLiveGameOperation | null) => {
        const result = await acknowledgeLiveGameOutboxItem(item.id, expected, next, currentUserId);
        if (!isCurrent()) return false;
        outbox = result.items;
        setRecoveryOutbox([...outbox]);
        if (!result.applied) return false;
        expected = JSON.stringify(next);
        return true;
      };
      let serverRecord = item.serverRecord;
      if (item.needsCreate) {
        serverRecord = await ensureLiveGameCreated(supabase, serverRecord);
        if (!isCurrent()) return;
        item.serverRecord = serverRecord;
        item.needsCreate = false;
        if (!await acknowledge(item)) return;
      }
      while (item.mutations.length > 0) {
        const batch = item.mutations.slice(0, LIVE_GAME_SYNC_BATCH_SIZE);
        serverRecord = await applyQueuedLiveGameMutations(supabase, serverRecord, batch);
        if (!isCurrent()) return;
        item.serverRecord = serverRecord;
        item.mutations = item.mutations.slice(batch.length);
        if (!await acknowledge(item)) return;
      }
      if (item.finalization) {
        const matchId = await finalizePendingLiveGame(
          supabase,
          serverRecord.id,
          item.finalization,
          serverRecord.state,
        );
        if (!isCurrent()) return;
        notifyMatch(matchId);
      } else if (item.cancel) {
        await cancelLiveGame(supabase, serverRecord.id);
        if (!isCurrent()) return;
      }
      if (!await acknowledge(null)) return;
    }
  }
