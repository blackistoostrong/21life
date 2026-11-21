-- Runs inside analytics-dashboard-v2.sql's disposable fixture transaction.
DO $profile$
DECLARE
  a uuid := (SELECT id FROM qa26_analytics_users WHERE n=1);
  b uuid := (SELECT id FROM qa26_analytics_users WHERE n=2);
  report jsonb; item jsonb; original jsonb; target uuid;
  extra text[] := ARRAY['group_damage_dealt','group_damage_events','first_eliminations','comeback_wins','combo_wins','alternate_wins'];
  expected bigint; started timestamptz;
BEGIN
  PERFORM set_config('request.jwt.claim.sub',a::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  report := public.get_profile_deck_performance_v2(a);
  ASSERT report->>'scope'='personal' AND report->>'userId'=a::text AND report->>'metricFieldsVersion'='1', 'Profile context';
  FOR item IN SELECT value FROM jsonb_array_elements(report->'decks') LOOP
    SELECT to_jsonb(old) INTO original FROM public.get_profile_deck_performance(a) old WHERE old.deck_id=(item->>'deck_id')::uuid;
    ASSERT item-extra=original, 'Existing metrics must match legacy SQL exactly';
  END LOOP;
  BEGIN
    PERFORM public.get_profile_deck_performance_v2(b);
    RAISE EXCEPTION 'Cross-account profile leaked';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.get_global_profile_deck_performance_v2();
    RAISE EXCEPTION 'Member accessed global profile';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM private.profile_catalog_metrics_v2(a,false);
    RAISE EXCEPTION 'Member accessed private profile';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub',b::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  report:=public.get_profile_deck_performance_v2(b);
  ASSERT (report->>'total')::integer=1006 AND jsonb_array_length(report->'decks')=1006, 'Profile must exceed REST 1000 row limit';
  EXECUTE 'RESET ROLE';

  -- Mixed tracking + opponent elimination: first elimination is not computed within one user's rows.
  UPDATE public.matches SET tracking_version=1,duration_seconds=CASE WHEN n%2=0 THEN 60 ELSE 61 END
  FROM qa26_analytics_matches fixture WHERE public.matches.id=fixture.id AND fixture.n<=6;
  UPDATE public.match_participants p SET group_damage_dealt=7,group_damage_events=2,life_damage_dealt=13,
    final_life=5,eliminated_at=CASE WHEN p.user_id=a THEN '2026-01-02'::timestamptz ELSE '2026-01-01'::timestamptz END
  FROM qa26_analytics_matches fixture WHERE p.match_id=fixture.id AND fixture.n<=6;
  UPDATE public.match_participants p SET eliminated_at='2026-01-03'::timestamptz
    FROM qa26_analytics_matches fixture WHERE p.match_id=fixture.id AND fixture.n=1 AND p.user_id IS DISTINCT FROM a;
  UPDATE public.match_participants p SET eliminated_at='2026-01-02'::timestamptz
    FROM qa26_analytics_matches fixture WHERE p.match_id=fixture.id AND fixture.n=2;
  UPDATE public.matches SET tracking_version=1,duration_seconds=CASE WHEN fixture.n=9 THEN 60 ELSE 61 END
    FROM qa26_analytics_matches fixture WHERE public.matches.id=fixture.id AND fixture.n IN (9,21);
  PERFORM set_config('request.jwt.claim.sub',a::text,true);
  report:=public.get_profile_deck_performance_v2(a);
  ASSERT EXISTS(SELECT 1 FROM jsonb_array_elements(report->'decks') value WHERE (value->>'first_eliminations')::integer>0), 'Positive/tied first elimination fixture';
  ASSERT EXISTS(SELECT 1 FROM jsonb_array_elements(report->'decks') value WHERE value->>'deck_id'=(SELECT id::text FROM qa26_analytics_decks WHERE n=1)
    AND (value->>'median_winning_duration_seconds')::integer=61), 'Positive half median rounds like web/native Math.round';
  FOR item IN SELECT value FROM jsonb_array_elements(report->'decks') LOOP
    target:=(item->>'deck_id')::uuid;
    SELECT COALESCE(sum(p.group_damage_dealt) FILTER(WHERE m.tracking_version IS NOT NULL OR m.duration_seconds IS NOT NULL),0)
      INTO expected FROM public.match_participants p JOIN public.matches m ON m.id=p.match_id WHERE p.deck_id=target;
    ASSERT (item->>'group_damage_dealt')::bigint=expected, 'Tracked group damage exact';
    SELECT count(*) INTO expected FROM public.match_participants p WHERE p.deck_id=target AND p.eliminated_at IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM public.match_participants opponent WHERE opponent.match_id=p.match_id AND opponent.eliminated_at<p.eliminated_at);
    ASSERT (item->>'first_eliminations')::bigint=expected, 'First elimination includes all opponents';
    SELECT count(*) INTO expected FROM public.match_participants p JOIN public.matches m ON m.id=p.match_id
      WHERE p.deck_id=target AND p.is_winner AND p.final_life<10;
    ASSERT (item->>'comeback_wins')::bigint=expected, 'Comeback matches arena semantics';
    SELECT count(*) INTO expected FROM public.match_participants p JOIN public.matches m ON m.id=p.match_id
      WHERE p.deck_id=target AND p.is_winner AND m.win_condition='combo';
    ASSERT (item->>'combo_wins')::bigint=expected, 'Combo wins exact';
  END LOOP;

  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    PERFORM public.get_profile_deck_performance_v2(a);
    RAISE EXCEPTION 'Anonymous profile leaked';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  EXECUTE 'RESET ROLE';
  EXECUTE 'SET LOCAL ROLE service_role';
  started:=clock_timestamp(); report:=public.get_global_profile_deck_performance_v2();
  ASSERT report->>'scope'='global' AND report->'userId'='null'::jsonb, 'Service global context';
  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO expected FROM public.decks WHERE group_id IS NULL;
  ASSERT (report->>'total')::bigint=expected AND jsonb_array_length(report->'decks')=expected, 'Complete global catalog';
  RAISE NOTICE 'Profile v2 full catalog %, role/scope/legacy parity/extra metrics PASS; global elapsed % ms',expected,extract(epoch FROM clock_timestamp()-started)*1000;
