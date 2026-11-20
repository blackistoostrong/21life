import type { MatchRecord } from '@/lib/win-rate';
import type { ParticipantKey } from '@/lib/participant-keys';
import type { Profile } from './arena-catalog';

export interface PlayerStats extends MatchRecord {
  key: ParticipantKey;
  displayName: string;
  isGuest: boolean;
  profile: Profile | null;
}
