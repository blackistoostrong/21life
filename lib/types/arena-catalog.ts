export interface Profile {
  id: string;
  username: string;
  display_name: string | null;
}

export interface Deck {
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
  is_favorite: boolean;
  created_at: string;
}

export interface Group {
  id: string;
  name: string;
  description: string | null;
  invite_code: string;
  created_by: string;
  created_at: string;
  is_public?: boolean;
  seasons_enabled?: boolean;
  season_reset_month?: number;
  profiles: Profile;
  group_members: Array<{
    user_id: string;
    profiles: Profile;
  }>;
}

