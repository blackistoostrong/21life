-- Read-only directory for the web admin API. Never callable by browser roles.
CREATE FUNCTION public.admin_user_directory_v1(
  p_search text DEFAULT '', p_status text DEFAULT 'all', p_activity text DEFAULT 'all',
  p_source text DEFAULT 'all', p_from date DEFAULT NULL, p_to date DEFAULT NULL,
  p_sort text DEFAULT 'newest', p_page integer DEFAULT 1, p_page_size integer DEFAULT 25
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  result jsonb;
  as_of timestamptz := now();
BEGIN
  IF p_search IS NULL OR length(p_search)>100
    OR p_status IS NULL OR p_status NOT IN ('all','confirmed','unconfirmed')
    OR p_activity IS NULL OR p_activity NOT IN ('all','7d','30d','inactive','no_logs')
    OR p_source IS NULL OR p_source NOT IN ('all','web','app')
    OR p_sort IS NULL OR p_sort NOT IN ('newest','oldest','active','games')
    OR p_page IS NULL OR p_page<1 OR p_page>100000
    OR p_page_size IS NULL OR p_page_size<1 OR p_page_size>5001
    OR (p_from IS NOT NULL AND p_to IS NOT NULL AND p_from>p_to)
  THEN RAISE EXCEPTION 'Invalid directory filters' USING ERRCODE='22023'; END IF;

  WITH base AS MATERIALIZED (
    SELECT u.id, u.email, u.created_at, u.last_sign_in_at,
      u.email_confirmed_at IS NOT NULL AS confirmed,
      p.username, p.display_name, a.accessed_at AS last_active_at,
      a.source, CASE WHEN a.source='app' THEN a.app_version END AS app_version
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id=u.id
    LEFT JOIN LATERAL (
      SELECT l.accessed_at,l.source,l.app_version FROM public.access_logs l
      WHERE l.user_id=u.id AND l.accessed_at>=as_of-interval '30 days' AND l.accessed_at<=as_of
      ORDER BY l.accessed_at DESC,l.id DESC LIMIT 1
    ) a ON true
    WHERE u.deleted_at IS NULL AND NOT coalesce(u.is_anonymous,false)
  ), filtered AS MATERIALIZED (
    SELECT b.* FROM base b WHERE
      (btrim(p_search)='' OR position(lower(btrim(p_search)) IN lower(concat_ws(' ',b.username,b.display_name,b.email)))>0)
      AND (p_status='all' OR (p_status='confirmed' AND b.confirmed) OR (p_status='unconfirmed' AND NOT b.confirmed))
      AND (p_from IS NULL OR b.created_at >= (p_from::timestamp AT TIME ZONE 'UTC'))
      AND (p_to IS NULL OR b.created_at < ((p_to+1)::timestamp AT TIME ZONE 'UTC'))
      AND (p_activity='all'
        OR (p_activity='7d' AND b.last_active_at>=as_of-interval '7 days')
        OR (p_activity='30d' AND b.last_active_at IS NOT NULL)
        OR (p_activity='inactive' AND (b.last_active_at IS NULL OR b.last_active_at<as_of-interval '7 days'))
        OR (p_activity='no_logs' AND b.last_active_at IS NULL))
      AND (p_source='all' OR EXISTS(SELECT 1 FROM public.access_logs l WHERE l.user_id=b.id
        AND l.source=p_source AND l.accessed_at>=as_of-interval '30 days' AND l.accessed_at<=as_of))
  ), ranked AS (
    SELECT f.*,row_number() OVER (ORDER BY
      CASE WHEN p_sort='newest' THEN f.created_at END DESC,
      CASE WHEN p_sort='oldest' THEN f.created_at END ASC,
      CASE WHEN p_sort='active' THEN f.last_active_at END DESC NULLS LAST,
      CASE WHEN p_sort='games' THEN (SELECT count(*) FROM public.match_participants mp WHERE mp.user_id=f.id) END DESC,
      f.id ASC) AS position
    FROM filtered f
  ), page AS (
    SELECT * FROM ranked ORDER BY position
    LIMIT p_page_size OFFSET ((p_page::bigint-1)*p_page_size)
  )
  SELECT jsonb_build_object(
    'schemaVersion',1,'asOf',as_of,'retentionDays',30,'page',p_page,'pageSize',p_page_size,
    'population',(SELECT count(*) FROM base),'total',(SELECT count(*) FROM filtered),
    'summary',(SELECT jsonb_build_object(
      'registered',count(*),'confirmed',count(*) FILTER(WHERE confirmed),
      'unconfirmed',count(*) FILTER(WHERE NOT confirmed),
      'active7d',count(*) FILTER(WHERE last_active_at>=as_of-interval '7 days'),
      'active30d',count(*) FILTER(WHERE last_active_at IS NOT NULL),
      'new7d',count(*) FILTER(WHERE created_at>=as_of-interval '7 days')) FROM filtered),
    'users',(SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id',r.id,'username',r.username,'displayName',r.display_name,'email',r.email,
      'confirmed',r.confirmed,'createdAt',r.created_at,'lastSignInAt',r.last_sign_in_at,
      'lastActiveAt',r.last_active_at,'source',r.source,'appVersion',r.app_version,
      'games',(SELECT count(*) FROM public.match_participants mp WHERE mp.user_id=r.id),
      'decks',(SELECT count(*) FROM public.decks d WHERE d.user_id=r.id AND d.group_id IS NULL),
      'groups',(SELECT count(*) FROM public.group_members gm WHERE gm.user_id=r.id)
    ) ORDER BY r.position),'[]'::jsonb) FROM page r)
  ) INTO result;
  RETURN result;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_user_directory_v1(text,text,text,text,date,date,text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_user_directory_v1(text,text,text,text,date,date,text,integer,integer) TO service_role;
