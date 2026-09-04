-- ============================================================
-- Journal d'arbitrage — garder la trace de chaque decision.
-- Implemente design_handoff_panel_arbitre, journal d'arbitrage.
--
-- ORDRE D'APPLICATION - il n'y a pas de runner, un humain applique a la main.
-- Ce fichier attache des declencheurs a public.matches, public.players,
-- public.content_reports (moderation.sql) et public.gender_change_requests
-- (gender_change_requests.sql), et utilise public.is_app_admin() et
-- public.current_player_id(). Tout cela doit exister.
--
-- LE PROBLEME : rien ne gardait trace de ce que l'arbitre decide. Un match
-- valide de force, un compte bloque, un signalement classe sans suite : une
-- fois l'ecran referme, il ne restait que l'etat final, sans qui l'avait
-- decide ni quand. Un joueur qui conteste une decision n'avait aucun recours,
-- et l'arbitre lui-meme ne pouvait pas revoir ce qu'il avait fait la veille.
--
-- POURQUOI DES DECLENCHEURS, ET PAS UN APPEL DEPUIS L'APP : le panel modifie
-- les tables directement (update sur matches, sur content_reports...). Un
-- journal alimente par l'app ne consigne que ce que l'app pense a consigner —
-- un ecran ajoute plus tard, un chemin oublie, et le trou ne se voit jamais.
-- Ici la trace est ecrite par la base, du cote ou la modification arrive : on
-- ne peut pas decider sans laisser de trace.
--
-- REGLE ABSOLUE : le journal ne bloque JAMAIS une decision. Chaque
-- declencheur avale ses propres erreurs. Un journal casse doit couter une
-- ligne manquante, jamais un litige qu'on ne peut plus trancher.
--
-- CE QUI N'EST PAS JOURNALISE, ET C'EST VOULU : les changements faits par la
-- base elle-meme (auto-validation a 24 h, promotions de liste d'attente). Ils
-- n'ont pas d'auteur : auth.uid() est nul, is_app_admin() est faux, rien
-- n'est ecrit. Le journal est celui des DECISIONS HUMAINES, pas des
-- mouvements automatiques.
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_actions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- L'arbitre. ON DELETE SET NULL : un compte supprime ne doit pas emporter
  -- l'historique des decisions qu'il a prises.
  actor_id     uuid REFERENCES public.players(id) ON DELETE SET NULL,
  action       text NOT NULL,
  entity_table text NOT NULL,
  entity_id    uuid NOT NULL,
  -- Le joueur concerne, quand il y en a UN seul (un match en a quatre).
  subject_id   uuid REFERENCES public.players(id) ON DELETE SET NULL,
  details      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_actions_recent_idx
  ON public.admin_actions (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_actions_entity_idx
  ON public.admin_actions (entity_table, entity_id);
CREATE INDEX IF NOT EXISTS admin_actions_subject_idx
  ON public.admin_actions (subject_id) WHERE subject_id IS NOT NULL;

ALTER TABLE public.admin_actions ENABLE ROW LEVEL SECURITY;

-- Lecture reservee aux administrateurs. Aucune politique d'ecriture : les
-- lignes n'arrivent que par les declencheurs, qui sont SECURITY DEFINER.
-- Personne ne peut donc fabriquer ni effacer une entree depuis l'app.
DROP POLICY IF EXISTS admin_actions_read ON public.admin_actions;
CREATE POLICY admin_actions_read ON public.admin_actions
  FOR SELECT TO authenticated USING (public.is_app_admin());

-- ── Le declencheur commun ────────────────────────────────────────────────
-- Une seule fonction pour les quatre tables : ce qui change d'une table a
-- l'autre, c'est le nom de l'action et le sujet, pas la mecanique.
CREATE OR REPLACE FUNCTION public.fn_log_admin_action()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor   uuid;
  v_action  text;
  v_subject uuid;
  v_details jsonb := '{}'::jsonb;
BEGIN
  -- Tout le corps est protege : voir la REGLE ABSOLUE en tete de fichier.
  BEGIN
    IF NOT public.is_app_admin() THEN RETURN NEW; END IF;
    v_actor := public.current_player_id();

    IF TG_TABLE_NAME = 'matches' THEN
      IF NEW.status IS DISTINCT FROM OLD.status THEN
        v_action := CASE NEW.status
                      WHEN 'validated' THEN 'match_valide_force'
                      WHEN 'cancelled' THEN 'match_annule'
                      ELSE 'match_statut'
                    END;
        v_details := jsonb_build_object(
          'de', OLD.status, 'vers', NEW.status,
          'score_avant', OLD.score_text, 'score_apres', NEW.score_text);
      END IF;

    ELSIF TG_TABLE_NAME = 'content_reports' THEN
      IF NEW.status IS DISTINCT FROM OLD.status THEN
        v_action  := CASE NEW.status
                       WHEN 'actioned'  THEN 'signalement_retenu'
                       WHEN 'dismissed' THEN 'signalement_classe'
                       ELSE 'signalement_statut'
                     END;
        v_subject := NEW.reported_player_id;
        v_details := jsonb_build_object(
          'de', OLD.status, 'vers', NEW.status,
          'type_cible', NEW.target_type, 'motif', NEW.reason);
      END IF;

    ELSIF TG_TABLE_NAME = 'gender_change_requests' THEN
      IF NEW.status IS DISTINCT FROM OLD.status THEN
        v_action  := CASE NEW.status
                       WHEN 'approved' THEN 'genre_accepte'
                       WHEN 'rejected' THEN 'genre_refuse'
                       ELSE 'genre_statut'
                     END;
        v_subject := NEW.player_id;
        v_details := jsonb_build_object(
          'de', OLD.status, 'vers', NEW.status,
          'genre_demande', NEW.requested_gender, 'genre_actuel', OLD.current_gender);
      END IF;

    ELSIF TG_TABLE_NAME = 'players' THEN
      -- Un administrateur modifie SON PROPRE profil comme tout le monde :
      -- ce n'est pas une decision d'arbitrage. On n'ecrit donc rien quand
      -- l'auteur est le sujet.
      IF v_actor IS NOT DISTINCT FROM NEW.id THEN RETURN NEW; END IF;
      v_subject := NEW.id;
      -- frmt_blocked, et non is_blocked : le blocage de l'app porte sur la
      -- revendication de classement FRMT (fraude), pas sur le compte.
      IF NEW.frmt_blocked IS DISTINCT FROM OLD.frmt_blocked THEN
        v_action  := CASE WHEN NEW.frmt_blocked THEN 'frmt_bloque' ELSE 'frmt_debloque' END;
        v_details := jsonb_build_object('nom', NEW.name);
      ELSIF NEW.gender IS DISTINCT FROM OLD.gender THEN
        v_action  := 'genre_modifie';
        v_details := jsonb_build_object('nom', NEW.name, 'de', OLD.gender, 'vers', NEW.gender);
      ELSIF NEW.frmt_verified IS DISTINCT FROM OLD.frmt_verified THEN
        v_action  := CASE WHEN NEW.frmt_verified THEN 'frmt_lie' ELSE 'frmt_delie' END;
        v_details := jsonb_build_object('nom', NEW.name);
      ELSIF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
        v_action  := CASE WHEN NEW.is_admin THEN 'arbitre_nomme' ELSE 'arbitre_retire' END;
        v_details := jsonb_build_object('nom', NEW.name);
      END IF;
    END IF;

    IF v_action IS NULL THEN RETURN NEW; END IF;

    INSERT INTO public.admin_actions (actor_id, action, entity_table, entity_id, subject_id, details)
    VALUES (v_actor, v_action, TG_TABLE_NAME, NEW.id, v_subject, v_details);
  EXCEPTION WHEN OTHERS THEN
    -- Journal casse = une ligne manquante. Jamais une decision bloquee.
    NULL;
  END;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_log_admin_matches ON public.matches;
CREATE TRIGGER trg_log_admin_matches AFTER UPDATE ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.fn_log_admin_action();

DROP TRIGGER IF EXISTS trg_log_admin_reports ON public.content_reports;
CREATE TRIGGER trg_log_admin_reports AFTER UPDATE ON public.content_reports
  FOR EACH ROW EXECUTE FUNCTION public.fn_log_admin_action();

DROP TRIGGER IF EXISTS trg_log_admin_gender ON public.gender_change_requests;
CREATE TRIGGER trg_log_admin_gender AFTER UPDATE ON public.gender_change_requests
  FOR EACH ROW EXECUTE FUNCTION public.fn_log_admin_action();

DROP TRIGGER IF EXISTS trg_log_admin_players ON public.players;
CREATE TRIGGER trg_log_admin_players AFTER UPDATE ON public.players
  FOR EACH ROW EXECUTE FUNCTION public.fn_log_admin_action();

-- ── Lecture ──────────────────────────────────────────────────────────────
-- Pagination par CURSEUR (created_at) et non par OFFSET : le journal grandit
-- par le haut, et un offset ferait sauter ou repeter des lignes des qu'une
-- decision est prise pendant qu'on feuillette.
CREATE OR REPLACE FUNCTION public.admin_action_log(
  p_limit int DEFAULT 40,
  p_before timestamptz DEFAULT NULL,
  p_search text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
BEGIN
  IF NOT public.is_app_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(x ORDER BY x->>'created_at' DESC) FROM (
      SELECT jsonb_build_object(
        'id', a.id, 'action', a.action, 'entity_table', a.entity_table,
        'entity_id', a.entity_id, 'details', a.details, 'created_at', a.created_at,
        'actor_name', act.name, 'subject_name', sub.name, 'subject_id', a.subject_id) AS x
      FROM public.admin_actions a
      LEFT JOIN public.players act ON act.id = a.actor_id
      LEFT JOIN public.players sub ON sub.id = a.subject_id
      WHERE (p_before IS NULL OR a.created_at < p_before)
        AND (v_q IS NULL
             OR act.name ILIKE '%' || v_q || '%'
             OR sub.name ILIKE '%' || v_q || '%'
             OR a.action ILIKE '%' || v_q || '%')
      ORDER BY a.created_at DESC
      LIMIT least(greatest(coalesce(p_limit, 40), 1), 200)
    ) s
  ), '[]'::jsonb);
END; $$;

-- Piege Supabase deja rencontre : REVOKE ... FROM PUBLIC ne retire PAS les
-- droits accordes directement a anon et authenticated. Les trois sont nommes.
REVOKE ALL ON FUNCTION public.admin_action_log(int, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_action_log(int, timestamptz, text) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
