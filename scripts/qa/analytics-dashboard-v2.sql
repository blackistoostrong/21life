-- Disposable CI or explicit Dev only. All synthetic data is rolled back.
\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ;
CREATE TEMP TABLE qa26_analytics_users(n integer PRIMARY KEY, id uuid NOT NULL, email text NOT NULL) ON COMMIT DROP;
INSERT INTO qa26_analytics_users
SELECT n, gen_random_uuid(), 'qa26_analytics_' || substr(md5(gen_random_uuid()::text),1,16) || '@example.com'
FROM generate_series(1,3) n;
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
SELECT id,'authenticated','authenticated',email,now(),jsonb_build_object('username',split_part(email,'@',1)),
  '{"provider":"email","providers":["email"]}'::jsonb,now(),now() FROM qa26_analytics_users;
CREATE TEMP TABLE qa26_analytics_groups(n integer PRIMARY KEY,id uuid NOT NULL) ON COMMIT DROP;
INSERT INTO qa26_analytics_groups SELECT n,gen_random_uuid() FROM generate_series(1,2) n;
INSERT INTO public.groups(id,name,created_by)
SELECT g.id,'DEV26 synthetic analytics ' || g.n,u.id FROM qa26_analytics_groups g CROSS JOIN qa26_analytics_users u WHERE u.n=1;
INSERT INTO public.group_members(group_id,user_id)
SELECT g.id,u.id FROM qa26_analytics_groups g JOIN qa26_analytics_users u ON u.n=1 OR u.n=g.n+1 ON CONFLICT DO NOTHING;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM qa26_analytics_users WHERE n=1),true) IS NOT NULL AS synthetic_fixture_owner;
SELECT set_config('request.jwt.claim.role','authenticated',true) IS NOT NULL AS synthetic_fixture_role;
CREATE TEMP TABLE qa26_analytics_decks(n integer PRIMARY KEY,id uuid NOT NULL,owner_n integer NOT NULL) ON COMMIT DROP;
INSERT INTO qa26_analytics_decks SELECT n,gen_random_uuid(),CASE WHEN n<=4 THEN 1 ELSE n-3 END FROM generate_series(1,6) n;
INSERT INTO public.decks(id,user_id,group_id,name,commander,color_identity,bracket,source_type,is_archived)
SELECT d.id,u.id,CASE WHEN d.n=3 THEN (SELECT id FROM qa26_analytics_groups WHERE n=1) END,
  'DEV26 deck ' || d.n,'DEV26 commander ' || d.n,CASE WHEN d.n%2=0 THEN ARRAY['U','G'] ELSE ARRAY['W'] END,
  ((d.n-1)%5+1)::text,CASE WHEN d.n=3 THEN 'occasional' ELSE 'manual' END,d.n=2
FROM qa26_analytics_decks d JOIN qa26_analytics_users u ON u.n=d.owner_n;
INSERT INTO public.decks(id,user_id,name,commander,source_type,is_archived)
SELECT gen_random_uuid(),u.id,'DEV26 empty profile deck ' || sequence.n,'DEV26 commander','manual',false
FROM generate_series(1,1005) AS sequence(n) CROSS JOIN qa26_analytics_users u WHERE u.n=2;
CREATE TEMP TABLE qa26_analytics_matches(n integer PRIMARY KEY,id uuid NOT NULL,group_n integer NOT NULL,played_at timestamptz) ON COMMIT DROP;
INSERT INTO qa26_analytics_matches
SELECT n,gen_random_uuid(),CASE WHEN n%2=1 THEN 1 ELSE 2 END,now()-interval '60 days'+(n%31)*interval '1 day'
FROM generate_series(1,5001) n;
INSERT INTO public.matches(id,group_id,created_by,winner_id,played_at,is_draw,win_condition)
SELECT m.id,g.id,a.id,CASE WHEN m.n%5=0 THEN NULL WHEN m.n%3=0 THEN a.id ELSE opponent.id END,
  m.played_at,m.n%5=0,CASE WHEN m.n%5=0 THEN NULL WHEN m.n%3=0 THEN 'combo' ELSE 'other' END
