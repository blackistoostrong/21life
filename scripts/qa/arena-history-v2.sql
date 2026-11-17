-- Appended to the disposable analytics/profile transaction, before ROLLBACK.
DO $history$
DECLARE
  a uuid:=(SELECT id FROM qa26_analytics_users WHERE n=1);
  b uuid:=(SELECT id FROM qa26_analytics_users WHERE n=2);
  group_a uuid:=(SELECT id FROM qa26_analytics_groups WHERE n=1);
  group_b uuid:=(SELECT id FROM qa26_analytics_groups WHERE n=2);
  result jsonb; last_result jsonb; next_cursor jsonb; revision text; ids uuid[]:='{}'; expected uuid[];
  item jsonb; total bigint; iterations integer:=0; sample_start timestamptz; legacy jsonb; original_time timestamptz; target uuid;
  started timestamptz;old_ms numeric[]:='{}';new_ms numeric[]:='{}';
BEGIN
  PERFORM set_config('request.jwt.claim.sub',a::text,true);
  target:=(SELECT id FROM qa26_analytics_matches WHERE n=11);
  SELECT played_at INTO original_time FROM public.matches WHERE id=target;
  UPDATE public.matches SET played_at=NULL WHERE id=target;
  LOOP
    EXECUTE 'SET LOCAL ROLE authenticated';
    result:=public.get_arena_history_page_v2(group_a,100,(next_cursor->>'playedAt')::timestamptz,(next_cursor->>'id')::uuid,revision);
    EXECUTE 'RESET ROLE';
    ASSERT result->>'schemaVersion'='2' AND (result->>'complete')::boolean AND result->>'groupId'=group_a::text, 'History page context';
    ASSERT jsonb_array_length(result->'matches')<=100, 'Bounded history cards';
    revision:=result->>'revision';
    FOR item IN SELECT value FROM jsonb_array_elements(result->'matches') LOOP
      ids:=array_append(ids,(item->>'id')::uuid);
      ASSERT item->>'group_id'=group_a::text AND jsonb_typeof(item->'match_participants')='array', 'Nested history shape';
    END LOOP;
    next_cursor:=NULLIF(result->'next','null'::jsonb);
    iterations:=iterations+1;
    ASSERT iterations<100, 'Pagination must terminate';
    EXIT WHEN next_cursor IS NULL;
  END LOOP;
  SELECT array_agg(id ORDER BY played_at DESC NULLS LAST,id DESC),count(*) INTO expected,total FROM public.matches WHERE group_id=group_a;
  ASSERT ids=expected AND cardinality(ids)>1000 AND (result->>'total')::bigint=total, 'Exact history beyond REST cap, ties and null tail';
  ASSERT cardinality(ids)=(SELECT count(DISTINCT id) FROM unnest(ids) id), 'No duplicate history IDs';
  ASSERT result->'matches'->-1->>'arena_day_key'='undated', 'Null chronology is explicit and ordered last';
  EXECUTE 'SET LOCAL TIME ZONE ''Pacific/Auckland''';
  result:=public.get_arena_history_page_v2(group_a,100,NULL,NULL,revision);
  EXECUTE 'SET LOCAL TIME ZONE ''UTC''';
  ASSERT result->>'revision'=revision, 'Ordering revision independent of session timezone';
  UPDATE public.matches SET played_at=original_time WHERE id=target;
  BEGIN
    PERFORM public.get_arena_history_page_v2(group_a,100,NULL,NULL,revision);
    RAISE EXCEPTION 'Concurrent re-dating accepted';
  EXCEPTION WHEN serialization_failure THEN NULL; END;

  SELECT date_trunc('day',played_at) INTO sample_start FROM public.matches WHERE id=(SELECT id FROM qa26_analytics_matches WHERE n=3);
  legacy:=public.get_arena_matches_for_day(group_a,sample_start,sample_start+interval '1 day');
  result:=public.get_arena_history_page_v2(group_a,100,NULL,NULL,NULL,sample_start,sample_start+interval '1 day');
  ASSERT (result->>'total')::integer=jsonb_array_length(legacy), 'Exact period total and exclusive upper boundary';
  FOR item IN SELECT value FROM jsonb_array_elements(result->'matches') LOOP
    ASSERT EXISTS(SELECT 1 FROM jsonb_array_elements(legacy) old WHERE old->>'id'=item->>'id' AND old=item-'arena_day_key'), 'Legacy nested snapshots/guest/deck shape preserved';
  END LOOP;
  FOR iterations IN 0..10 LOOP
    started:=clock_timestamp();legacy:=public.get_arena_matches_for_day(group_a,sample_start,sample_start+interval '1 day');
    IF iterations>0 THEN old_ms:=array_append(old_ms,extract(epoch FROM clock_timestamp()-started)*1000); END IF;
    started:=clock_timestamp();result:=public.get_arena_history_page_v2(group_a,100,NULL,NULL,NULL,sample_start,sample_start+interval '1 day');
    IF iterations>0 THEN new_ms:=array_append(new_ms,extract(epoch FROM clock_timestamp()-started)*1000); END IF;
  END LOOP;
  RAISE NOTICE 'History identical period/cards old p50=% p95=% ms; v2 p50=% p95=% ms; old/new bytes=%/%',
    (SELECT percentile_cont(0.5) WITHIN GROUP(ORDER BY x) FROM unnest(old_ms)x),
    (SELECT percentile_cont(0.95) WITHIN GROUP(ORDER BY x) FROM unnest(old_ms)x),
    (SELECT percentile_cont(0.5) WITHIN GROUP(ORDER BY x) FROM unnest(new_ms)x),
    (SELECT percentile_cont(0.95) WITHIN GROUP(ORDER BY x) FROM unnest(new_ms)x),octet_length(legacy::text),octet_length(result::text);
  FOR iterations IN 0..1 LOOP
    BEGIN
      PERFORM public.get_arena_history_page_v2(group_a,CASE WHEN iterations=0 THEN 0 ELSE 101 END);
      RAISE EXCEPTION 'Invalid page limit accepted';
    EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  END LOOP;
  BEGIN
    PERFORM public.get_arena_history_page_v2(group_a,100,NULL,target);
    RAISE EXCEPTION 'Unversioned history cursor accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub',b::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.get_arena_history_page_v2(group_b);
    RAISE EXCEPTION 'Cross-group history leaked';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.get_arena_match_day_summaries_v2(group_b);
    RAISE EXCEPTION 'Cross-group summaries leaked';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM private.arena_history_cards_v2(ids,8);
    RAISE EXCEPTION 'Private serializer exposed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  EXECUTE 'RESET ROLE';
  INSERT INTO public.platform_admin_emails(email) SELECT email FROM qa26_analytics_users WHERE n=2 ON CONFLICT DO NOTHING;
  EXECUTE 'SET LOCAL ROLE authenticated';
  ASSERT (public.get_arena_history_page_v2(group_b)->>'total')::integer>0, 'Actual admin can read another group';
  EXECUTE 'RESET ROLE';
  DELETE FROM public.platform_admin_emails WHERE email=(SELECT email FROM qa26_analytics_users WHERE n=2);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    PERFORM public.get_arena_history_page_v2(group_a);
    RAISE EXCEPTION 'Anonymous history leaked';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  EXECUTE 'RESET ROLE';
  EXECUTE 'SET LOCAL ROLE service_role';
  BEGIN
    PERFORM public.get_arena_history_page_v2(group_a);
    RAISE EXCEPTION 'Userless service history exposed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  EXECUTE 'RESET ROLE';
  RAISE NOTICE 'History v2: % exact scoped matches through % pages; ordering, null tail, snapshots, period, roles and concurrent re-dating PASS',total,cardinality(ids)/100+1;
