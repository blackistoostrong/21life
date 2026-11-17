-- Appended inside the disposable analytics transaction. Never commits fixtures.
DO $bundle$
DECLARE
 a uuid:=(SELECT id FROM qa26_analytics_users WHERE n=1);
 b uuid:=(SELECT id FROM qa26_analytics_users WHERE n=2);
 c uuid:=(SELECT id FROM qa26_analytics_users WHERE n=3);
 g uuid:=(SELECT id FROM qa26_analytics_groups WHERE n=1);
 deck_three uuid:=(SELECT id FROM qa26_analytics_decks WHERE n=3);
 report jsonb; legacy jsonb; row jsonb; expected record; expected_total bigint;
 selected_ids uuid[]; bracket_value text; i integer; original_time timestamptz;
 started timestamptz; old_ms numeric[]:='{}'; new_ms numeric[]:='{}';
BEGIN
 -- Rich counters contain tracked and manual rows, guests, ties and missing deck links.
 UPDATE public.matches m SET tracking_version=1,duration_seconds=CASE WHEN f.n%3=0 THEN 61 ELSE 60 END
 FROM qa26_analytics_matches f WHERE m.id=f.id AND f.n<=11;
 UPDATE public.matches SET tracking_version=1,duration_seconds=CASE WHEN f.n=3 THEN 60 ELSE 61 END
 FROM qa26_analytics_matches f WHERE public.matches.id=f.id AND f.n IN (3,27);
 UPDATE public.match_participants p SET placement=CASE WHEN p.is_winner THEN 1 ELSE 2 END,
   life_damage_dealt=13,life_gained=7,eliminations_caused=1,was_starting_player=coalesce(p.user_id=a,false),
   eliminated_at=CASE WHEN p.user_id=a THEN '2026-01-02T02:00:00Z'::timestamptz ELSE '2026-01-02T01:00:00Z'::timestamptz END
 FROM qa26_analytics_matches f WHERE p.match_id=f.id AND f.n<=11;
 UPDATE public.match_participants SET deck_id=NULL,guest_deck_id=NULL
 WHERE user_id=a AND match_id=(SELECT id FROM qa26_analytics_matches WHERE n=1);
 SELECT played_at INTO original_time FROM public.matches WHERE id=(SELECT id FROM qa26_analytics_matches WHERE n=11);
 UPDATE public.matches SET played_at=NULL WHERE id=(SELECT id FROM qa26_analytics_matches WHERE n=11);
 PERFORM set_config('request.jwt.claim.sub',b::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 FOR bracket_value IN SELECT value FROM unnest(ARRAY[NULL,'2','no-such-bracket']) value LOOP
   SELECT array_agg(m.id) INTO selected_ids FROM public.matches m
   WHERE m.group_id=g AND EXISTS(SELECT 1 FROM public.match_participants p
     LEFT JOIN public.decks d ON d.id=p.deck_id LEFT JOIN public.arena_guest_decks gd ON gd.id=p.guest_deck_id
     WHERE p.match_id=m.id AND (bracket_value IS NULL OR coalesce(p.deck_bracket_snapshot,d.bracket,gd.bracket)=bracket_value));
   expected_total:=coalesce(cardinality(selected_ids),0);
   EXECUTE 'SET LOCAL ROLE authenticated';
   report:=public.get_arena_analytics_bundle_v2(g,p_bracket=>bracket_value);
   EXECUTE 'RESET ROLE';
   ASSERT report->>'schemaVersion'='2' AND (report->>'complete')::boolean AND report->>'groupId'=g::text,'Versioned complete arena scope';
   ASSERT (report->>'totalMatches')::bigint=expected_total,'Exact full-group count and bracket match eligibility';
   ASSERT report->'filters'->>'bracket' IS NOT DISTINCT FROM bracket_value,'Bracket echo';
   FOR row IN SELECT value FROM jsonb_array_elements(report->'players') LOOP
     SELECT count(*) AS games,count(*) FILTER(WHERE p.is_winner) AS wins,count(*) FILTER(WHERE m.is_draw) AS draws,
       count(*) FILTER(WHERE p.placement=2) AS second,
       coalesce(sum(p.eliminations_caused),0) AS eliminations,coalesce(sum(p.life_damage_dealt),0) AS damage,
       count(*) FILTER(WHERE p.eliminated_at=(SELECT min(opponent.eliminated_at) FROM public.match_participants opponent WHERE opponent.match_id=m.id)) AS first,
       greatest(coalesce(max(p.life_gained),0),0) AS healing,count(*) FILTER(WHERE p.was_starting_player) AS starts,
       count(*) FILTER(WHERE p.is_winner AND m.win_condition='combo') AS combo,
       count(*) FILTER(WHERE p.is_winner AND m.win_condition='last_standing') AS last,
       count(*) FILTER(WHERE p.is_winner AND m.win_condition='concession') AS concession,
       count(*) FILTER(WHERE p.is_winner AND m.win_condition IN ('alternate_card','other')) AS skills
     INTO expected FROM public.match_participants p JOIN public.matches m ON m.id=p.match_id
     WHERE m.id=ANY(selected_ids) AND ((p.user_id IS NOT NULL AND p.user_id::text=row->>'user_id') OR (p.guest_id IS NOT NULL AND p.guest_id::text=row->>'guest_id'));
     ASSERT (row->>'games_played')::bigint=expected.games AND (row->>'wins')::bigint=expected.wins AND (row->>'draws')::bigint=expected.draws,'Independent player records';
     ASSERT (row->>'second_places')::bigint=expected.second AND (row->>'eliminations')::bigint=expected.eliminations AND (row->>'total_damage_dealt')::bigint=expected.damage,'Independent podium/damage/elimination counters';
     ASSERT (row->>'first_eliminations')::bigint=expected.first AND (row->>'max_life_gained')::bigint=expected.healing AND (row->>'starts')::bigint=expected.starts,'All-opponent first elimination and maximum healing';
     ASSERT (row->>'combo_wins')::bigint=expected.combo AND (row->>'last_standing_wins')::bigint=expected.last AND (row->>'concession_wins')::bigint=expected.concession AND (row->>'alternate_wins')::bigint=expected.skills,'Win-condition medals';
   END LOOP;
   ASSERT (SELECT coalesce(sum((value->>'games_played')::bigint),0) FROM jsonb_array_elements(report->'players'))=(SELECT count(*) FROM public.match_participants WHERE match_id=ANY(selected_ids) AND (user_id IS NOT NULL OR guest_id IS NOT NULL)),'No omitted player aggregates beyond REST cap';
   ASSERT (report->>'participations')::bigint=(SELECT count(*) FROM public.match_participants WHERE match_id=ANY(selected_ids)),'Complete participation population';
   ASSERT (SELECT coalesce(sum((value->>'appearances')::bigint),0) FROM jsonb_array_elements(report->'colors'))+(report->>'unknownColorParticipations')::bigint=(report->>'rankingParticipations')::bigint,'Unknown colors are not fabricated as colorless';
   ASSERT (SELECT coalesce(sum((value->>'games_played')::bigint),0) FROM jsonb_array_elements(report->'decks'))+(report->>'unlinkedDeckParticipations')::bigint=(report->>'rankingParticipations')::bigint,'Unlinked decks are not fabricated as physical decks';
   ASSERT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(report->'commanders') item WHERE bracket_value IS NOT NULL AND item->>'bracket' IS DISTINCT FROM bracket_value),'Commander bracket rows';
   ASSERT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(report->'decks') item WHERE bracket_value IS NOT NULL AND item->>'bracket' IS DISTINCT FROM bracket_value),'Deck bracket rows';
 END LOOP;
 EXECUTE 'SET LOCAL ROLE authenticated';
 report:=public.get_arena_analytics_bundle_v2(g);
 ASSERT (report->>'totalMatches')::integer>1000,'Arena dataset must exceed REST cap';
 ASSERT (report->>'unlinkedDeckParticipations')::integer>=1,'Missing deck identity is explicit';
 ASSERT EXISTS(SELECT 1 FROM jsonb_array_elements(report->'decks') item WHERE item->>'deck_id'=deck_three::text AND item->>'median_winning_duration_seconds'='61'),'Positive half median rounds like shared client';
 ASSERT public.get_arena_analytics_bundle_v2(g,'2050-01-01','2051-01-01')->>'totalMatches'='0','Empty half-open period';
 BEGIN PERFORM public.get_arena_analytics_bundle_v2(g,'2050-01-01','2050-01-01');RAISE EXCEPTION 'Invalid bounds accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 ASSERT current_setting('row_security')='on','Admin helper must not leak caller RLS settings';
 EXECUTE 'RESET ROLE';
 -- Membership and admin authorization are checked even for an empty report.
 PERFORM set_config('request.jwt.claim.sub',c::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 BEGIN PERFORM public.get_arena_analytics_bundle_v2(g);RAISE EXCEPTION 'Foreign group leaked';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 EXECUTE 'RESET ROLE';
END;
$bundle$;
-- A separate SQL statement makes the updated admin allowlist visible to STABLE functions.
INSERT INTO public.platform_admin_emails(email) SELECT email FROM qa26_analytics_users WHERE n=3;
DO $bundle_admin$
DECLARE c uuid:=(SELECT id FROM qa26_analytics_users WHERE n=3);g uuid:=(SELECT id FROM qa26_analytics_groups WHERE n=1);report jsonb;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',c::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';report:=public.get_arena_analytics_bundle_v2(g);EXECUTE 'RESET ROLE';
 ASSERT (report->>'totalMatches')::integer>1000,'Real admin role';
END;
$bundle_admin$;
DELETE FROM public.platform_admin_emails WHERE email=(SELECT email FROM qa26_analytics_users WHERE n=3);
DO $bundle_tail$
DECLARE b uuid:=(SELECT id FROM qa26_analytics_users WHERE n=2);g uuid:=(SELECT id FROM qa26_analytics_groups WHERE n=1);
 report jsonb;legacy jsonb;started timestamptz;i integer;old_ms numeric[]:='{}';new_ms numeric[]:='{}';
BEGIN
 PERFORM set_config('request.jwt.claim.sub',b::text,true);
 DELETE FROM public.group_members WHERE group_id=g AND user_id=b;
 EXECUTE 'SET LOCAL ROLE authenticated';
 BEGIN PERFORM public.get_arena_analytics_bundle_v2(g);RAISE EXCEPTION 'Revoked member retained access';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 EXECUTE 'RESET ROLE';INSERT INTO public.group_members(group_id,user_id) VALUES(g,b);
 PERFORM set_config('request.jwt.claim.sub','',true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 BEGIN PERFORM public.get_arena_analytics_bundle_v2(g);RAISE EXCEPTION 'Missing identity accepted';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 EXECUTE 'RESET ROLE';EXECUTE 'SET LOCAL ROLE anon';
 BEGIN PERFORM public.get_arena_analytics_bundle_v2(g);RAISE EXCEPTION 'Anon executed report';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 EXECUTE 'RESET ROLE';EXECUTE 'SET LOCAL ROLE service_role';
 BEGIN PERFORM public.get_arena_analytics_bundle_v2(g);RAISE EXCEPTION 'Userless service executed report';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 EXECUTE 'RESET ROLE';
 -- Compare the same authorized group, complete dataset and session, with warmup.
 PERFORM set_config('request.jwt.claim.sub',b::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 FOR i IN 0..10 LOOP
   started:=clock_timestamp();legacy:=public.get_arena_analytics_bundle(g);
   IF i>0 THEN old_ms:=array_append(old_ms,extract(epoch FROM clock_timestamp()-started)*1000);END IF;
   started:=clock_timestamp();report:=public.get_arena_analytics_bundle_v2(g);
   IF i>0 THEN new_ms:=array_append(new_ms,extract(epoch FROM clock_timestamp()-started)*1000);END IF;
 END LOOP;
 RAISE NOTICE 'Arena bundle v2 exact totals/medals/bracket/roles PASS. Payload old=% new=% bytes; p95 old=% new=% ms',octet_length(legacy::text),octet_length(report::text),
   (SELECT percentile_cont(0.95) WITHIN GROUP(ORDER BY value) FROM unnest(old_ms) value),
   (SELECT percentile_cont(0.95) WITHIN GROUP(ORDER BY value) FROM unnest(new_ms) value);
 EXECUTE 'RESET ROLE';
 RAISE NOTICE 'Arena bundle v2 p95 ratio=%',(SELECT percentile_cont(0.95) WITHIN GROUP(ORDER BY value) FROM unnest(new_ms) value)/(SELECT percentile_cont(0.95) WITHIN GROUP(ORDER BY value) FROM unnest(old_ms) value);
 UPDATE public.matches SET played_at=(SELECT played_at FROM qa26_analytics_matches WHERE n=11) WHERE id=(SELECT id FROM qa26_analytics_matches WHERE n=11);
END;
$bundle_tail$;

SELECT 'QA26_ARENA_BUNDLE_PAYLOAD=' || public.get_arena_analytics_bundle_v2((SELECT id FROM qa26_analytics_groups WHERE n=1))::text;
