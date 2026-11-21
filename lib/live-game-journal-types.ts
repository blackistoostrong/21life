import type { LiveGameRecord, QueuedLiveGameMutation, WinCondition } from '@/lib/live-game';
import type { LiveGameHistory } from '@/lib/live-game-history';

export type PendingLiveGameFinalization = {
  winnerKey: string | null;
  isDraw: boolean;
  winCondition: WinCondition | null;
  endedAt: string;
  players: Array<{
    participantKey: string;
    deckId: string;
    isGuest: boolean;
    userId: string | null;
    guestId: string | null;
  }>;
};

export type WebLiveGameJournal = {
  record: LiveGameRecord;
  serverRecord: LiveGameRecord;
  needsCreate: boolean;
  mutations: QueuedLiveGameMutation[];
  pendingFinalization: PendingLiveGameFinalization | null;
  pendingCancel: boolean;
  history: LiveGameHistory;
  savedAt: string;
};
