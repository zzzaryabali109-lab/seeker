
-- Update handle_new_user to also auto-grant admin role to ALI786
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email)
  VALUES (NEW.id, NEW.email);

  IF NEW.email IS NOT NULL
     AND lower(split_part(NEW.email, '@', 1)) = 'ali786' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- Back-fill: if ALI786 already exists, grant admin now
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role
FROM auth.users
WHERE lower(split_part(email, '@', 1)) = 'ali786'
ON CONFLICT (user_id, role) DO NOTHING;
