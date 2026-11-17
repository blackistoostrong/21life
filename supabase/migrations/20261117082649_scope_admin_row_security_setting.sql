-- is_admin's legacy SET LOCAL currently leaks into its calling transaction.
-- A function-level setting scopes that existing command and restores the
-- caller's value on return. Preserve body, owner, search_path and ACLs.
ALTER FUNCTION public.is_admin(uuid) SET row_security = off;
