-- ============================================================
-- Mixite : gender_pref devient une REGLE, plus une etiquette.
--
-- ORDRE D'APPLICATION - il n'y a pas de runner, un humain applique a la main.
-- Ce fichier remplace public.join_game. Il reprend la version de
-- defi_join_guard.sql (la plus recente : corps de join_game_rpc.sql + le garde
-- des defis) et n'y AJOUTE que le controle de mixite. Appliquer une version
-- anterieure ferait disparaitre le garde des defis.
--
-- LE PROBLEME : open_games.gender_pref valait men / women / mixed, s'affichait
-- en pastille sur la carte... et RIEN ne l'appliquait. Aucune regle serveur,
-- aucun filtre d'acces. Un homme pouvait rejoindre une partie annoncee
-- « Femmes ». gender_change_requests.sql parle deja du « contournement des
-- filtres gender_pref » : le produit supposait cette regle, elle n'existait
-- pas.
--
-- POURQUOI ICI ET PAS DANS UN FILTRE D'AFFICHAGE : un filtre cache, il
-- n'empeche pas. Une partie atteinte par un lien partage, une liste en cache,
-- un ecran de detail ouvert autrement — tous ces chemins contournent un filtre.
-- La RPC est le seul passage obligatoire.
--
-- LE CAS DU GENRE NON DECLARE : refuse sur les parties genrees, avec un motif
-- qui dit quoi faire. L'admettre « par defaut » ouvrirait exactement la porte
-- que ce controle ferme — il suffirait de ne rien declarer.
--
-- Les parties `mixed` et celles sans preference n'imposent rien : la regle ne
-- se declenche que sur un choix explicite de l'organisateur.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.join_game(
  p_game_id uuid,
  p_side text DEFAULT NULL,
  p_join_waitlist boolean DEFAULT false,
  p_note text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me        uuid := public.current_player_id();
  v_elo       numeric;
  v_min       int;
  v_max       int;
  v_occupied  int;
  v_free      int;
  v_fit       boolean;
  v_status    text;
  v_is_chal   boolean;
  v_gender    text;
  v_my_gender text;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT min_elo, max_elo, is_challenge, gender_pref
    INTO v_min, v_max, v_is_chal, v_gender
    FROM open_games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'game not found'; END IF;

  -- Un défi ne se rejoint pas en solo : il se relève à deux (hub Défi).
  IF v_is_chal IS TRUE THEN RAISE EXCEPTION 'defi requires binome'; END IF;

  SELECT elo_score, gender INTO v_elo, v_my_gender FROM players WHERE id = v_me;

  -- MIXITE. gender_pref n'etait qu'une etiquette sur la carte : rien ne
  -- l'appliquait, et un homme pouvait rejoindre une partie annoncee « Femmes ».
  -- C'est ici que ca se verrouille, pas dans un filtre d'affichage — un filtre
  -- se contourne, une RPC non.
  --
  -- Un joueur qui n'a pas declare son genre est refuse sur les parties
  -- genrees, avec un motif qui dit quoi faire. L'admettre « par defaut »
  -- ouvrirait exactement la porte que ce controle ferme.
  IF v_gender IN ('men', 'women') THEN
    IF v_my_gender IS NULL THEN
      RAISE EXCEPTION 'gender not set';
    END IF;
    IF (v_gender = 'men' AND v_my_gender <> 'male')
       OR (v_gender = 'women' AND v_my_gender <> 'female') THEN
      RAISE EXCEPTION 'gender not allowed';
    END IF;
  END IF;

  SELECT count(*) INTO v_occupied
    FROM game_participants
    WHERE game_id = p_game_id
      AND (status = 'accepted'
           OR (status = 'invited'
               AND (invite_expires_at IS NULL OR invite_expires_at > now())));

  v_free := 4 - 1 - v_occupied;   -- 4 joueurs - le créateur - occupants vivants

  v_fit := (v_elo >= coalesce(v_min, 0)) AND (v_elo <= coalesce(v_max, 9999));

  IF p_join_waitlist OR v_free <= 0 THEN
    v_status := 'waitlist';
  ELSIF v_fit THEN
    v_status := 'accepted';
  ELSE
    v_status := 'pending';
  END IF;

  DELETE FROM game_participants
    WHERE game_id = p_game_id AND player_id = v_me
      AND (status IN ('declined','expired')
           OR (status = 'invited'
               AND invite_expires_at IS NOT NULL
               AND invite_expires_at <= now()));

  INSERT INTO game_participants (game_id, player_id, status, team_side, application_note)
    VALUES (p_game_id, v_me, v_status, p_side,
            CASE WHEN v_status = 'pending'
                 THEN nullif(left(trim(p_note), 140), '')
                 ELSE NULL END);

  IF v_status = 'accepted' THEN
    UPDATE open_games
      SET spots_available = greatest(0, coalesce(spots_available, 1) - 1)
      WHERE id = p_game_id;
  END IF;

  RETURN v_status;
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
