-- ============================================================
-- App montre — interrupteur global « connexion des montres ».
--
-- ORDRE D'APPLICATION : après watch_pairing.sql, watch_input_device.sql et
-- watch_rpcs.sql. Puis RÉ-APPLIQUER watch_pairing.sql et watch_rpcs.sql,
-- qui consultent désormais `fn_watch_enabled()`.
--
-- But : pouvoir couper la fonctionnalité montre en production, pour TOUT le
-- monde, sans publier de mise à jour — y compris pour les montres DÉJÀ
-- appairées. Le blocage est côté serveur, donc il agit même sur une montre
-- dont l'app n'a pas été réinstallée.
--
-- ⚠️ Ce réglage ne remplace PAS `revoke_watch_link` : celui-ci délie UNE
-- montre (perte, vol), celui-là coupe la fonctionnalité pour tous.
-- ============================================================
BEGIN;

-- Défaut `true` : la fonctionnalité tourne déjà, l'ajout du réglage ne doit
-- rien interrompre.
INSERT INTO public.app_config (key, value) VALUES ('watch_pairing_enabled', 'true')
ON CONFLICT (key) DO NOTHING;

-- Clé absente = activé, pour ne jamais couper par accident si la ligne
-- disparaît ou si la migration est appliquée à moitié.
CREATE OR REPLACE FUNCTION public.fn_watch_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT value FROM public.app_config WHERE key = 'watch_pairing_enabled'), 'true') <> 'false';
$$;

-- Helper interne : appelé UNIQUEMENT depuis les RPC montre, elles-mêmes
-- SECURITY DEFINER. Jamais exposé (cf. le piège des droits par défaut Supabase
-- documenté dans watch_rpcs.sql).
REVOKE ALL ON FUNCTION public.fn_watch_enabled() FROM PUBLIC, anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