END;
$history$;

CREATE TEMP TABLE qa26_history_day_group(id uuid) ON COMMIT DROP;
DO $day_semantics$
DECLARE
  a uuid:=(SELECT id FROM qa26_analytics_users WHERE n=1);
  group_a uuid:=(SELECT id FROM qa26_analytics_groups WHERE n=1);
  day_group uuid:=gen_random_uuid(); result jsonb; original_revision text;guest uuid:=gen_random_uuid();guest_deck uuid:=gen_random_uuid();
BEGIN
  PERFORM set_config('request.jwt.claim.sub',a::text,true);
  original_revision:=public.get_arena_history_page_v2(group_a)->>'revision';
  INSERT INTO public.matches(id,group_id,created_by,played_at,is_draw)
    SELECT gen_random_uuid(),group_a,a,'2000-01-01 12:00:00+00'::timestamptz+n*interval '2 days',true FROM generate_series(1,1005)n;
  BEGIN
    PERFORM public.get_arena_history_page_v2(group_a,100,NULL,NULL,original_revision);
    RAISE EXCEPTION 'Concurrent insertion accepted';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  result:=public.get_arena_match_day_summaries_v2(group_a);
  ASSERT (result->>'totalDays')::integer>1000 AND jsonb_array_length(result->'days')=(result->>'totalDays')::integer, 'Complete day summaries beyond API cap';
  ASSERT (SELECT sum((day->>'matchCount')::integer) FROM jsonb_array_elements(result->'days')day)=(SELECT count(*) FROM public.matches WHERE group_id=group_a), 'Every historical day counted';
  INSERT INTO public.groups(id,name,created_by) VALUES(day_group,'DEV26 history day fixture',a);
  INSERT INTO public.group_members(group_id,user_id) VALUES(day_group,a) ON CONFLICT DO NOTHING;
  INSERT INTO qa26_history_day_group VALUES(day_group);
  INSERT INTO public.matches(id,group_id,created_by,played_at,is_draw) VALUES
    (gen_random_uuid(),day_group,a,'2010-01-01 21:00:00+00',true),
    (gen_random_uuid(),day_group,a,'2010-01-02 01:00:00+00',true),
    (gen_random_uuid(),day_group,a,'2010-01-05 01:00:00+00',true),
    (gen_random_uuid(),day_group,a,NULL,true);
  INSERT INTO public.match_participants(match_id,user_id,deck_id,is_winner)
    SELECT (SELECT id FROM public.matches WHERE group_id=day_group AND played_at IS NOT NULL ORDER BY played_at LIMIT 1),a,
      (SELECT id FROM qa26_analytics_decks WHERE n=1),false;
  INSERT INTO public.arena_guests(id,group_id,display_name,normalized_name) VALUES(guest,day_group,'DEV26 history guest','dev26 history guest');
  INSERT INTO public.arena_guest_decks(id,guest_id,group_id,name,commander,color_identity,bracket)
    VALUES(guest_deck,guest,day_group,'DEV26 history guest deck','DEV26 history guest commander',ARRAY['C'],'2');
  INSERT INTO public.match_participants(match_id,guest_id,guest_deck_id,is_winner)
    SELECT id,guest,guest_deck,false FROM public.matches WHERE group_id=day_group AND played_at IS NOT NULL ORDER BY played_at LIMIT 1;
  result:=public.get_arena_history_page_v2(day_group,p_day_key=>'2010-01-01');
  ASSERT (result->>'total')::integer=2 AND jsonb_array_length(result->'matches')=2, 'Late match shifts when previous calendar day exists';
  result:=public.get_arena_history_page_v2(day_group,p_day_key=>'2010-01-05');
  ASSERT (result->>'total')::integer=1, 'Isolated late match remains on its calendar day';
  result:=public.get_arena_history_page_v2(day_group,p_day_key=>'undated');
  ASSERT (result->>'total')::integer=1, 'Unknown chronology remains accessible';
  result:=public.get_arena_match_day_summaries_v2(day_group);
  ASSERT (result->>'totalDays')::integer=3, 'Conditional UTC days and undated summary';
  RAISE NOTICE 'History v2 conditional UTC grouping and 1000+ day summaries PASS';
