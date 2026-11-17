import type { ParticipantKey } from '@/lib/participant-keys';

export type WebTrackerDeck = {
  isOccasional?: boolean;
  id: string;
  name: string;
  commander: string;
  commanderImage: string | null;
  isFavorite: boolean;
};

export type WebTrackerParticipant = {
  key: ParticipantKey;
  displayName: string;
  isGuest: boolean;
  userId: string | null;
  guestId: string | null;
  decks: WebTrackerDeck[];
};

