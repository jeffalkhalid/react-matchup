-- ============================================================
-- Tournois — la duree d'une rotation devient un REGLAGE.
--
-- ORDRE D'APPLICATION - il n'y a pas de runner, un humain applique a la main.
-- Ce fichier modifie public.tournaments et public.tournament_create, tous deux
-- crees par tournaments.sql / tournaments_rpcs.sql. Ils doivent exister.
--
-- LE PROBLEME : la duree n'etait pas un reglage, c'etait une CONSEQUENCE.
-- L'ecran de creation affichait « 6 rotations · 1h30 » parce que la duree
-- d'une rotation etait une constante du code (ROUND_MINUTES = 15). Or c'est
-- une contrainte du monde reel : on reserve un terrain pour un creneau donne,
-- et selon le club une rotation dure 12, 15 ou 20 minutes. L'organisateur
-- devait choisir un nombre de rotations pour obtenir la duree qu'il avait
-- reservee, au lieu de dire les deux.
--
-- CE QUE CETTE COLONNE NE FAIT PAS : elle ne pilote RIEN. Le moteur ne
-- chronometre pas les rotations, il n'a jamais lu ROUND_MINUTES et ne lira pas
-- davantage round_minutes. C'est une information AFFICHEE — aux joueurs qui
-- veulent savoir combien de temps ils restent, a l'organisateur qui a reserve.
-- Aucune fonction de tournaments_rpcs.sql n'en depend, et c'est voulu : une
-- soiree qui deborde de dix minutes ne doit pas se voir refuser sa rotation
-- suivante par une horloge.
--
-- PIEGE POSTGREST, DEJA PAYE SUR start_live_session ET apply_live_event :
-- ajouter un parametre avec DEFAULT ne remplace pas l'ancienne fonction, il en
-- cree une SECONDE. Les deux surcharges rendent alors l'appel ambigu et
-- PostgREST refuse tout. L'ancienne signature 9 arguments est donc DROPee
-- explicitement avant de recreer la fonction a 10.
--
-- Les clients deja publies continuent de marcher : ils envoient leurs 9
-- arguments nommes, le dixieme prend son DEFAULT.
-- ============================================================
BEGIN;

ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS round_minutes int NOT NULL DEFAULT 15;

-- Bornes larges : 5 minutes est deja court pour un jeu de padel, une heure
-- est deja long pour une rotation. Au-dela, c'est une faute de saisie.
ALTER TABLE public.tournaments
  DROP CONSTRAINT IF EXISTS tournaments_round_minutes_ck;
ALTER TABLE public.tournaments
  ADD CONSTRAINT tournaments_round_minutes_ck
  CHECK (round_minutes BETWEEN 5 AND 60);

DROP FUNCTION IF EXISTS public.tournament_create(
  text, timestamptz, int, int, uuid, numeric, numeric, int, jsonb);

