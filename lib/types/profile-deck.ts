import type { CommanderOption } from '@/lib/deck-importers';

export type ProfileDeck = {
  id: string;
  user_id: string;
  group_id: string | null;
  name: string;
  commander: string;
  commander_image: string | null;
  source_url: string | null;
  source_type: string | null;
  bracket: string | null;
  color_identity: string[] | null;
  commander_options: CommanderOption[] | null;
  commander_cmc: number | null;
  is_favorite: boolean;
  is_archived: boolean;
  created_at: string;
  updated_at: string | null;
  profiles?: { username: string; display_name: string | null } | null;
};

export interface ProfileImportedDeckPreview {
  id?: string;
  name: string;
  commander: string;
  commanderImageUrl: string | null;
  commanderOptions?: CommanderOption[];
  colorIdentity?: string[];
  bracket: string | null;
  sourceUrl: string;
  sourceType: string;
  error?: string;
  warning?: string;
}

