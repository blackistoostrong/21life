-- Additive bounded history API; legacy installed clients retain their RPCs.
CREATE TABLE private.arena_history_revisions (
  group_id uuid PRIMARY KEY REFERENCES public.groups(id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
ALTER TABLE private.arena_history_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.arena_history_revisions FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO private.arena_history_revisions(group_id) SELECT id FROM public.groups;

-- Batch one increment per affected group/statement. Live mutations do not
-- touch historical matches until finalization, so they do not contend here.
-- Filtering surviving parents also makes group-deletion cascades safe.
CREATE OR REPLACE FUNCTION private.bump_arena_history_revision_v2()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE affected uuid[];
BEGIN
  IF TG_TABLE_NAME='matches' THEN
    IF TG_OP='INSERT' THEN
      SELECT array_agg(DISTINCT group_id) INTO affected FROM new_history_rows;
    ELSIF TG_OP='DELETE' THEN
      SELECT array_agg(DISTINCT group_id) INTO affected FROM old_history_rows;
    ELSE
      SELECT array_agg(DISTINCT group_id) INTO affected FROM (
        SELECT group_id FROM new_history_rows UNION SELECT group_id FROM old_history_rows
      ) AS changed;
    END IF;
  ELSE
    IF TG_OP='INSERT' THEN
      SELECT array_agg(DISTINCT match.group_id) INTO affected FROM public.matches AS match
        JOIN new_history_rows AS changed ON changed.match_id=match.id;
    ELSIF TG_OP='DELETE' THEN
      SELECT array_agg(DISTINCT match.group_id) INTO affected FROM public.matches AS match
        JOIN old_history_rows AS changed ON changed.match_id=match.id;
    ELSE
      SELECT array_agg(DISTINCT match.group_id) INTO affected FROM public.matches AS match JOIN (
        SELECT match_id FROM new_history_rows UNION SELECT match_id FROM old_history_rows
      ) AS changed ON changed.match_id=match.id;
    END IF;
  END IF;
  INSERT INTO private.arena_history_revisions AS current(group_id,revision)
    SELECT id,1 FROM public.groups WHERE id=ANY(affected)
    ON CONFLICT(group_id) DO UPDATE SET revision=current.revision+1,updated_at=statement_timestamp();
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.bump_arena_history_revision_v2() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER arena_history_matches_insert_v2 AFTER INSERT ON public.matches
  REFERENCING NEW TABLE AS new_history_rows FOR EACH STATEMENT EXECUTE FUNCTION private.bump_arena_history_revision_v2();
CREATE TRIGGER arena_history_matches_update_v2 AFTER UPDATE ON public.matches
  REFERENCING OLD TABLE AS old_history_rows NEW TABLE AS new_history_rows FOR EACH STATEMENT EXECUTE FUNCTION private.bump_arena_history_revision_v2();
CREATE TRIGGER arena_history_matches_delete_v2 AFTER DELETE ON public.matches
  REFERENCING OLD TABLE AS old_history_rows FOR EACH STATEMENT EXECUTE FUNCTION private.bump_arena_history_revision_v2();
CREATE TRIGGER arena_history_participants_insert_v2 AFTER INSERT ON public.match_participants
  REFERENCING NEW TABLE AS new_history_rows FOR EACH STATEMENT EXECUTE FUNCTION private.bump_arena_history_revision_v2();
CREATE TRIGGER arena_history_participants_update_v2 AFTER UPDATE ON public.match_participants
  REFERENCING OLD TABLE AS old_history_rows NEW TABLE AS new_history_rows FOR EACH STATEMENT EXECUTE FUNCTION private.bump_arena_history_revision_v2();
CREATE TRIGGER arena_history_participants_delete_v2 AFTER DELETE ON public.match_participants
  REFERENCING OLD TABLE AS old_history_rows FOR EACH STATEMENT EXECUTE FUNCTION private.bump_arena_history_revision_v2();

CREATE OR REPLACE FUNCTION private.arena_day_key_v2(p_group_id uuid,p_played_at timestamptz,p_boundary_hour integer)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT CASE WHEN p_played_at IS NULL THEN 'undated'
    WHEN extract(hour FROM p_played_at AT TIME ZONE 'UTC')<p_boundary_hour AND EXISTS (
      SELECT 1 FROM public.matches AS previous
      WHERE previous.group_id=p_group_id
        AND previous.played_at>=(((p_played_at AT TIME ZONE 'UTC')::date-1)::timestamp AT TIME ZONE 'UTC')
        AND previous.played_at<(((p_played_at AT TIME ZONE 'UTC')::date)::timestamp AT TIME ZONE 'UTC')
    ) THEN to_char((p_played_at AT TIME ZONE 'UTC')::date-1,'YYYY-MM-DD')
    ELSE to_char((p_played_at AT TIME ZONE 'UTC')::date,'YYYY-MM-DD') END;
$$;
REVOKE ALL ON FUNCTION private.arena_day_key_v2(uuid,timestamptz,integer) FROM PUBLIC,anon,authenticated,service_role;

-- Same nested snapshot/current-label shape as the existing authorized day RPC.
-- Only already-authorized selected IDs may reach this private serializer.
CREATE OR REPLACE FUNCTION private.arena_history_cards_v2(p_ids uuid[],p_boundary_hour integer)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT COALESCE(
    jsonb_agg(
      to_jsonb(match_row)
      || jsonb_build_object(
        -- Daytime is an identity mapping. Only late-night rows need the
        -- authorized-group previous-calendar-day lookup in the shared helper.
        'arena_day_key', CASE WHEN match_row.played_at IS NULL THEN 'undated'
          WHEN extract(hour FROM match_row.played_at AT TIME ZONE 'UTC')>=p_boundary_hour
            THEN to_char((match_row.played_at AT TIME ZONE 'UTC')::date,'YYYY-MM-DD')
          ELSE private.arena_day_key_v2(match_row.group_id,match_row.played_at,p_boundary_hour) END,
        'winner', CASE
          WHEN winner_profile.id IS NULL THEN NULL
          ELSE jsonb_build_object(
            'id', winner_profile.id,
            'username', winner_profile.username,
            'display_name', winner_profile.display_name
          )
        END,
        'winner_guest', CASE
          WHEN winner_guest.id IS NULL THEN NULL
          ELSE jsonb_build_object(
            'id', winner_guest.id,
            'display_name', winner_guest.display_name
          )
        END,
        'match_participants', COALESCE(participant_rows.items, '[]'::jsonb)
      )
      ORDER BY match_row.played_at DESC NULLS LAST, match_row.id DESC
    ),
    '[]'::jsonb
  )
  FROM public.matches AS match_row
  LEFT JOIN public.profiles AS winner_profile
    ON winner_profile.id = match_row.winner_id
  LEFT JOIN public.arena_guests AS winner_guest
    ON winner_guest.id = match_row.winner_guest_id
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      to_jsonb(participant)
      || jsonb_build_object(
        'profiles', CASE
          WHEN participant_profile.id IS NULL THEN NULL
          ELSE jsonb_build_object(
            'id', participant_profile.id,
            'username', participant_profile.username,
            'display_name', participant_profile.display_name
          )
        END,
        'arena_guests', CASE
          WHEN participant_guest.id IS NULL THEN NULL
          ELSE jsonb_build_object(
            'id', participant_guest.id,
            'display_name', participant_guest.display_name
          )
        END,
        'decks', CASE
          WHEN participant_deck.id IS NULL THEN NULL
          ELSE jsonb_build_object(
            'name', participant_deck.name,
            'commander', participant_deck.commander,
            'commander_image', participant_deck.commander_image,
            'bracket', participant_deck.bracket,
            'color_identity', participant_deck.color_identity,
            'source_type', participant_deck.source_type
          )
        END,
        'arena_guest_decks', CASE
          WHEN participant_guest_deck.id IS NULL THEN NULL
          ELSE jsonb_build_object(
            'name', participant_guest_deck.name,
            'commander', participant_guest_deck.commander,
            'commander_image', participant_guest_deck.commander_image,
            'bracket', participant_guest_deck.bracket,
            'color_identity', participant_guest_deck.color_identity
          )
        END
      )
      ORDER BY participant.id
    ) AS items
    FROM public.match_participants AS participant
    LEFT JOIN public.profiles AS participant_profile
      ON participant_profile.id = participant.user_id
    LEFT JOIN public.arena_guests AS participant_guest
      ON participant_guest.id = participant.guest_id
    LEFT JOIN public.decks AS participant_deck
      ON participant_deck.id = participant.deck_id
    LEFT JOIN public.arena_guest_decks AS participant_guest_deck
      ON participant_guest_deck.id = participant.guest_deck_id
    WHERE participant.match_id = match_row.id
  ) AS participant_rows ON true
  WHERE match_row.id = ANY(p_ids);

