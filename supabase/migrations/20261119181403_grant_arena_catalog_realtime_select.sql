-- Self-hosted Realtime requires a table grant in addition to its membership RLS.
-- The catalog clients receive server broadcasts; they do not publish messages.
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'realtime.messages'::regclass AND relrowsecurity
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'realtime' AND tablename = 'messages'
      AND policyname = 'arena_catalog_broadcast_select' AND cmd = 'SELECT'
      AND 'authenticated'::name = ANY (roles)
      AND qual LIKE '%is_group_member%' AND qual LIKE '%realtime.topic()%'
  ) THEN
    RAISE EXCEPTION 'Arena membership RLS must be installed and enabled before granting catalog reads';
  END IF;
END;
$guard$;

GRANT SELECT ON TABLE realtime.messages TO authenticated;
