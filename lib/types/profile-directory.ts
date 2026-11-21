export interface ProfileDirectoryEntry {
  id: string;
  username: string;
  display_name: string | null;
  archidekt_username: string | null;
  archidekt_auto_import: boolean;
  archidekt_last_sync_at: string | null;
}

