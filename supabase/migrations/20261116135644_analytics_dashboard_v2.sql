-- Additive dashboard contracts. Existing table-returning RPCs remain for old clients.
CREATE OR REPLACE FUNCTION private.analytics_dashboard_v2(
  p_user_id uuid,
  p_global boolean,
  p_since timestamptz,
  p_until timestamptz,
  p_bracket text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
BEGIN
  IF (p_since IS NOT NULL AND p_until IS NOT NULL AND p_since >= p_until)
     OR (p_bracket IS NOT NULL AND (length(p_bracket) > 80 OR btrim(p_bracket) = '')) THEN
    RAISE EXCEPTION 'Invalid analytics filters' USING ERRCODE = '22023';
  END IF;
  RETURN (
    WITH excluded_users AS MATERIALIZED (
      SELECT excluded_id
      FROM public.get_analytics_excluded_user_ids() AS excluded(excluded_id)
      WHERE p_global
    ), participations AS MATERIALIZED (
      SELECT participant.id AS participant_id, match.id AS match_id, match.played_at,
        COALESCE(match.is_draw, false) AS is_draw,
        participant.is_winner AND NOT COALESCE(match.is_draw, false) AS is_winner,
        match.win_condition, participant.user_id, participant.deck_id, participant.guest_deck_id,
        participant.deck_name_snapshot, participant.commander_snapshot, participant.commander_image_snapshot,
        participant.deck_bracket_snapshot, participant.color_identity_snapshot
      FROM public.match_participants AS participant
      JOIN public.matches AS match ON match.id = participant.match_id
      WHERE (
        (NOT p_global AND participant.user_id = p_user_id)
        OR (p_global AND participant.user_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM excluded_users WHERE excluded_id = participant.user_id
        ))
      )
        AND (p_since IS NULL OR match.played_at >= p_since)
        AND (p_until IS NULL OR match.played_at < p_until)
    ), deck_metadata AS MATERIALIZED (
      SELECT id,name,commander,commander_image,bracket,color_identity,source_type
      FROM public.decks WHERE id=ANY(ARRAY(SELECT DISTINCT deck_id FROM participations WHERE deck_id IS NOT NULL))
    ), guest_metadata AS MATERIALIZED (
      SELECT id,name,commander,commander_image,bracket,color_identity
      FROM public.arena_guest_decks WHERE id=ANY(ARRAY(SELECT DISTINCT guest_deck_id FROM participations WHERE guest_deck_id IS NOT NULL))
    ), owner_metadata AS MATERIALIZED (
      SELECT id,username FROM public.profiles WHERE id=ANY(ARRAY(SELECT DISTINCT user_id FROM participations WHERE user_id IS NOT NULL))
    ), base_facts AS MATERIALIZED (
      SELECT participant.participant_id, participant.match_id, participant.played_at, participant.is_draw,
        participant.is_winner, participant.win_condition,
        CASE WHEN participant.deck_id IS NOT NULL THEN participant.deck_id::text
          WHEN participant.guest_deck_id IS NOT NULL THEN 'guest:' || participant.guest_deck_id::text ELSE NULL END AS deck_key,
        COALESCE(participant.deck_name_snapshot, deck.name, guest_deck.name, 'Deck') AS name,
        COALESCE(participant.commander_snapshot, deck.commander, guest_deck.commander, 'Unknown commander') AS commander,
        COALESCE(participant.commander_image_snapshot, deck.commander_image, guest_deck.commander_image) AS commander_image,
        COALESCE(participant.deck_bracket_snapshot, deck.bracket, guest_deck.bracket) AS bracket,
        COALESCE(participant.color_identity_snapshot, deck.color_identity, guest_deck.color_identity, '{}'::text[]) AS raw_colors,
        deck.source_type = 'historical' AS historical, profile.username AS owner_username
      FROM participations AS participant
      LEFT JOIN deck_metadata AS deck ON deck.id=participant.deck_id
      LEFT JOIN guest_metadata AS guest_deck ON guest_deck.id=participant.guest_deck_id
      LEFT JOIN owner_metadata AS profile ON profile.id=participant.user_id
    ), color_sets AS MATERIALIZED (
      SELECT raw_colors, ARRAY(
        SELECT DISTINCT upper(color) FROM unnest(raw_colors) AS source(color)
        WHERE upper(color) IN ('W','U','B','R','G','C')
          AND (upper(color)<>'C' OR NOT EXISTS (
            SELECT 1 FROM unnest(raw_colors) AS other(value) WHERE upper(value) IN ('W','U','B','R','G')
          )) ORDER BY upper(color)
      ) AS colors
      FROM (SELECT DISTINCT raw_colors FROM base_facts) AS identities
    ), facts AS MATERIALIZED (
      SELECT base_facts.*, color_sets.colors
      FROM base_facts JOIN color_sets USING (raw_colors)
      WHERE p_bracket IS NULL OR bracket = p_bracket
    ), deck_counts AS (
      SELECT deck_key, count(*) AS games, count(*) FILTER (WHERE is_winner) AS wins,
        count(*) FILTER (WHERE is_draw) AS draws
      FROM facts WHERE deck_key IS NOT NULL GROUP BY deck_key
    ), first_metadata AS (
      -- Preserve historical identity; equal dates have explicit, unique tiebreakers.
      SELECT DISTINCT ON (deck_key) deck_key, name, commander, commander_image, colors, historical, owner_username
      FROM facts WHERE deck_key IS NOT NULL
      ORDER BY deck_key, played_at, match_id, participant_id
    ), deck_cards AS (
      SELECT counts.deck_key, counts.games, counts.wins,
        CASE WHEN counts.games > counts.draws THEN round(100.0 * counts.wins / (counts.games - counts.draws)) ELSE 0 END AS rate,
        jsonb_build_object('id', counts.deck_key, 'name', metadata.name, 'commander', metadata.commander,
          'commanderImage', metadata.commander_image, 'colors', metadata.colors,
          'historical', COALESCE(metadata.historical, false), 'ownerUsername', metadata.owner_username,
          'gamesPlayed', counts.games, 'wins', counts.wins, 'draws', counts.draws) AS card
      FROM deck_counts AS counts JOIN first_metadata AS metadata USING (deck_key)
    ), color_counts AS (
      SELECT colors, count(*) AS games, count(*) FILTER (WHERE is_winner) AS wins,
        count(*) FILTER (WHERE is_draw) AS draws
      FROM facts GROUP BY colors
    ), decisive AS (
      SELECT is_winner, sum(CASE WHEN is_winner THEN 0 ELSE 1 END)
        OVER (ORDER BY played_at, match_id, participant_id ROWS UNBOUNDED PRECEDING) AS loss_group
      FROM facts WHERE NOT is_draw
    ), streaks AS (
      SELECT loss_group, count(*) FILTER (WHERE is_winner) AS wins FROM decisive GROUP BY loss_group
    ), bracket_counts AS (
      SELECT bracket, count(*) AS wins FROM facts WHERE is_winner AND NULLIF(bracket, '') IS NOT NULL GROUP BY bracket
    ), condition_counts AS (
      SELECT win_condition, count(*) AS wins FROM facts WHERE is_winner AND win_condition IS NOT NULL GROUP BY win_condition
    )
    SELECT jsonb_build_object(
      'schemaVersion', 2, 'complete', true, 'asOf', statement_timestamp(),
      'scope', CASE WHEN p_global THEN 'global' ELSE 'personal' END,
      'period', jsonb_build_object('since', p_since, 'until', p_until, 'bracket', p_bracket),
      'totals', jsonb_build_object('gamesPlayed', count(*), 'wins', count(*) FILTER (WHERE is_winner),
        'draws', count(*) FILTER (WHERE is_draw), 'matches', count(DISTINCT match_id),
        'unlinkedDeckGames', count(*) FILTER (WHERE deck_key IS NULL),
        'unknownColorGames', count(*) FILTER (WHERE cardinality(colors) = 0)),
      'uniqueDecks', (SELECT count(*) FROM deck_counts),
      'topDecks', COALESCE((SELECT jsonb_agg(card ORDER BY rate DESC, games DESC, wins DESC, deck_key)
        FROM (SELECT * FROM deck_cards ORDER BY rate DESC, games DESC, wins DESC, deck_key LIMIT 10) AS ranked), '[]'::jsonb),
      'bestDeck', (SELECT card FROM deck_cards WHERE games >= 3 ORDER BY rate DESC, wins DESC, games DESC, deck_key LIMIT 1),
      'colors', COALESCE((SELECT jsonb_agg(jsonb_build_object('colors', colors, 'gamesPlayed', games, 'wins', wins, 'draws', draws) ORDER BY colors)
        FROM color_counts), '[]'::jsonb),
      'bracketWins', COALESCE((SELECT jsonb_agg(jsonb_build_object('bracket', bracket, 'wins', wins) ORDER BY bracket) FROM bracket_counts), '[]'::jsonb),
      'winConditions', COALESCE((SELECT jsonb_agg(jsonb_build_object('condition', win_condition, 'wins', wins) ORDER BY win_condition) FROM condition_counts), '[]'::jsonb),
      'chronologyComplete', NOT EXISTS (SELECT 1 FROM facts WHERE played_at IS NULL),
      'streaks', jsonb_build_object('longest', CASE WHEN EXISTS (SELECT 1 FROM facts WHERE played_at IS NULL) THEN 0 ELSE COALESCE((SELECT max(wins) FROM streaks), 0) END,
        'current', CASE WHEN EXISTS (SELECT 1 FROM facts WHERE played_at IS NULL) THEN 0 ELSE COALESCE((SELECT wins FROM streaks ORDER BY loss_group DESC LIMIT 1), 0) END)
    ) FROM facts
  );
