-- ============================================================
-- Ecran « Ma montre » — ce que la fiche d'un appareil doit dire.
-- Implemente design_handoff_panel_arbitre, ecran montre.
--
-- ORDRE D'APPLICATION - il n'y a pas de runner, un humain applique a la main :
--    watch_pairing.sql -> watch_input_device.sql -> watch_rpcs.sql -> CE FICHIER
-- Il lit public.live_match_events(watch_link_id), colonne ajoutee par
-- watch_input_device.sql. Applique avant, il echoue.
--
-- Deux manques, tous deux additifs :
--
-- 1. list_watch_links ne renvoyait que le nom et la derniere vue. On ne
--    pouvait pas distinguer une montre qui a marque trente matchs d'une
--    montre appairee puis jamais utilisee — donc pas decider laquelle delier.
--    On compte les SESSIONS distinctes, pas les evenements : « 7 matchs »
--    se comprend, « 412 points » ne dit rien.
--
-- 2. On ne pouvait pas RENOMMER. Avec deux montres, la liste affichait deux
--    fois « Montre » et delier revenait a tirer au sort.
--
-- La maquette montrait aussi la batterie et la version du logiciel : aucune
-- des deux n'existe nulle part, ni en base ni dans les apps montre, et les
-- inventer aurait affiche un chiffre faux. Elles sont volontairement absentes.
-- ============================================================
BEGIN;

-- Le compte des matchs marques depuis un appareil. Fonction a part : le
-- filtre revoked_at de l'appelant ne doit pas se melanger a l'agregat.
CREATE OR REPLACE FUNCTION public.fn_watch_link_matches(p_link_id uuid)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(DISTINCT session_id)::int
    FROM public.live_match_events
   WHERE watch_link_id = p_link_id;
$$;

CREATE OR REPLACE FUNCTION public.list_watch_links()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me uuid := public.current_player_id();
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', id, 'device_label', device_label,
      'created_at', created_at, 'last_seen_at', last_seen_at,
      'matches_count', public.fn_watch_link_matches(id)) ORDER BY created_at DESC)
    FROM public.watch_links WHERE player_id = v_me AND revoked_at IS NULL
  ), '[]'::jsonb);
END; $$;

-- Renommer. Le nom est saisi a la main : on borne a 40 caracteres et on
-- rend NULL une chaine vide, pour que l'ecran retombe sur « Montre » plutot
-- que d'afficher une ligne blanche.
CREATE OR REPLACE FUNCTION public.rename_watch_link(p_link_id uuid, p_label text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid := public.current_player_id();
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  UPDATE public.watch_links
     SET device_label = left(v_label, 40)
   WHERE id = p_link_id AND player_id = v_me AND revoked_at IS NULL;
END; $$;

-- Piege Supabase deja rencontre : REVOKE ... FROM PUBLIC ne retire PAS les
-- droits accordes directement a anon et authenticated. Les trois sont nommes.
REVOKE ALL ON FUNCTION public.fn_watch_link_matches(uuid)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rename_watch_link(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_watch_links()            FROM PUBLIC, anon, authenticated;

-- fn_watch_link_matches n'est appelee que depuis list_watch_links, qui est
-- SECURITY DEFINER : personne n'a besoin de l'appeler directement, et sans
-- GRANT elle ne peut pas servir a sonder l'activite d'un autre joueur.
GRANT EXECUTE ON FUNCTION public.list_watch_links()            TO authenticated;
GRANT EXECUTE ON FUNCTION public.rename_watch_link(uuid, text) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
