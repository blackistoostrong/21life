import type { Profile } from './arena-catalog';
import type { MatchParticipantRecord } from '@/lib/arena-participants';

type MatchParticipant = MatchParticipantRecord;

export interface Match {
  id: string;
  group_id: string;
  winner_id: string | null;
  winner_guest_id?: string | null;
  is_draw?: boolean;
  played_at: string | null;
  created_by: string | null;
  notes: string | null;
  starting_life?: number | null;
  duration_seconds?: number | null;
  live_game_log?: unknown[];
  win_condition?: 'last_standing' | 'combo' | 'concession' | 'alternate_card' | 'other' | null;
  tracking_version?: number | null;
  winner: Profile | null;
  winner_guest?: { id: string; display_name: string } | null;
  match_participants: MatchParticipant[];
}