END;
$$;
REVOKE ALL ON FUNCTION private.analytics_dashboard_v2(uuid, boolean, timestamptz, timestamptz, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_personal_analytics_dashboard_v2(
  p_user_id uuid DEFAULT NULL,
  p_since timestamptz DEFAULT NULL,
  p_until timestamptz DEFAULT NULL,
  p_bracket text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE caller uuid := auth.uid(); target uuid := COALESCE(p_user_id, caller);
BEGIN
  IF caller IS NULL OR (target <> caller AND NOT public.is_admin(caller)) THEN
    RAISE EXCEPTION 'Analytics access denied' USING ERRCODE = '42501';
  END IF;
  RETURN private.analytics_dashboard_v2(target, false, p_since, p_until, p_bracket);
END;
$$;
REVOKE ALL ON FUNCTION public.get_personal_analytics_dashboard_v2(uuid, timestamptz, timestamptz, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_personal_analytics_dashboard_v2(uuid, timestamptz, timestamptz, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_global_analytics_dashboard_v2(
  p_since timestamptz DEFAULT NULL,
  p_until timestamptz DEFAULT NULL,
  p_bracket text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT private.analytics_dashboard_v2(NULL, true, p_since, p_until, p_bracket);
$$;
REVOKE ALL ON FUNCTION public.get_global_analytics_dashboard_v2(timestamptz, timestamptz, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_global_analytics_dashboard_v2(timestamptz, timestamptz, text) TO service_role;

CREATE OR REPLACE FUNCTION public.get_profile_deck_performance_v2(p_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE caller uuid := auth.uid(); target uuid := COALESCE(p_user_id, caller); rows jsonb;
BEGIN
  IF caller IS NULL OR (target <> caller AND NOT public.is_admin(caller)) THEN
    RAISE EXCEPTION 'Analytics access denied' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(performance) ORDER BY performance.deck_id), '[]'::jsonb)
    INTO rows FROM public.get_profile_deck_performance(target) AS performance;
  RETURN jsonb_build_object('schemaVersion', 2, 'complete', true, 'asOf', statement_timestamp(),
    'total', jsonb_array_length(rows), 'decks', rows);
END;
$$;
REVOKE ALL ON FUNCTION public.get_profile_deck_performance_v2(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_profile_deck_performance_v2(uuid) TO authenticated;