FROM qa26_analytics_matches m JOIN qa26_analytics_groups g ON g.n=m.group_n
JOIN qa26_analytics_users a ON a.n=1 JOIN qa26_analytics_users opponent ON opponent.n=m.group_n+1;
INSERT INTO public.match_participants(match_id,user_id,deck_id,is_winner)
SELECT m.id,u.id,d.id,m.n%3=0 AND m.n%5<>0
FROM qa26_analytics_matches m JOIN qa26_analytics_users u ON u.n=1
JOIN qa26_analytics_decks d ON d.n=CASE WHEN m.n%4=0 THEN 4 ELSE m.n%4 END;
INSERT INTO public.match_participants(match_id,user_id,deck_id,is_winner)
SELECT m.id,u.id,d.id,m.n%3<>0 AND m.n%5<>0
FROM qa26_analytics_matches m JOIN qa26_analytics_users u ON u.n=m.group_n+1
JOIN qa26_analytics_decks d ON d.owner_n=u.n;

CREATE TEMP TABLE qa26_analytics_guest(id uuid,deck_id uuid) ON COMMIT DROP;
INSERT INTO qa26_analytics_guest VALUES(gen_random_uuid(),gen_random_uuid());
INSERT INTO public.arena_guests(id,group_id,display_name,normalized_name)
SELECT guest.id,g.id,'DEV26 guest','dev26 guest' FROM qa26_analytics_guest guest CROSS JOIN qa26_analytics_groups g WHERE g.n=1;
INSERT INTO public.arena_guest_decks(id,guest_id,group_id,name,commander,color_identity,bracket)
SELECT guest.deck_id,guest.id,g.id,'DEV26 guest deck','DEV26 guest commander',ARRAY['C'],'2'
FROM qa26_analytics_guest guest CROSS JOIN qa26_analytics_groups g WHERE g.n=1;
INSERT INTO public.match_participants(match_id,guest_id,guest_deck_id,is_winner)
SELECT m.id,guest.id,guest.deck_id,false FROM qa26_analytics_matches m CROSS JOIN qa26_analytics_guest guest WHERE m.n%1000=1;

DO $verify$
DECLARE
  a uuid := (SELECT id FROM qa26_analytics_users WHERE n=1);
  b uuid := (SELECT id FROM qa26_analytics_users WHERE n=2);
  deleted uuid := (SELECT id FROM qa26_analytics_decks WHERE n=4);
  first_match uuid := (SELECT id FROM qa26_analytics_matches WHERE n=1);
  result jsonb; expected record; subset jsonb; original_wins bigint; bracket_expected bigint;
  won boolean; longest integer := 0; current_run integer := 0; original_snapshot record;
