-- Interrupteur global des tournois.
-- Meme motif que watch_feature_flag.sql, avec UNE difference volontaire :
-- ici, cle absente = DESACTIVE. La fonctionnalite est neuve, donc le
-- deploiement doit etre sur par defaut ; on l allume quand on le decide.
BEGIN;

INSERT INTO public.app_config (key, value) VALUES ('tournaments_enabled', 'false')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_tournaments_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT value FROM public.app_config WHERE key = 'tournaments_enabled'), 'false') = 'true';
$$;

-- Piege des droits Supabase : REVOKE ... FROM PUBLIC ne retire PAS les droits
-- directs de anon et authenticated. Il faut les nommer.
REVOKE ALL ON FUNCTION public.fn_tournaments_enabled() FROM PUBLIC, anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