$$;
REVOKE ALL ON FUNCTION private.arena_history_cards_v2(uuid[],integer) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.get_arena_history_page_v2(
  p_group_id uuid,p_limit integer DEFAULT 100,p_before_time timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL,
  p_revision text DEFAULT NULL,p_since timestamptz DEFAULT NULL,p_until timestamptz DEFAULT NULL,
  p_day_key text DEFAULT NULL,p_boundary_hour integer DEFAULT 8
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE caller uuid:=auth.uid(); ordering_revision text; result jsonb;day_start timestamptz;
BEGIN
  IF caller IS NULL OR NOT (public.is_admin(caller) OR public.is_group_member(p_group_id,caller)) THEN
    RAISE EXCEPTION 'Arena history access denied' USING ERRCODE='42501';
  END IF;
  IF p_limit IS NULL OR p_limit<1 OR p_limit>100 OR p_boundary_hour IS NULL OR p_boundary_hour<0 OR p_boundary_hour>23
    OR (p_before_time IS NOT NULL AND p_before_id IS NULL) OR (p_before_id IS NOT NULL AND p_revision IS NULL)
    OR (p_revision IS NOT NULL AND p_revision !~ '^[a-f0-9]{32}$')
    OR (p_since IS NOT NULL AND NOT isfinite(p_since)) OR (p_until IS NOT NULL AND NOT isfinite(p_until))
    OR (p_before_time IS NOT NULL AND NOT isfinite(p_before_time)) OR p_since>=p_until THEN
    RAISE EXCEPTION 'Invalid arena history cursor/filter' USING ERRCODE='22023';
  END IF;
  IF p_day_key IS NOT NULL AND p_day_key<>'undated' THEN
    IF p_day_key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR to_char(p_day_key::date,'YYYY-MM-DD')<>p_day_key THEN
      RAISE EXCEPTION 'Invalid arena day' USING ERRCODE='22023';
    END IF;
    day_start:=p_day_key::date::timestamp AT TIME ZONE 'UTC';
  END IF;
  -- Detect match/participant edits without rescanning the full group per page.
  -- Current profile/deck labels remain live; this is not a database snapshot.
  SELECT md5(p_group_id::text || ':' || COALESCE((SELECT revision::text
    FROM private.arena_history_revisions WHERE group_id=p_group_id),'0')) INTO ordering_revision;
  IF p_revision IS NOT NULL AND p_revision<>ordering_revision THEN
    RAISE EXCEPTION 'Arena history changed; restart pagination' USING ERRCODE='40001';
  END IF;
  IF p_before_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.matches WHERE id=p_before_id AND group_id=p_group_id
    AND played_at IS NOT DISTINCT FROM p_before_time) THEN
    RAISE EXCEPTION 'Invalid arena history cursor/filter' USING ERRCODE='22023';
  END IF;
  -- Keep finite time bounds indexable even when a cached generic plan is used.
  -- Null chronology is a separate branch, never a fabricated timestamp.
  WITH ranged AS (
    SELECT id,played_at FROM public.matches
    WHERE group_id=p_group_id AND p_day_key IS DISTINCT FROM 'undated'
      AND played_at>=greatest(COALESCE(p_since,'-infinity'::timestamptz),COALESCE(day_start,'-infinity'::timestamptz))
      AND played_at<least(COALESCE(p_until,'infinity'::timestamptz),COALESCE(day_start+interval '2 days','infinity'::timestamptz))
    UNION ALL
    SELECT id,played_at FROM public.matches WHERE group_id=p_group_id AND played_at IS NULL
      AND p_since IS NULL AND p_until IS NULL AND (p_day_key IS NULL OR p_day_key='undated')
  ), eligible AS MATERIALIZED (
    SELECT * FROM ranged WHERE p_day_key IS NULL OR p_day_key='undated'
      OR private.arena_day_key_v2(p_group_id,played_at,p_boundary_hour)=p_day_key
  ), page AS MATERIALIZED (
    SELECT * FROM eligible WHERE p_before_id IS NULL
      OR (p_before_time IS NULL AND played_at IS NULL AND id<p_before_id)
      OR (p_before_time IS NOT NULL AND (played_at<p_before_time OR played_at IS NULL OR (played_at=p_before_time AND id<p_before_id)))
    ORDER BY played_at DESC NULLS LAST,id DESC LIMIT p_limit+1
  ), visible AS MATERIALIZED (
    SELECT * FROM page ORDER BY played_at DESC NULLS LAST,id DESC LIMIT p_limit
  ) SELECT jsonb_build_object('schemaVersion',2,'complete',true,'asOf',statement_timestamp(),
    'groupId',p_group_id,'revision',ordering_revision,'total',(SELECT count(*) FROM eligible),
    'filters',jsonb_build_object('since',p_since,'until',p_until,'dayKey',p_day_key,'boundaryHour',p_boundary_hour),
    'matches',private.arena_history_cards_v2(ARRAY(SELECT id FROM visible),p_boundary_hour),
    'next',CASE WHEN (SELECT count(*) FROM page)>p_limit THEN
      (SELECT jsonb_build_object('playedAt',played_at,'id',id) FROM visible ORDER BY played_at ASC NULLS FIRST,id ASC LIMIT 1)
      ELSE NULL END) INTO result;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_arena_history_page_v2(uuid,integer,timestamptz,uuid,text,timestamptz,timestamptz,text,integer)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_arena_history_page_v2(uuid,integer,timestamptz,uuid,text,timestamptz,timestamptz,text,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_arena_match_day_summaries_v2(p_group_id uuid,p_boundary_hour integer DEFAULT 8)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE caller uuid:=auth.uid(); result jsonb;
BEGIN
  IF caller IS NULL OR NOT (public.is_admin(caller) OR public.is_group_member(p_group_id,caller)) THEN
    RAISE EXCEPTION 'Arena history access denied' USING ERRCODE='42501';
  END IF;
  IF p_boundary_hour IS NULL OR p_boundary_hour<0 OR p_boundary_hour>23 THEN
    RAISE EXCEPTION 'Invalid arena day boundary' USING ERRCODE='22023';
  END IF;
  SELECT jsonb_build_object('schemaVersion',2,'complete',true,'groupId',p_group_id,'boundaryHour',p_boundary_hour,
    'asOf',statement_timestamp(),'totalDays',count(*),'days',COALESCE(jsonb_agg(jsonb_build_object(
      'dayKey',COALESCE(day_key,'undated'),'matchCount',match_count,'latestPlayedAt',latest_played_at)
      ORDER BY day_key DESC NULLS LAST),'[]'::jsonb)) INTO result
    FROM public.get_arena_match_day_summaries(p_group_id,p_boundary_hour);
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_arena_match_day_summaries_v2(uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_arena_match_day_summaries_v2(uuid,integer) TO authenticated;
