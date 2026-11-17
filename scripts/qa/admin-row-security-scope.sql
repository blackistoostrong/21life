-- Synthetic fixture transaction only. Never disable RLS for ordinary writes.
DO $admin_scope$
DECLARE
  a uuid:=(SELECT id FROM qa26_analytics_users WHERE n=1);
  original_setting text:=current_setting('row_security');
BEGIN
  PERFORM set_config('request.jwt.claim.sub',a::text,true);
  PERFORM set_config('row_security','on',true);
  ASSERT NOT public.is_admin(a), 'Synthetic ordinary user must not be admin';
  ASSERT current_setting('row_security')='on', 'Admin lookup changed caller row_security';
  ASSERT NOT public.is_admin(NULL), 'Null admin target';
  ASSERT current_setting('row_security')='on', 'Null admin lookup changed caller row_security';
  INSERT INTO public.platform_admin_emails(email) SELECT email FROM qa26_analytics_users WHERE n=1 ON CONFLICT DO NOTHING;
  EXECUTE 'SET LOCAL ROLE authenticated';
  ASSERT public.is_admin(), 'Allowlisted authenticated admin';
  ASSERT current_setting('row_security')='on', 'Authenticated admin lookup changed caller row_security';
  EXECUTE 'RESET ROLE';
  DELETE FROM public.platform_admin_emails WHERE email=(SELECT email FROM qa26_analytics_users WHERE n=1);
  PERFORM set_config('row_security','off',true);
  ASSERT NOT public.is_admin(a), 'Ordinary user after allowlist removal';
  ASSERT current_setting('row_security')='off', 'Caller off setting must also be restored';
  PERFORM set_config('row_security',original_setting,true);
  RAISE NOTICE 'Admin lookup restores caller RLS setting for member/admin/null/on/off PASS';
END;
$admin_scope$;
