
-- 1. verification_codes: remove user UPDATE/SELECT/INSERT/DELETE; only service role manages
DROP POLICY IF EXISTS "Users can update their own verification codes" ON public.verification_codes;
DROP POLICY IF EXISTS "Users can insert their own verification codes" ON public.verification_codes;
DROP POLICY IF EXISTS "Users can delete their own verification codes" ON public.verification_codes;
DROP POLICY IF EXISTS "Users can view their own verification codes" ON public.verification_codes;
REVOKE ALL ON public.verification_codes FROM anon, authenticated;
GRANT ALL ON public.verification_codes TO service_role;

-- 2. Realtime channel authorization: only allow subscribing to topics scoped to your own uid,
--    or admin topics for admins.
DROP POLICY IF EXISTS "Authenticated users own-topic realtime" ON realtime.messages;
DROP POLICY IF EXISTS "Admins all-topic realtime" ON realtime.messages;

CREATE POLICY "Authenticated users own-topic realtime"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  (realtime.topic())::text = ('user:' || (auth.uid())::text)
);

CREATE POLICY "Admins all-topic realtime"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::public.app_role)
);

-- 3. user_roles: explicit deny for writes by normal users
DROP POLICY IF EXISTS "No self role assignment" ON public.user_roles;
CREATE POLICY "No self role assignment"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (false);

DROP POLICY IF EXISTS "No self role update" ON public.user_roles;
CREATE POLICY "No self role update"
ON public.user_roles
FOR UPDATE
TO authenticated
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS "No self role delete" ON public.user_roles;
CREATE POLICY "No self role delete"
ON public.user_roles
FOR DELETE
TO authenticated
USING (false);

-- 4. Revoke direct execute on internal SECURITY DEFINER functions.
--    RLS policies that reference has_role still work because policy evaluation runs as
--    the policy owner, but anon/authenticated cannot call it directly via the API.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