END;
$profile$;

DO $catalog$
DECLARE
  a uuid:=(SELECT id FROM qa26_analytics_users WHERE n=1);
  b uuid:=(SELECT id FROM qa26_analytics_users WHERE n=2);
  report jsonb; cursor uuid; revision text; ids uuid[]:='{}'; expected uuid[]; item jsonb; original_name text; changed uuid;
  old_ms numeric[]:='{}';new_ms numeric[]:='{}';started timestamptz;iteration integer;legacy jsonb; definition text;plan_line text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub',b::text,true);
  LOOP
    EXECUTE 'SET LOCAL ROLE authenticated';
    report:=public.get_profile_catalog_page_v2(b,cursor,revision,250);
    EXECUTE 'RESET ROLE';
    revision:=report->>'revision';
    ASSERT report->>'scope'='personal' AND report->>'userId'=b::text AND (report->>'total')::integer=1006, 'Catalog context and full total';
    FOR item IN SELECT value FROM jsonb_array_elements(report->'decks') LOOP
      ids:=array_append(ids,(item->>'id')::uuid);
    END LOOP;
    cursor:=(report->>'next')::uuid;
    EXIT WHEN cursor IS NULL;
  END LOOP;
  SELECT array_agg(id ORDER BY id) INTO expected FROM public.decks WHERE user_id=b AND group_id IS NULL;
  ASSERT ids=expected AND cardinality(ids)=1006, 'UUID keyset exact IDs across five pages';
  ASSERT cardinality(ids)=(SELECT count(DISTINCT id) FROM unnest(ids) id), 'No duplicates';
  SELECT id,name INTO changed,original_name FROM public.decks WHERE id=ids[1];
  UPDATE public.decks SET name=name || ' edited' WHERE id=changed;
  BEGIN
    PERFORM public.get_profile_catalog_page_v2(b,ids[250],revision,250);
    RAISE EXCEPTION 'Changed catalog revision accepted';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  UPDATE public.decks SET name=original_name WHERE id=changed;
  BEGIN
    PERFORM public.get_profile_catalog_page_v2(b,ids[250],NULL,250);
    RAISE EXCEPTION 'Cursor without revision accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.get_profile_catalog_page_v2(a);
    RAISE EXCEPTION 'Cross-user catalog accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.get_global_profile_catalog_page_v2();
    RAISE EXCEPTION 'Member global catalog accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  EXECUTE 'RESET ROLE';
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    PERFORM public.get_profile_catalog_page_v2(b);
    RAISE EXCEPTION 'Anonymous catalog accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  EXECUTE 'RESET ROLE';
  EXECUTE 'SET LOCAL ROLE service_role';
  report:=public.get_global_profile_catalog_page_v2();
  EXECUTE 'RESET ROLE';
  ASSERT report->>'scope'='global' AND report->'userId'='null'::jsonb, 'Global catalog service scope';
  ASSERT (report->>'total')::bigint=(SELECT count(*) FROM public.decks WHERE group_id IS NULL), 'Global management retains all owners';
  PERFORM set_config('request.jwt.claim.sub',a::text,true);
  FOR iteration IN 0..10 LOOP
    started:=clock_timestamp();SELECT jsonb_agg(to_jsonb(old)) INTO legacy FROM public.get_profile_deck_performance(a) old;
    IF iteration>0 THEN old_ms:=array_append(old_ms,extract(epoch FROM clock_timestamp()-started)*1000); END IF;
    started:=clock_timestamp();report:=public.get_profile_deck_performance_v2(a);
    IF iteration>0 THEN new_ms:=array_append(new_ms,extract(epoch FROM clock_timestamp()-started)*1000); END IF;
  END LOOP;
  RAISE NOTICE 'Profile metrics old p50=% p95=% ms; rich v2 p50=% p95=% ms',
    (SELECT percentile_cont(0.5) WITHIN GROUP(ORDER BY x) FROM unnest(old_ms) x),
    (SELECT percentile_cont(0.95) WITHIN GROUP(ORDER BY x) FROM unnest(old_ms) x),
    (SELECT percentile_cont(0.5) WITHIN GROUP(ORDER BY x) FROM unnest(new_ms) x),
    (SELECT percentile_cont(0.95) WITHIN GROUP(ORDER BY x) FROM unnest(new_ms) x);
  RAISE NOTICE 'Catalog v2 1006 exact IDs, concurrent mutation/roles PASS';
  SELECT prosrc INTO definition FROM pg_proc WHERE oid='private.profile_catalog_metrics_v2(uuid,boolean)'::regprocedure;
  definition:=replace(replace(definition,'p_user_id',quote_literal(a)||'::uuid'),'p_global','false');
  FOR plan_line IN EXECUTE 'EXPLAIN (ANALYZE,BUFFERS) ' || definition LOOP
    RAISE NOTICE 'Profile plan %',plan_line;
  END LOOP;
END;
$catalog$;
