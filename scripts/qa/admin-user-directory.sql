-- Dev/disposable CI only. Fixtures are rolled back, never committed.
\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE dev26_admin_fixture(n integer PRIMARY KEY,id uuid NOT NULL,tag text NOT NULL) ON COMMIT DROP;
INSERT INTO dev26_admin_fixture
SELECT n,gen_random_uuid(),'qa26_'||substr(md5(gen_random_uuid()::text),1,8)||'_' FROM generate_series(1,1005) n;
UPDATE dev26_admin_fixture SET tag=(SELECT tag FROM dev26_admin_fixture WHERE n=1);
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,created_at,updated_at,last_sign_in_at)
SELECT id,'authenticated','authenticated',tag||lpad(n::text,4,'0')||'@example.com',
 CASE WHEN n%2=0 THEN now() END,jsonb_build_object('username',tag||lpad(n::text,4,'0')),
 '{"provider":"email","providers":["email"]}'::jsonb,now()-make_interval(days=>n%40),now(),now()
FROM dev26_admin_fixture;
INSERT INTO public.access_logs(user_id,source,app_version,accessed_at)
SELECT id,CASE WHEN n%2=0 THEN 'app' ELSE 'web' END,CASE WHEN n%2=0 THEN '9.3.0' END,now()-make_interval(days=>n)
FROM dev26_admin_fixture WHERE n<=21;
UPDATE public.access_logs SET accessed_at=now()-interval '31 days'
WHERE user_id=(SELECT id FROM dev26_admin_fixture WHERE n=21);
INSERT INTO public.access_logs(user_id,source,app_version,accessed_at)
SELECT id,'app','9.3.0',now()-interval '1 day' FROM dev26_admin_fixture WHERE n=3;
DO $test$
DECLARE
  tag text := (SELECT f.tag FROM dev26_admin_fixture f WHERE n=1);
  first_id uuid := (SELECT id FROM dev26_admin_fixture WHERE n=1);
  group_id uuid := gen_random_uuid(); deck_id uuid := gen_random_uuid(); match_id uuid := gen_random_uuid();
  result jsonb; second_page jsonb; expected integer; started timestamptz; elapsed numeric;
BEGIN
  INSERT INTO public.groups(id,name,created_by) VALUES(group_id,'Dev26 directory fixture',first_id);
  INSERT INTO public.group_members(group_id,user_id) VALUES(group_id,first_id) ON CONFLICT DO NOTHING;
  INSERT INTO public.decks(id,user_id,name,commander,is_archived) VALUES(deck_id,first_id,'QA archived deck','QA commander',true);
  INSERT INTO public.matches(id,group_id,winner_id,created_by) VALUES(match_id,group_id,first_id,first_id);
  INSERT INTO public.match_participants(match_id,user_id,deck_id,is_winner) VALUES(match_id,first_id,deck_id,true);
  started := clock_timestamp();
  result := public.admin_user_directory_v1(p_search=>upper(tag),p_page_size=>25);
  elapsed := extract(epoch FROM clock_timestamp()-started)*1000;
  ASSERT (result->>'total')::integer=1005, 'Directory truncated above API cap';
  ASSERT jsonb_array_length(result->'users')=25, 'Page size mismatch';
  ASSERT (result->'summary'->>'confirmed')::integer=502, 'Confirmation aggregate mismatch';
  ASSERT (result->'summary'->>'active7d')::integer=7, 'Activity aggregate mismatch';
  ASSERT (result->'summary'->>'active30d')::integer=20, 'Retention aggregate mismatch';
  second_page := public.admin_user_directory_v1(p_search=>tag,p_page=>2,p_page_size=>25);
  ASSERT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(result->'users') a
    JOIN jsonb_array_elements(second_page->'users') b ON a->>'id'=b->>'id'), 'Pages overlap';
  result := public.admin_user_directory_v1(p_search=>tag,p_status=>'unconfirmed');
  ASSERT (result->>'total')::integer=503, 'Unconfirmed filter mismatch';
  result := public.admin_user_directory_v1(p_search=>tag,p_activity=>'no_logs');
  ASSERT (result->>'total')::integer=985, 'No-log filter mismatch';
  result := public.admin_user_directory_v1(p_search=>tag,p_activity=>'inactive');
  ASSERT (result->>'total')::integer=998, 'Inactive 7-day filter mismatch';
  result := public.admin_user_directory_v1(p_search=>tag,p_source=>'app');
  ASSERT (result->>'total')::integer=11, 'Source must match any retained log';
  result := public.admin_user_directory_v1(p_search=>tag,p_source=>'web');
  ASSERT (result->>'total')::integer=10, 'Web filter mismatch';
  result := public.admin_user_directory_v1(p_search=>tag||'0001',p_sort=>'games');
  ASSERT (result->>'total')::integer=1, 'Literal search mismatch';
  ASSERT (result->'users'->0->>'games')::integer=1, 'Games count mismatch';
  ASSERT (result->'users'->0->>'decks')::integer=1, 'Archived personal decks must count';
  ASSERT (result->'users'->0->>'groups')::integer=1, 'Membership count mismatch';
  result := public.admin_user_directory_v1(p_search=>tag,p_from=>(now() AT TIME ZONE 'UTC')::date-3,p_to=>(now() AT TIME ZONE 'UTC')::date-1);
  SELECT count(*) INTO expected FROM auth.users u JOIN dev26_admin_fixture f ON f.id=u.id
    WHERE u.created_at>=(((now() AT TIME ZONE 'UTC')::date-3)::timestamp AT TIME ZONE 'UTC')
    AND u.created_at<(((now() AT TIME ZONE 'UTC')::date)::timestamp AT TIME ZONE 'UTC');
  ASSERT (result->>'total')::integer=expected, 'UTC date bounds mismatch';
  result := public.admin_user_directory_v1(p_search=>tag,p_page_size=>5001);
  ASSERT jsonb_array_length(result->'users')=1005, 'Export is incomplete';
  result := public.admin_user_directory_v1(p_search=>tag||'%');
  ASSERT (result->>'total')::integer=0, 'Search wildcard must be literal';
  BEGIN
    PERFORM public.admin_user_directory_v1(p_page_size=>5002);
    RAISE EXCEPTION 'Invalid SQL arguments accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    EXECUTE 'SET LOCAL ROLE anon';
    PERFORM public.admin_user_directory_v1();
    RAISE EXCEPTION 'Anonymous RPC access unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM public.admin_user_directory_v1();
    RAISE EXCEPTION 'Member RPC access unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  EXECUTE 'SET LOCAL ROLE service_role';
  result := public.admin_user_directory_v1(p_search=>tag);
  ASSERT (result->>'total')::integer=1005, 'Service RPC access failed';
  EXECUTE 'RESET ROLE';
  RAISE NOTICE 'Admin directory: 1005 fixtures, filters/counts/pages/export/roles PASS; first query % ms',round(elapsed,2);
END $test$;
ROLLBACK;