-- Corps repris MOT POUR MOT de tournaments_rpcs.sql : seuls le parametre, son
-- controle et la colonne ecrite sont ajoutes. Le reecrire de tete avait fait
-- disparaitre six refus nommes (invalid_name, invalid_starts_at, les plafonds
-- a 20, invalid_price, invalid_level_range, club_not_found) -- des controles
-- qu'on ne remarque absents que le jour ou une saisie aberrante passe.
CREATE OR REPLACE FUNCTION public.tournament_create(
  p_name         text,
  p_starts_at    timestamptz,
  p_court_count  int,
  p_round_count  int,
  p_club_id      uuid    DEFAULT NULL,
  p_level_min    numeric DEFAULT NULL,
  p_level_max    numeric DEFAULT NULL,
  p_price_mad    int     DEFAULT 0,
  p_points_scale jsonb   DEFAULT NULL,
  p_round_minutes int    DEFAULT 15
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me    uuid := public.current_player_id();
  v_scale jsonb;
  v_minutes int := COALESCE(p_round_minutes, 15);
  v_id    uuid;
BEGIN
  ---------------------------------------------------------------------------
  -- CONTROLES -- aucune ecriture avant la fin de cette section.
  ---------------------------------------------------------------------------
  IF NOT public.fn_tournaments_enabled() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'feature_disabled');
  END IF;
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_name');
  END IF;
  IF p_starts_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_starts_at');
  END IF;
  -- Plafonds (Task 12), MEME regle que la CHECK de `tournaments.court_count` /
  -- `round_count' : sans eux, `court_count * 4` (fn_tournament_open_seats)
  -- deborde l'int a la premiere inscription -- `integer out of range` brut,
  -- au lieu de ce refus nomme, des la creation.
  IF p_court_count IS NULL OR p_court_count <= 0 OR p_court_count > 20 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_court_count');
  END IF;
  IF p_round_count IS NULL OR p_round_count <= 0 OR p_round_count > 20 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_round_count');
  END IF;
  -- Duree d'une rotation : refus NOMME plutot qu'une violation de CHECK brute,
  -- meme regle que les plafonds ci-dessus.
  IF v_minutes < 5 OR v_minutes > 60 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_round_minutes');
  END IF;
  IF p_price_mad IS NULL OR p_price_mad < 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_price');
  END IF;
  IF (p_level_min IS NOT NULL AND p_level_min < 0)
     OR (p_level_max IS NOT NULL AND p_level_max < 0)
     OR (p_level_min IS NOT NULL AND p_level_max IS NOT NULL
         AND p_level_min > p_level_max) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_level_range');
  END IF;
  IF p_club_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.clubs WHERE id = p_club_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'club_not_found');
  END IF;

  -- Bareme : reprend le defaut de la colonne quand rien n'est donne, et
  -- applique EN AMONT la meme regle que sa CHECK -- un refus nomme, pas une
  -- violation de contrainte brute.
  --
  -- FORME, pas seulement signe (Task 12) : `@.type() != "number"` avant le
  -- `@ < 0`, sinon `{"1":"abc"}`, `{"1":true}` ou `{"1":{"a":1}}` passaient
  -- tous les trois -- un comparateur `< 0` sur un type incompatible rend
  -- "inconnu" en mode tolerant, jamais vrai, donc aucun ne violait la CHECK
  -- d'origine. Le bareme atteignait alors `fn_tournament_points`, dont le
  -- `round((kv.value)::numeric)` levait une erreur SQL brute AU MILIEU de
  -- `tournament_close` -- transaction annulee, tournoi coince en EN_COURS,
  -- et aucune RPC ne permettait de corriger `points_scale` apres coup. Fermer
  -- cette porte ICI, a la creation, rend cet etat inatteignable plutot que
  -- d'avoir a ecrire un chemin de reparation.
  v_scale := COALESCE(p_points_scale,
    '{"1":100,"2":80,"3":65,"4":55,"5":45,"6":35,"7":25,"8":15}'::jsonb);
  IF jsonb_typeof(v_scale) <> 'object'
     OR jsonb_path_exists(v_scale, '$.* ? (@.type() != "number" || @ < 0)') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_points_scale');
  END IF;

  ---------------------------------------------------------------------------
  -- ECRITURE.
  ---------------------------------------------------------------------------
  INSERT INTO public.tournaments
         (name, club_id, starts_at, level_min, level_max, court_count,
          round_count, round_minutes, price_mad, points_scale, status, created_by)
  VALUES (btrim(p_name), p_club_id, p_starts_at, p_level_min, p_level_max,
          p_court_count, p_round_count, v_minutes, p_price_mad, v_scale,
          'INSCRIPTIONS_OUVERTES', v_me)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

-- Piege Supabase deja rencontre : REVOKE ... FROM PUBLIC ne retire PAS les
-- droits accordes directement a anon et authenticated. Les trois sont nommes.
REVOKE ALL ON FUNCTION public.tournament_create(
  text, timestamptz, int, int, uuid, numeric, numeric, int, jsonb, int)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_create(
  text, timestamptz, int, int, uuid, numeric, numeric, int, jsonb, int)
  TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