END;
$day_semantics$;
DO $revision_writes$
DECLARE
  a uuid:=(SELECT id FROM qa26_analytics_users WHERE n=1);
  b uuid:=(SELECT id FROM qa26_analytics_users WHERE n=2);
  group_a uuid:=(SELECT id FROM qa26_analytics_groups WHERE n=1);
  test_group uuid:=gen_random_uuid(); first_match uuid:=gen_random_uuid();second_match uuid:=gen_random_uuid();
  owned_deck uuid:=(SELECT id FROM qa26_analytics_decks WHERE n=1);
  before_revision bigint;original_revision text;denied_count bigint;
BEGIN
  -- Start like the API with RLS enabled. Admin lookup must preserve this
  -- through all following statements; do not reset it between writes.
  PERFORM set_config('row_security','on',true);
  PERFORM set_config('request.jwt.claim.sub',a::text,true);
  INSERT INTO public.groups(id,name,created_by) VALUES(test_group,'DEV26 history revision writes',a);
  INSERT INTO public.group_members(group_id,user_id) VALUES(test_group,a) ON CONFLICT DO NOTHING;
  EXECUTE 'SET LOCAL ROLE authenticated';
  INSERT INTO public.matches(id,group_id,created_by,played_at,is_draw) VALUES
    (first_match,test_group,a,'2011-01-01T12:00:00Z',true),(second_match,test_group,a,'2011-01-02T12:00:00Z',true);
  BEGIN
    SELECT count(*) INTO denied_count FROM private.arena_history_revisions;
    RAISE EXCEPTION 'Private history revision table exposed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  EXECUTE 'RESET ROLE';
  SELECT revision INTO before_revision FROM private.arena_history_revisions WHERE group_id=test_group;
  ASSERT before_revision=1, 'Batch inserts increment once per group/statement';
  EXECUTE 'SET LOCAL ROLE authenticated';
  INSERT INTO public.match_participants(match_id,user_id,deck_id,is_winner)
    SELECT match.id,a,owned_deck,false FROM public.matches match WHERE match.group_id=test_group;
  EXECUTE 'RESET ROLE';
  ASSERT (SELECT revision FROM private.arena_history_revisions WHERE group_id=test_group)=before_revision+1, 'Participant batch increments once';
  before_revision:=before_revision+1;
  original_revision:=public.get_arena_history_page_v2(test_group)->>'revision';
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE public.match_participants SET life_lost=life_lost+1 WHERE match_id IN (first_match,second_match);
  EXECUTE 'RESET ROLE';
  ASSERT (SELECT revision FROM private.arena_history_revisions WHERE group_id=test_group)=before_revision+1, 'Participant correction invalidates history';
  BEGIN
    PERFORM public.get_arena_history_page_v2(test_group,p_revision=>original_revision);
    RAISE EXCEPTION 'Concurrent participant correction accepted';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE public.matches SET notes='DEV26 corrected' WHERE group_id=test_group;
  DELETE FROM public.matches WHERE id=first_match;
  DELETE FROM public.groups WHERE id=test_group;
  EXECUTE 'RESET ROLE';
  ASSERT NOT EXISTS(SELECT 1 FROM public.matches WHERE group_id=test_group), 'Group delete cascades historical matches';
  ASSERT NOT EXISTS(SELECT 1 FROM private.arena_history_revisions WHERE group_id=test_group), 'Group delete removes revision without FK errors';

  original_revision:=public.get_arena_history_page_v2(group_a)->>'revision';
  DELETE FROM public.group_members WHERE group_id=group_a AND user_id=b;
  PERFORM set_config('request.jwt.claim.sub',b::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.get_arena_history_page_v2(group_a,p_revision=>original_revision);
    RAISE EXCEPTION 'Revoked member retained access';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub',a::text,true);
  INSERT INTO public.group_members(group_id,user_id) VALUES(group_a,b) ON CONFLICT DO NOTHING;
  RAISE NOTICE 'History revision authenticated batch writes, participant correction, membership revocation and group-delete cascades PASS';
END;
$revision_writes$;
SELECT 'QA26_HISTORY_PAYLOAD=' || jsonb_build_object('page',public.get_arena_history_page_v2((SELECT id FROM qa26_history_day_group)),
  'summary',public.get_arena_match_day_summaries_v2((SELECT id FROM qa26_history_day_group)))::text;
EXPLAIN (ANALYZE,BUFFERS) SELECT public.get_arena_history_page_v2((SELECT id FROM qa26_analytics_groups WHERE n=1));