BEGIN
  PERFORM set_config('request.jwt.claim.sub',a::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  DELETE FROM public.decks WHERE id=deleted;
  ASSERT EXISTS(SELECT 1 FROM public.decks WHERE id=deleted AND source_type='historical'), 'Deleted identity not preserved';

  result := public.get_personal_analytics_dashboard_v2(a);
  SELECT count(*) AS games,count(*) FILTER(WHERE p.is_winner AND NOT m.is_draw) AS wins,
    count(*) FILTER(WHERE m.is_draw) AS draws INTO expected
  FROM public.match_participants p JOIN public.matches m ON m.id=p.match_id WHERE p.user_id=a;
  ASSERT expected.games=5001, 'Fixture participation count';
  ASSERT (result->'totals'->>'gamesPlayed')::bigint=expected.games, 'Full personal count beyond API cap';
  ASSERT (result->'totals'->>'wins')::bigint=expected.wins, 'Personal wins';
  ASSERT (result->'totals'->>'draws')::bigint=expected.draws, 'Personal draws';
  ASSERT (result->>'uniqueDecks')::integer=4, 'Archived/occasional/deleted decks all retained';
  ASSERT (result->>'complete')::boolean AND (result->>'schemaVersion')::integer=2, 'Explicit completeness contract';
  ASSERT jsonb_array_length(result->'topDecks')=4, 'Bounded ranked deck cards';
  ASSERT EXISTS(SELECT 1 FROM jsonb_array_elements(result->'topDecks') item WHERE item->>'id'=deleted::text AND (item->>'historical')::boolean), 'Historical label';
  ASSERT (SELECT sum((item->>'gamesPlayed')::bigint) FROM jsonb_array_elements(result->'colors') item)=expected.games, 'Color group completeness';
  FOR won IN SELECT p.is_winner FROM public.match_participants p JOIN public.matches m ON m.id=p.match_id
    WHERE p.user_id=a AND NOT m.is_draw ORDER BY m.played_at,m.id,p.id
  LOOP
    IF won THEN current_run:=current_run+1; longest:=greatest(longest,current_run); ELSE current_run:=0; END IF;
  END LOOP;
  ASSERT (result->'streaks'->>'longest')::integer=longest AND (result->'streaks'->>'current')::integer=current_run, 'Independent ordered streak calculation';

  subset := public.get_personal_analytics_dashboard_v2(a,p_bracket=>'3');
  SELECT count(*) INTO bracket_expected FROM public.match_participants p JOIN public.matches m ON m.id=p.match_id
  WHERE p.user_id=a AND p.deck_bracket_snapshot='3';
  ASSERT (subset->'totals'->>'gamesPlayed')::bigint=bracket_expected, 'Historical bracket filter';
  subset := public.get_personal_analytics_dashboard_v2(a,now()-interval '50 days',now()-interval '40 days');
  SELECT count(*) INTO bracket_expected FROM public.match_participants p JOIN public.matches m ON m.id=p.match_id
  WHERE p.user_id=a AND m.played_at>=now()-interval '50 days' AND m.played_at<now()-interval '40 days';
  ASSERT (subset->'totals'->>'gamesPlayed')::bigint=bracket_expected, 'Half-open timestamp filter';
  ASSERT (public.get_personal_analytics_dashboard_v2(a,p_bracket=>'no-such-bracket')->'totals'->>'gamesPlayed')::integer=0, 'Empty filtered result';

  SELECT p.* INTO original_snapshot FROM public.match_participants p WHERE p.match_id=first_match AND p.user_id=a;
  UPDATE public.match_participants SET deck_name_snapshot='Historical name',commander_snapshot='Historical commander',
    deck_bracket_snapshot='5',color_identity_snapshot='{}'::text[] WHERE match_id=first_match AND user_id=a;
  subset:=public.get_personal_analytics_dashboard_v2(a,p_bracket=>'5');
  ASSERT (subset->'totals'->>'gamesPlayed')::integer=1 AND (subset->'totals'->>'unknownColorGames')::integer=1, 'One-row sample and unknown colors';
  ASSERT subset->'topDecks'->0->>'name'='Historical name' AND subset->'topDecks'->0->>'commander'='Historical commander', 'Fact snapshots precede current catalog';
  UPDATE public.match_participants SET color_identity_snapshot=ARRAY['R'] WHERE match_id=first_match AND user_id=a;
  subset:=public.get_personal_analytics_dashboard_v2(a,p_bracket=>'5');
  ASSERT subset->'colors'->0->'colors'='["R"]'::jsonb, 'Historical color identity';
  UPDATE public.match_participants SET deck_name_snapshot=original_snapshot.deck_name_snapshot,commander_snapshot=original_snapshot.commander_snapshot,
    deck_bracket_snapshot=original_snapshot.deck_bracket_snapshot,color_identity_snapshot=original_snapshot.color_identity_snapshot
  WHERE match_id=first_match AND user_id=a;
  UPDATE public.match_participants SET deck_bracket_snapshot='5'
  WHERE user_id=a AND match_id IN (SELECT id FROM qa26_analytics_matches WHERE n IN (1,3,5));
  subset:=public.get_personal_analytics_dashboard_v2(a,p_bracket=>'5');
  ASSERT (subset->'totals'->>'gamesPlayed')::integer=3 AND (subset->'totals'->>'wins')::integer=1 AND (subset->'totals'->>'draws')::integer=1, 'One win one loss one draw';
  UPDATE public.match_participants p SET deck_bracket_snapshot=d.bracket FROM public.decks d
  WHERE p.user_id=a AND p.deck_id=d.id AND p.match_id IN (SELECT id FROM qa26_analytics_matches WHERE n IN (1,3,5));

  -- Old rows without a surviving identity must not disappear or become a fabricated deck.
  UPDATE public.match_participants SET deck_id=NULL WHERE match_id=first_match AND user_id=a;
  subset := public.get_personal_analytics_dashboard_v2(a);
  ASSERT (subset->'totals'->>'gamesPlayed')::integer=5001 AND (subset->'totals'->>'unlinkedDeckGames')::integer=1, 'Unlinked legacy history retained';
  UPDATE public.match_participants SET deck_id=(SELECT id FROM qa26_analytics_decks WHERE n=1) WHERE match_id=first_match AND user_id=a;
  UPDATE public.matches SET played_at=NULL WHERE id=first_match;
  subset := public.get_personal_analytics_dashboard_v2(a);
  ASSERT NOT (subset->>'chronologyComplete')::boolean AND (subset->'streaks'->>'longest')::integer=0, 'Missing chronology is explicit';
  UPDATE public.matches SET played_at=(SELECT played_at FROM qa26_analytics_matches WHERE n=1) WHERE id=first_match;

  -- A corrected result is observed immediately; no stale or partial application cache.
  original_wins := (result->'totals'->>'wins')::bigint;
  UPDATE public.match_participants SET is_winner=(user_id<>a) WHERE match_id=(SELECT id FROM qa26_analytics_matches WHERE n=3);
  UPDATE public.matches SET winner_id=b WHERE id=(SELECT id FROM qa26_analytics_matches WHERE n=3);
  ASSERT (public.get_personal_analytics_dashboard_v2(a)->'totals'->>'wins')::bigint=original_wins-1, 'Result correction invalidates counts';
  UPDATE public.match_participants SET is_winner=(user_id=a) WHERE match_id=(SELECT id FROM qa26_analytics_matches WHERE n=3);
  UPDATE public.matches SET winner_id=a WHERE id=(SELECT id FROM qa26_analytics_matches WHERE n=3);

  BEGIN PERFORM public.get_personal_analytics_dashboard_v2(a,now(),now()); RAISE EXCEPTION 'Invalid period accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.get_personal_analytics_dashboard_v2(a,p_bracket=>''); RAISE EXCEPTION 'Invalid bracket accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  EXECUTE 'SET LOCAL ROLE authenticated';
  ASSERT (public.get_personal_analytics_dashboard_v2(a)->'totals'->>'gamesPlayed')::integer=5001, 'Real self role';
  result := public.get_profile_deck_performance_v2(a);
  ASSERT (result->>'total')::integer=jsonb_array_length(result->'decks') AND (result->>'complete')::boolean, 'Complete profile rollup envelope';
  BEGIN PERFORM public.get_personal_analytics_dashboard_v2(b); RAISE EXCEPTION 'Cross-user report leaked';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.get_profile_deck_performance_v2(b); RAISE EXCEPTION 'Cross-user profile leaked';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.get_global_analytics_dashboard_v2(); RAISE EXCEPTION 'Member global access allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM private.analytics_dashboard_v2(a,false,NULL,NULL,NULL); RAISE EXCEPTION 'Private helper exposed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub',b::text,true);
  result:=public.get_profile_deck_performance_v2(b);
  ASSERT (result->>'total')::integer=1006 AND jsonb_array_length(result->'decks')=1006, 'Complete profile above1000-row cap';
  PERFORM set_config('request.jwt.claim.sub',a::text,true);
  EXECUTE 'RESET ROLE';
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN PERFORM public.get_personal_analytics_dashboard_v2(a); RAISE EXCEPTION 'Anonymous report allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  EXECUTE 'RESET ROLE';
END;
$verify$;

-- Separate statements ensure admin membership changes are visible to STABLE functions.
INSERT INTO public.platform_admin_emails(email) SELECT email FROM qa26_analytics_users WHERE n=1;
DO $admin$
DECLARE a uuid := (SELECT id FROM qa26_analytics_users WHERE n=1); b uuid := (SELECT id FROM qa26_analytics_users WHERE n=2);
BEGIN
  PERFORM set_config('request.jwt.claim.sub',a::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  ASSERT (public.get_personal_analytics_dashboard_v2(b)->'totals'->>'gamesPlayed')::integer=2501, 'Admin cross-user access';
  EXECUTE 'RESET ROLE';
END;
$admin$;
DELETE FROM public.platform_admin_emails WHERE email=(SELECT email FROM qa26_analytics_users WHERE n=1);

DO $global_and_performance$
DECLARE
  a uuid := (SELECT id FROM qa26_analytics_users WHERE n=1);
  result jsonb; baseline jsonb; expected record; started timestamptz; old_ms numeric[] := '{}'; new_ms numeric[] := '{}';
  old_bytes integer; new_bytes integer; iteration integer;
BEGIN
  SELECT count(*) AS games,count(*) FILTER(WHERE p.is_winner AND NOT COALESCE(m.is_draw,false)) AS wins,
    count(*) FILTER(WHERE COALESCE(m.is_draw,false)) AS draws INTO expected
  FROM public.match_participants p JOIN public.matches m ON m.id=p.match_id
  WHERE p.user_id IS NOT NULL AND p.user_id NOT IN (SELECT * FROM public.get_analytics_excluded_user_ids());
  EXECUTE 'SET LOCAL ROLE service_role';
  result := public.get_global_analytics_dashboard_v2();
  ASSERT (result->'totals'->>'gamesPlayed')::bigint=expected.games, 'Global full count beyond10001';
  ASSERT expected.games>=10002, 'At least10001 registered participations required';
  ASSERT (result->'totals'->>'wins')::bigint=expected.wins AND (result->'totals'->>'draws')::bigint=expected.draws, 'Global independent wins/draws';
  ASSERT jsonb_array_length(result->'topDecks')<=10, 'Dashboard cards bounded';
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub',a::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  -- Warm both paths, then compare on the same dataset/session; no HTTP/provider time.
  FOR iteration IN 0..10 LOOP
    started := clock_timestamp();
    SELECT jsonb_agg(to_jsonb(fact)) INTO baseline FROM public.get_personal_analytics_facts(a) fact;
    IF iteration>0 THEN old_ms:=array_append(old_ms,extract(epoch FROM clock_timestamp()-started)*1000); END IF;
    started := clock_timestamp(); result := public.get_personal_analytics_dashboard_v2(a);
    IF iteration>0 THEN new_ms:=array_append(new_ms,extract(epoch FROM clock_timestamp()-started)*1000); END IF;
  END LOOP;
  old_bytes:=octet_length(baseline::text); new_bytes:=octet_length(result::text);
  ASSERT new_bytes<old_bytes/10, 'Dashboard payload must not scale with participation count';
  RAISE NOTICE 'Analytics v2:10002 registered +6 guest fixtures, exact totals/filters/roles PASS. Payload old=% new=% bytes',old_bytes,new_bytes;
  RAISE NOTICE 'Analytics benchmark old p50=% p95=% ms; new p50=% p95=% ms',
    (SELECT percentile_cont(0.5) WITHIN GROUP(ORDER BY value) FROM unnest(old_ms) value),
    (SELECT percentile_cont(0.95) WITHIN GROUP(ORDER BY value) FROM unnest(old_ms) value),
    (SELECT percentile_cont(0.5) WITHIN GROUP(ORDER BY value) FROM unnest(new_ms) value),
    (SELECT percentile_cont(0.95) WITHIN GROUP(ORDER BY value) FROM unnest(new_ms) value);
  EXECUTE 'RESET ROLE';
  EXECUTE 'SET LOCAL ROLE service_role';
  old_ms:='{}'; new_ms:='{}';
  FOR iteration IN 0..10 LOOP
    started:=clock_timestamp(); SELECT jsonb_agg(to_jsonb(fact)) INTO baseline FROM public.get_global_analytics_facts() fact;
    IF iteration>0 THEN old_ms:=array_append(old_ms,extract(epoch FROM clock_timestamp()-started)*1000); END IF;
    started:=clock_timestamp(); result:=public.get_global_analytics_dashboard_v2();
    IF iteration>0 THEN new_ms:=array_append(new_ms,extract(epoch FROM clock_timestamp()-started)*1000); END IF;
  END LOOP;
  RAISE NOTICE 'Global analytics benchmark payload old=% new=% bytes; old p50=% p95=% ms; new p50=% p95=% ms',
    octet_length(baseline::text),octet_length(result::text),
    (SELECT percentile_cont(0.5) WITHIN GROUP(ORDER BY value) FROM unnest(old_ms) value),
    (SELECT percentile_cont(0.95) WITHIN GROUP(ORDER BY value) FROM unnest(old_ms) value),
    (SELECT percentile_cont(0.5) WITHIN GROUP(ORDER BY value) FROM unnest(new_ms) value),
    (SELECT percentile_cont(0.95) WITHIN GROUP(ORDER BY value) FROM unnest(new_ms) value);
  EXECUTE 'RESET ROLE';
END;
$global_and_performance$;
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM qa26_analytics_users WHERE n=1),true) IS NOT NULL AS synthetic_auth_context;
SET LOCAL ROLE authenticated;
EXPLAIN (ANALYZE,BUFFERS) SELECT * FROM public.get_personal_analytics_facts(auth.uid());
EXPLAIN (ANALYZE,BUFFERS) SELECT public.get_personal_analytics_dashboard_v2(auth.uid());
RESET ROLE;
SELECT 'QA26_ANALYTICS_PAYLOAD=' || public.get_personal_analytics_dashboard_v2(auth.uid())::text;
ROLLBACK;
