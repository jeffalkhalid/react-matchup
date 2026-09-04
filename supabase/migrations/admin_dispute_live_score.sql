-- ============================================================
-- Litiges — donner a l'arbitre le score enregistre EN DIRECT.
-- Implemente design_handoff_panel_arbitre, fiche de decision de litige.
--
-- ORDRE D'APPLICATION - il n'y a pas de runner, un humain applique a la main.
-- Ce fichier lit public.live_match_sessions (live_scoring.sql) et
-- public.is_app_admin() (enable_rls_phase1.sql / moderation.sql) : les deux
-- doivent etre en place.
--
-- LE PROBLEME : quand deux joueurs annoncent deux scores differents,
-- l'arbitre n'avait que leurs deux paroles. Or, quand le match a ete marque
-- en direct dans l'app, il existe une TROISIEME source, ecrite point par
-- point pendant la partie, que personne ne peut reecrire apres coup.
--
-- Elle etait juste inaccessible : la RLS de live_match_sessions ne l'ouvre
-- qu'aux quatre participants, et l'arbitre n'en est pas un.
--
-- On ne TOUCHE PAS a cette RLS. Une politique elargie s'appliquerait a toutes
-- les sessions, tout le temps ; cette RPC ne rend que les sessions des matchs
-- demandes, et seulement a un administrateur. Le jour ou on la retire, la
-- confidentialite d'origine est intacte.
--
-- On ne renvoie QUE ce qui sert a comparer des scores : l'etat des sets et
-- l'ordre des equipes. Ni le marqueur, ni le journal des evenements, ni les
-- horodatages — un litige sur un score n'a pas besoin de savoir qui a appuye.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_live_scores(p_match_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_app_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  IF p_match_ids IS NULL OR array_length(p_match_ids, 1) IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'match_id',      s.match_id,
      'team1_ids',     s.team1_ids,
      'team2_ids',     s.team2_ids,
      'current_state', s.current_state,
      'status',        s.status,
      'contest_count', s.contest_count))
    FROM public.live_match_sessions s
    WHERE s.match_id = ANY(p_match_ids)
  ), '[]'::jsonb);
END; $$;

-- Piege Supabase deja rencontre : REVOKE ... FROM PUBLIC ne retire PAS les
-- droits accordes directement a anon et authenticated. Les trois sont nommes.
REVOKE ALL ON FUNCTION public.admin_live_scores(uuid[]) FROM PUBLIC, anon, authenticated;
-- Le GRANT est large, le verrou est le is_app_admin() en tete de fonction :
-- un joueur ordinaire recoit not_admin, pas une liste vide qui laisserait
-- croire que le match n'a pas ete marque en direct.
GRANT EXECUTE ON FUNCTION public.admin_live_scores(uuid[]) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
