-- Complete catalog metrics: one JSON value avoids PostgREST's table-row cap.
-- Historical match statistics remain attached to existing personal catalog IDs.
CREATE OR REPLACE FUNCTION private.profile_catalog_metrics_v2(p_user_id uuid, p_global boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH catalog AS MATERIALIZED (
    SELECT id FROM public.decks WHERE group_id IS NULL AND (p_global OR user_id = p_user_id)
  ), facts AS (
    SELECT participant.id,participant.deck_id,participant.match_id,participant.is_winner,participant.placement,
      participant.life_damage_dealt,participant.life_lost,participant.life_gained,participant.commander_damage_dealt,
      participant.infect_dealt,participant.eliminations_caused,participant.group_damage_dealt,
      participant.group_damage_events,participant.eliminated_at,participant.final_life,
      match.is_draw, match.duration_seconds, match.win_condition,
      (match.tracking_version IS NOT NULL OR match.duration_seconds IS NOT NULL) AS tracked
    FROM public.match_participants AS participant
    LEFT JOIN public.matches AS match ON match.id = participant.match_id
  ), eliminated_candidates AS MATERIALIZED (
    SELECT participant.id,participant.deck_id,participant.match_id,participant.eliminated_at
    FROM catalog JOIN public.match_participants AS participant ON participant.deck_id=catalog.id
    WHERE participant.eliminated_at IS NOT NULL
  ), first_eliminated AS (
    -- All opponents, including guests, determine first elimination in a match.
    SELECT participant.match_id, min(participant.eliminated_at) AS eliminated_at
    FROM public.match_participants AS participant
    JOIN (SELECT DISTINCT match_id FROM eliminated_candidates) AS relevant USING (match_id)
    GROUP BY participant.match_id
  ), first_counts AS (
    SELECT candidate.deck_id,count(*) AS value
    FROM eliminated_candidates AS candidate JOIN first_eliminated USING (match_id)
    WHERE candidate.eliminated_at IS NOT NULL AND candidate.eliminated_at=first_eliminated.eliminated_at
    GROUP BY candidate.deck_id
  ), rollup AS (
    SELECT catalog.id AS deck_id,
      count(facts.id) AS games_played,
      count(*) FILTER (WHERE facts.is_winner) AS wins,
      count(*) FILTER (WHERE facts.is_draw) AS draws,
      count(facts.id) + 2 * count(*) FILTER (WHERE facts.is_winner) AS mastery_points,
      count(*) FILTER (WHERE facts.tracked) AS tracked_games,
      count(*) FILTER (WHERE facts.placement = 2) AS second_places,
      COALESCE(sum(facts.life_damage_dealt) FILTER (WHERE facts.tracked), 0) AS damage_dealt,
      COALESCE(sum(facts.life_lost) FILTER (WHERE facts.tracked), 0) AS damage_taken,
      COALESCE(sum(facts.life_gained) FILTER (WHERE facts.tracked), 0) AS life_gained,
      COALESCE(sum(facts.commander_damage_dealt) FILTER (WHERE facts.tracked), 0) AS commander_damage,
      COALESCE(sum(facts.infect_dealt) FILTER (WHERE facts.tracked), 0) AS infect_dealt,
      COALESCE(sum(facts.eliminations_caused) FILTER (WHERE facts.tracked), 0) AS eliminations,
      round((percentile_cont(0.5) WITHIN GROUP (ORDER BY facts.duration_seconds)
        FILTER (WHERE facts.is_winner AND facts.duration_seconds IS NOT NULL))::numeric)::bigint AS median_winning_duration_seconds,
      COALESCE(sum(facts.group_damage_dealt) FILTER (WHERE facts.tracked), 0) AS group_damage_dealt,
      COALESCE(sum(facts.group_damage_events) FILTER (WHERE facts.tracked), 0) AS group_damage_events,
      count(*) FILTER (WHERE facts.is_winner AND facts.final_life < 10) AS comeback_wins,
      count(*) FILTER (WHERE facts.is_winner AND facts.win_condition = 'combo') AS combo_wins,
      count(*) FILTER (WHERE facts.is_winner AND facts.win_condition = 'alternate_card') AS alternate_wins
    FROM catalog LEFT JOIN facts ON facts.deck_id = catalog.id
    GROUP BY catalog.id
  ) SELECT jsonb_build_object('schemaVersion', 2, 'metricFieldsVersion', 1, 'complete', true,
    'asOf', statement_timestamp(), 'scope', CASE WHEN p_global THEN 'global' ELSE 'personal' END,
    'userId', CASE WHEN p_global THEN NULL ELSE p_user_id END,
    'total', count(*), 'decks', COALESCE(jsonb_agg(to_jsonb(rollup) || jsonb_build_object(
      'first_eliminations',COALESCE(first_counts.value,0)) ORDER BY deck_id), '[]'::jsonb))
    FROM rollup LEFT JOIN first_counts USING (deck_id);
$$;
REVOKE ALL ON FUNCTION private.profile_catalog_metrics_v2(uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_profile_deck_performance_v2(p_user_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE caller uuid := auth.uid(); target uuid := COALESCE(p_user_id, caller);
BEGIN
  IF caller IS NULL OR (target <> caller AND NOT public.is_admin(caller)) THEN
    RAISE EXCEPTION 'Analytics access denied' USING ERRCODE = '42501';
  END IF;
  RETURN private.profile_catalog_metrics_v2(target, false);
END;
$$;
REVOKE ALL ON FUNCTION public.get_profile_deck_performance_v2(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_profile_deck_performance_v2(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_global_profile_deck_performance_v2()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT private.profile_catalog_metrics_v2(NULL, true); $$;
REVOKE ALL ON FUNCTION public.get_global_profile_deck_performance_v2() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_global_profile_deck_performance_v2() TO service_role;

-- UUID keyset pages include a catalog fingerprint. Concurrent edits invalidate
-- a traversal instead of returning a mixture of different catalog revisions.
CREATE OR REPLACE FUNCTION private.profile_catalog_page_v2(
  p_user_id uuid, p_global boolean, p_after uuid, p_revision text, p_limit integer
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE result jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 250 OR (p_after IS NOT NULL AND p_revision IS NULL) THEN
    RAISE EXCEPTION 'Invalid catalog page' USING ERRCODE = '22023';
  END IF;
  WITH catalog AS MATERIALIZED (
    SELECT deck.id, to_jsonb(deck) || jsonb_build_object('profiles',jsonb_build_object(
      'username',profile.username,'display_name',profile.display_name)) AS payload
    FROM public.decks AS deck LEFT JOIN public.profiles AS profile ON profile.id=deck.user_id
    WHERE deck.group_id IS NULL AND (p_global OR deck.user_id=p_user_id)
  ), revision AS (
    SELECT count(*) AS total, md5(COALESCE(string_agg(md5(payload::text),'' ORDER BY id),'')) AS value FROM catalog
  ), page AS (
    SELECT * FROM catalog WHERE p_after IS NULL OR id>p_after ORDER BY id LIMIT p_limit
  ) SELECT jsonb_build_object('schemaVersion',2,'scope',CASE WHEN p_global THEN 'global' ELSE 'personal' END,
    'userId',CASE WHEN p_global THEN NULL ELSE p_user_id END,'revision',revision.value,'total',revision.total,
    'decks',COALESCE((SELECT jsonb_agg(payload ORDER BY id) FROM page),'[]'::jsonb),
    'next',CASE WHEN (SELECT count(*) FROM page)=p_limit THEN (SELECT max(id::text) FROM page) ELSE NULL END)
    INTO result FROM revision;
  IF p_revision IS NOT NULL AND p_revision<>result->>'revision' THEN
    RAISE EXCEPTION 'Catalog changed; restart pagination' USING ERRCODE='40001';
  END IF;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION private.profile_catalog_page_v2(uuid,boolean,uuid,text,integer) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.get_profile_catalog_page_v2(
  p_user_id uuid DEFAULT NULL,p_after uuid DEFAULT NULL,p_revision text DEFAULT NULL,p_limit integer DEFAULT 250
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE caller uuid:=auth.uid(); target uuid:=COALESCE(p_user_id,caller);
BEGIN
  IF caller IS NULL OR (target<>caller AND NOT public.is_admin(caller)) THEN
    RAISE EXCEPTION 'Catalog access denied' USING ERRCODE='42501';
  END IF;
  RETURN private.profile_catalog_page_v2(target,false,p_after,p_revision,p_limit);
END;
$$;
REVOKE ALL ON FUNCTION public.get_profile_catalog_page_v2(uuid,uuid,text,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_profile_catalog_page_v2(uuid,uuid,text,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_global_profile_catalog_page_v2(
  p_after uuid DEFAULT NULL,p_revision text DEFAULT NULL,p_limit integer DEFAULT 250
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT private.profile_catalog_page_v2(NULL,true,p_after,p_revision,p_limit); $$;
REVOKE ALL ON FUNCTION public.get_global_profile_catalog_page_v2(uuid,text,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_global_profile_catalog_page_v2(uuid,text,integer) TO service_role;
