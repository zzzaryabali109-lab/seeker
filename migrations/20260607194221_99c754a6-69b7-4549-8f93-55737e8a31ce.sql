-- Lock down verification_codes: deny all client access (only service_role uses it via edge functions)
REVOKE ALL ON public.verification_codes FROM anon, authenticated;

CREATE POLICY "No client access to verification_codes"
ON public.verification_codes
FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);

-- Restrict SECURITY DEFINER functions: revoke public/anon execute, allow only authenticated
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
