-- Logical request/snapshot conflicts use HTTP409 rather than SQL serialization
-- failure40001 (HTTP500). Keep the applied predecessor immutable.
-- Keep header, participants, revision and transactional notification writes in
-- one transaction. Invoker rights preserve existing table RLS and triggers.
CREATE OR REPLACE FUNCTION public.save_arena_match_v1(
  p_actor_id uuid,
  p_group_id uuid,
  p_match_id uuid,
  p_match jsonb,
  p_participants jsonb,
  p_create boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  actor_id uuid := auth.uid();
  header public.matches%ROWTYPE;
  existing public.matches%ROWTYPE;
  participant public.match_participants%ROWTYPE;
  item jsonb;
  requested jsonb := '[]'::jsonb;
  requested_sorted jsonb;
  actual_sorted jsonb;
  identities text[] := ARRAY[]::text[];
  participant_ids uuid[] := ARRAY[]::uuid[];
  identity_key text;
  expected_winner boolean;
  winners integer := 0;
  saved_id uuid;
  actual_count integer;
BEGIN
  -- A request prepared for A must never commit under a newly acquired B token.
  IF actor_id IS NULL OR p_actor_id IS DISTINCT FROM actor_id THEN
    RAISE EXCEPTION 'MATCH_ACTOR_CHANGED' USING ERRCODE = '42501';
  END IF;
  IF p_group_id IS NULL OR p_match_id IS NULL OR p_create IS NULL THEN
    RAISE EXCEPTION 'MATCH_CONTEXT_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF NOT COALESCE(
    public.is_admin(actor_id)
    OR public.is_group_member(p_group_id, actor_id)
    OR public.is_group_owner(p_group_id, actor_id), false
  ) THEN
    RAISE EXCEPTION 'MATCH_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_match) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_participants) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'MATCH_PAYLOAD_INVALID' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_participants) < 2 THEN
    RAISE EXCEPTION 'MATCH_PLAYERS_REQUIRED' USING ERRCODE = '23514';
  END IF;

  header := jsonb_populate_record(NULL::public.matches, p_match);
  IF header.is_draw IS NULL
     OR (header.is_draw AND (header.winner_id IS NOT NULL OR header.winner_guest_id IS NOT NULL))
     OR (NOT header.is_draw AND ((header.winner_id IS NULL) = (header.winner_guest_id IS NULL)))
     OR (p_create AND header.played_at IS NULL) THEN
    RAISE EXCEPTION 'MATCH_RESULT_INVALID' USING ERRCODE = '23514';
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_participants)
  LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'MATCH_PARTICIPANT_INVALID' USING ERRCODE = '22023';
    END IF;
    participant := jsonb_populate_record(NULL::public.match_participants, item);
    IF (participant.user_id IS NULL) = (participant.guest_id IS NULL)
       OR (participant.user_id IS NOT NULL AND participant.guest_deck_id IS NOT NULL)
       OR (participant.guest_id IS NOT NULL AND participant.deck_id IS NOT NULL) THEN
      RAISE EXCEPTION 'MATCH_PARTICIPANT_INVALID' USING ERRCODE = '23514';
    END IF;
    identity_key := COALESCE('user:' || participant.user_id::text, 'guest:' || participant.guest_id::text);
    IF identity_key = ANY(identities) THEN
      RAISE EXCEPTION 'MATCH_DUPLICATE_PLAYER' USING ERRCODE = '23514';
    END IF;
    identities := array_append(identities, identity_key);
    IF NOT p_create THEN
      IF participant.id IS NULL OR participant.id = ANY(participant_ids) THEN
        RAISE EXCEPTION 'MATCH_PARTICIPANT_ID_INVALID' USING ERRCODE = '23514';
      END IF;
      participant_ids := array_append(participant_ids, participant.id);
    END IF;
    IF participant.guest_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.arena_guests AS guest
      WHERE guest.id = participant.guest_id AND guest.group_id = p_group_id
    ) THEN
      RAISE EXCEPTION 'MATCH_GUEST_FORBIDDEN' USING ERRCODE = '23514';
    END IF;
    IF p_create AND participant.user_id IS NOT NULL
       AND NOT public.is_group_member(p_group_id, participant.user_id) THEN
      RAISE EXCEPTION 'MATCH_PLAYER_FORBIDDEN' USING ERRCODE = '23514';
    END IF;
    expected_winner := NOT header.is_draw AND (
      (participant.user_id IS NOT NULL AND participant.user_id IS NOT DISTINCT FROM header.winner_id)
      OR (participant.guest_id IS NOT NULL AND participant.guest_id IS NOT DISTINCT FROM header.winner_guest_id)
    );
    IF participant.is_winner IS DISTINCT FROM expected_winner THEN
      RAISE EXCEPTION 'MATCH_WINNER_INVALID' USING ERRCODE = '23514';
    END IF;
    IF expected_winner THEN winners := winners + 1; END IF;
    requested := requested || jsonb_build_array(jsonb_build_object(
      'user_id', participant.user_id, 'guest_id', participant.guest_id,
      'deck_id', participant.deck_id, 'guest_deck_id', participant.guest_deck_id,
      'is_winner', participant.is_winner
    ));
  END LOOP;
  IF (header.is_draw AND winners <> 0) OR (NOT header.is_draw AND winners <> 1) THEN
    RAISE EXCEPTION 'MATCH_WINNER_INVALID' USING ERRCODE = '23514';
  END IF;

  IF p_create THEN
    INSERT INTO public.matches (
      id, group_id, created_by, is_draw, winner_id, winner_guest_id, notes, played_at, win_condition
    ) VALUES (
      p_match_id, p_group_id, actor_id, header.is_draw, header.winner_id, header.winner_guest_id,
      header.notes, header.played_at, CASE WHEN header.is_draw THEN NULL ELSE header.win_condition END
    ) ON CONFLICT (id) DO NOTHING RETURNING id INTO saved_id;

    IF saved_id IS NULL THEN
      -- The caller reuses one UUID for retries of this opening's exact command.
      -- A different payload/actor must not adopt or overwrite an existing match.
      SELECT * INTO existing FROM public.matches AS match
      WHERE match.id = p_match_id AND match.group_id = p_group_id FOR UPDATE;
      IF NOT FOUND OR existing.created_by IS DISTINCT FROM actor_id OR
        ROW(existing.is_draw, existing.winner_id, existing.winner_guest_id, existing.notes,
            existing.played_at, existing.win_condition)
        IS DISTINCT FROM
        ROW(header.is_draw, header.winner_id, header.winner_guest_id, header.notes,
            header.played_at, CASE WHEN header.is_draw THEN NULL ELSE header.win_condition END) THEN
        RAISE EXCEPTION 'MATCH_REQUEST_CONFLICT' USING ERRCODE = 'PT409';
      END IF;
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', part.user_id, 'guest_id', part.guest_id, 'deck_id', part.deck_id,
        'guest_deck_id', part.guest_deck_id, 'is_winner', part.is_winner
      ) ORDER BY COALESCE('user:' || part.user_id::text, 'guest:' || part.guest_id::text))
      INTO actual_sorted FROM public.match_participants AS part WHERE part.match_id = p_match_id;
      SELECT jsonb_agg(value ORDER BY COALESCE('user:' || (value->>'user_id'), 'guest:' || (value->>'guest_id')))
      INTO requested_sorted FROM jsonb_array_elements(requested);
      IF actual_sorted IS DISTINCT FROM requested_sorted THEN
        RAISE EXCEPTION 'MATCH_REQUEST_CONFLICT' USING ERRCODE = 'PT409';
      END IF;
      RETURN p_match_id;
    END IF;

    INSERT INTO public.match_participants (match_id, user_id, guest_id, deck_id, guest_deck_id, is_winner)
    SELECT p_match_id, part.user_id, part.guest_id, part.deck_id, part.guest_deck_id, part.is_winner
    FROM jsonb_to_recordset(requested) AS part(user_id uuid, guest_id uuid, deck_id uuid, guest_deck_id uuid, is_winner boolean);

    UPDATE public.arena_guests SET last_played_at = clock_timestamp()
    WHERE group_id = p_group_id AND id IN (
      SELECT part.guest_id FROM jsonb_to_recordset(requested) AS part(guest_id uuid) WHERE part.guest_id IS NOT NULL
    );
  ELSE
    SELECT * INTO existing FROM public.matches AS match
    WHERE match.id = p_match_id AND match.group_id = p_group_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'MATCH_NOT_FOUND_OR_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    PERFORM 1 FROM public.match_participants WHERE match_id = p_match_id FOR UPDATE;
    SELECT count(*) INTO actual_count FROM public.match_participants WHERE match_id = p_match_id;
    IF actual_count <> jsonb_array_length(p_participants) THEN
      RAISE EXCEPTION 'MATCH_PARTICIPANTS_CHANGED' USING ERRCODE = 'PT409';
    END IF;
    UPDATE public.matches SET is_draw = header.is_draw, winner_id = header.winner_id,
      winner_guest_id = header.winner_guest_id, notes = header.notes, played_at = header.played_at,
      win_condition = CASE WHEN header.is_draw THEN NULL ELSE header.win_condition END
    WHERE id = p_match_id AND group_id = p_group_id RETURNING id INTO saved_id;
    IF saved_id IS NULL THEN
      RAISE EXCEPTION 'MATCH_NOT_UPDATED' USING ERRCODE = '42501';
    END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(p_participants)
    LOOP
      participant := jsonb_populate_record(NULL::public.match_participants, item);
      UPDATE public.match_participants AS target SET user_id = participant.user_id,
        guest_id = participant.guest_id, deck_id = participant.deck_id,
        guest_deck_id = participant.guest_deck_id, is_winner = participant.is_winner,
        participant_name_snapshot = CASE WHEN item ? 'participant_name_snapshot'
          THEN participant.participant_name_snapshot ELSE target.participant_name_snapshot END
      WHERE target.id = participant.id AND target.match_id = p_match_id RETURNING target.id INTO saved_id;
      IF saved_id IS NULL THEN
        RAISE EXCEPTION 'MATCH_PARTICIPANT_NOT_UPDATED' USING ERRCODE = '42501';
      END IF;
    END LOOP;
  END IF;
  RETURN p_match_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_arena_match_v1(uuid, uuid, uuid, jsonb, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_arena_match_v1(uuid, uuid, uuid, jsonb, jsonb, boolean) TO authenticated;
NOTIFY pgrst, 'reload schema';
