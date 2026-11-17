-- Complete arena aggregates and player-award counters in one authorized snapshot.
-- Legacy aggregate functions remain unchanged for installed clients.
-- Definer preserves authorized group members' historical/current deck labels even
-- when per-owner catalog RLS would hide the join. Every call checks the caller first.
CREATE OR REPLACE FUNCTION public.get_arena_analytics_bundle_v2(
  p_group_id uuid,p_since timestamptz DEFAULT NULL,p_until timestamptz DEFAULT NULL,p_bracket text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE caller_id uuid := auth.uid();
BEGIN
  IF caller_id IS NULL OR NOT (public.is_admin(caller_id) OR public.is_group_member(p_group_id,caller_id)) THEN
    RAISE EXCEPTION 'Arena access denied' USING ERRCODE = '42501';
  END IF;
  IF p_group_id IS NULL OR (p_since IS NOT NULL AND p_until IS NOT NULL AND p_since >= p_until)
    OR (p_bracket IS NOT NULL AND (p_bracket = '' OR length(p_bracket)>32 OR p_bracket <> btrim(p_bracket))) THEN
    RAISE EXCEPTION 'Invalid arena analytics scope' USING ERRCODE = '22023';
  END IF;
  RETURN (
  with period_facts as materialized (
    select
      match.id as match_id,
      match.played_at,
      match.is_draw,
      match.duration_seconds,
      match.tracking_version,
      match.win_condition,
      participant.user_id,
      participant.guest_id,
      participant.deck_id,
      participant.guest_deck_id,
      participant.is_winner,
      participant.was_starting_player,
      participant.placement,
      participant.final_life,
      participant.eliminated_at,
      (
        participant.eliminated_at is not null
        and participant.eliminated_at = min(participant.eliminated_at)
          over (partition by match.id)
      ) as was_first_eliminated,
      participant.life_lost,
      participant.life_gained,
      participant.life_damage_dealt,
      participant.commander_damage_dealt,
      participant.infect_dealt,
      participant.eliminations_caused,
      participant.group_damage_dealt,
      participant.group_damage_events,
      coalesce(
        participant.participant_name_snapshot,
        guest.display_name,
        nullif(profile.display_name, ''),
        profile.username,
        'Player'
      ) as participant_name,
      coalesce(nullif(deck_owner.display_name, ''), deck_owner.username, guest_owner.display_name, participant.participant_name_snapshot, 'Player') as owner_display_name,
      coalesce(participant.deck_name_snapshot, deck.name, guest_deck.name, 'Deck') as deck_name,
      coalesce(participant.commander_snapshot, deck.commander, guest_deck.commander, 'Unknown commander') as commander,
      coalesce(participant.commander_image_snapshot, deck.commander_image, guest_deck.commander_image) as commander_image,
      coalesce(participant.deck_bracket_snapshot, deck.bracket, guest_deck.bracket) as bracket,
      coalesce(participant.color_identity_snapshot, deck.color_identity, guest_deck.color_identity) as color_identity
    from public.matches as match
    join public.match_participants as participant on participant.match_id = match.id
    left join public.profiles as profile on profile.id = participant.user_id
    left join public.arena_guests as guest on guest.id = participant.guest_id
    left join public.decks as deck on deck.id = participant.deck_id
    left join public.arena_guest_decks as guest_deck on guest_deck.id = participant.guest_deck_id
    left join public.profiles as deck_owner on deck_owner.id = deck.user_id
    left join public.arena_guests as guest_owner on guest_owner.id = guest_deck.guest_id
    where match.group_id = p_group_id
      and (p_since is null or match.played_at >= p_since)
      and (p_until is null or match.played_at < p_until)

  ),
  eligible_matches as (
    select distinct match_id from period_facts
    where p_bracket is null or bracket = p_bracket
  ),
  facts as materialized (
    select period_facts.* from period_facts
    join eligible_matches using (match_id)
  ),
  player_rollup as (
    select
      case when user_id is not null then 'user:' || user_id::text else 'guest:' || guest_id::text end as key,
      user_id,
      guest_id,
      (array_agg(participant_name order by played_at desc nulls last, match_id desc))[1] as display_name,
      guest_id is not null as is_guest,
      count(*)::integer as games_played,
      count(*) filter (where is_draw)::integer as draws,
      count(*) filter (where is_winner)::integer as wins,
      count(*) filter (where placement = 2)::integer as second_places,
      coalesce(sum(eliminations_caused),0)::bigint as eliminations,
      coalesce(sum(life_damage_dealt),0)::bigint as total_damage_dealt,
      count(*) filter (where was_first_eliminated)::integer as first_eliminations,
      count(*) filter (where is_winner and win_condition = 'combo')::integer as combo_wins,
      count(*) filter (where is_winner and win_condition = 'last_standing')::integer as last_standing_wins,
      count(*) filter (where is_winner and win_condition = 'concession')::integer as concession_wins,
      count(*) filter (where is_winner and win_condition in ('alternate_card','other'))::integer as alternate_wins,
      greatest(coalesce(max(life_gained),0),0)::bigint as max_life_gained,
      count(*) filter (where was_starting_player)::integer as starts
    from facts
    where user_id is not null or guest_id is not null
    group by key, user_id, guest_id, guest_id is not null
  ),
  commander_rollup as (
    select
      commander,
      commander_image,
      bracket,
      count(*)::integer as games_played,
      count(*) filter (where is_draw)::integer as draws,
      count(*) filter (where is_winner)::integer as wins
    from facts
    where p_bracket is null or bracket = p_bracket
    group by commander, commander_image, bracket
  ),
  color_rollup as (
    select
      color_identity,
      bracket,
      count(*)::integer as appearances,
      count(*) filter (where is_draw)::integer as draws,
      count(*) filter (where is_winner)::integer as wins
    from facts
    where (p_bracket is null or bracket = p_bracket)
      and color_identity is not null
    group by color_identity, bracket
  ),
  deck_rollup as (
    select
      case when deck_id is not null then 'deck:' || deck_id::text else 'guest:' || guest_deck_id::text end as key,
      coalesce(deck_id, guest_deck_id) as deck_id,
      guest_deck_id is not null as is_guest_deck,
      (array_agg(bracket order by played_at desc nulls last, match_id desc))[1] as bracket,
      (array_agg(owner_display_name order by played_at desc nulls last, match_id desc))[1] as owner_display_name,
      (array_agg(deck_name order by played_at desc nulls last, match_id desc))[1] as deck_name,
      (array_agg(commander order by played_at desc nulls last, match_id desc))[1] as commander,
      (array_agg(commander_image order by played_at desc nulls last, match_id desc))[1] as commander_image,
      count(*)::integer as games_played,
      count(*) filter (
        where tracking_version is not null or duration_seconds is not null
      )::integer as tracked_games,
      count(*) filter (where is_draw)::integer as draws,
      count(*) filter (where is_winner)::integer as wins,
      count(*) filter (where placement = 2)::integer as second_places,
      count(*) filter (where was_first_eliminated)::integer as first_eliminations,
      count(*) filter (
        where is_winner and final_life is not null and final_life < 10
      )::integer as comeback_wins,
      count(*) filter (where is_winner and win_condition = 'combo')::integer as combo_wins,
      count(*) filter (where is_winner and win_condition = 'alternate_card')::integer as alternate_wins,
      coalesce(sum(life_damage_dealt) filter (
        where tracking_version is not null or duration_seconds is not null
      ), 0)::integer as total_damage_dealt,
      coalesce(sum(life_lost) filter (
        where tracking_version is not null or duration_seconds is not null
      ), 0)::integer as total_damage_taken,
      coalesce(sum(life_gained) filter (
        where tracking_version is not null or duration_seconds is not null
      ), 0)::integer as total_life_gained,
      coalesce(sum(commander_damage_dealt) filter (
        where tracking_version is not null or duration_seconds is not null
      ), 0)::integer as commander_damage_dealt,
      coalesce(sum(infect_dealt) filter (
        where tracking_version is not null or duration_seconds is not null
      ), 0)::integer as infect_dealt,
      coalesce(sum(eliminations_caused) filter (
        where tracking_version is not null or duration_seconds is not null
      ), 0)::integer as eliminations,
      coalesce(sum(group_damage_dealt) filter (
        where tracking_version is not null or duration_seconds is not null
      ), 0)::integer as group_damage_dealt,
      coalesce(sum(group_damage_events) filter (
        where tracking_version is not null or duration_seconds is not null
      ), 0)::integer as group_damage_events,
      floor((percentile_cont(0.5) within group (order by duration_seconds)
        filter (where is_winner and duration_seconds > 0)) + 0.5)::integer
        as median_winning_duration_seconds
    from facts
    where (deck_id is not null or guest_deck_id is not null)
      and (p_bracket is null or bracket = p_bracket)
    group by key, coalesce(deck_id, guest_deck_id), guest_deck_id is not null
  )
  select pg_catalog.jsonb_build_object(
    'schemaVersion',2,'complete',true,'asOf',transaction_timestamp(),'groupId',p_group_id,
    'filters',jsonb_build_object('since',p_since,'until',p_until,'bracket',p_bracket),
    'bracketOptions',coalesce((select jsonb_agg(bracket order by bracket) from (select distinct bracket from period_facts where bracket is not null and bracket <> '') as options),'[]'::jsonb),
    'participations',(select count(*) from facts),
    'rankingParticipations',(select count(*) from facts where p_bracket is null or bracket=p_bracket),
    'unknownColorParticipations',(select count(*) from facts where color_identity is null and (p_bracket is null or bracket=p_bracket)),
    'unlinkedDeckParticipations',(select count(*) from facts where deck_id is null and guest_deck_id is null and (p_bracket is null or bracket=p_bracket)),
    'unlinkedPlayerParticipations',(select count(*) from facts where user_id is null and guest_id is null),
    'players', coalesce((select pg_catalog.jsonb_agg(player_rollup) from player_rollup), '[]'::jsonb),
    'commanders', coalesce((select pg_catalog.jsonb_agg(commander_rollup) from commander_rollup), '[]'::jsonb),
    'colors', coalesce((select pg_catalog.jsonb_agg(color_rollup) from color_rollup), '[]'::jsonb),
    'decks', coalesce((select pg_catalog.jsonb_agg(deck_rollup) from deck_rollup), '[]'::jsonb),
    'totalMatches', (select count(distinct match_id)::integer from facts)
  )
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.get_arena_analytics_bundle_v2(uuid,timestamptz,timestamptz,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_arena_analytics_bundle_v2(uuid,timestamptz,timestamptz,text) TO authenticated;
NOTIFY pgrst,'reload schema';
