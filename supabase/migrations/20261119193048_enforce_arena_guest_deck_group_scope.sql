-- A deck and its guest must belong to the same arena, independently of RLS.
-- Replace the old guest-only FK atomically: keeping both would make PostgREST's
-- existing arena_guests -> arena_guest_decks embedding ambiguous.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.arena_guest_decks AS deck
    JOIN public.arena_guests AS guest ON guest.id = deck.guest_id
    WHERE deck.group_id <> guest.group_id
  ) THEN
    RAISE EXCEPTION 'Guest deck group mismatch: review existing data before migration';
  END IF;
END;
$guard$;

ALTER TABLE public.arena_guests
  ADD CONSTRAINT arena_guests_id_group_id_key UNIQUE (id, group_id);

ALTER TABLE public.arena_guest_decks
  ADD CONSTRAINT arena_guest_decks_guest_group_fkey
  FOREIGN KEY (guest_id, group_id)
  REFERENCES public.arena_guests (id, group_id)
  ON DELETE CASCADE NOT VALID;

ALTER TABLE public.arena_guest_decks
  VALIDATE CONSTRAINT arena_guest_decks_guest_group_fkey;

DO $replace$
DECLARE
  old_fk record;
BEGIN
  FOR old_fk IN
    SELECT constraint_info.conname
    FROM pg_constraint AS constraint_info
    JOIN pg_attribute AS column_info
      ON column_info.attrelid = constraint_info.conrelid
     AND column_info.attname = 'guest_id'
    WHERE constraint_info.conrelid = 'public.arena_guest_decks'::regclass
      AND constraint_info.confrelid = 'public.arena_guests'::regclass
      AND constraint_info.contype = 'f'
      AND constraint_info.conkey = ARRAY[column_info.attnum]::smallint[]
  LOOP
    EXECUTE format('ALTER TABLE public.arena_guest_decks DROP CONSTRAINT %I', old_fk.conname);
  END LOOP;
END;
$replace$;

NOTIFY pgrst, 'reload schema';
