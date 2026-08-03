-- ============================================================
-- Défi 2v2 — notifications SERVEUR (push via pg_net → send-push) +
-- gestion de l'EXPIRATION des invitations, robustes (indépendantes du client).
--
-- Réutilise le pattern de match_reminders.sql : POST direct vers l'edge
-- function send-push, clé lue depuis le Vault ('service_role_key').
-- Pré-requis (déjà actifs en prod) : pg_net + supabase_vault + send-push.
--
-- Ce que ça ajoute :
--  1) fn_defi_targeted_decline : réagit désormais à 'declined' ET 'expired'
--     (une invitation non répondue expire via invite_expiry → même effet
--     qu'un refus). Gère aussi l'annulation d'un BROUILLON (défi non ciblé)
--     dont le partenaire créateur refuse/expire. Push au créateur à la
--     conversion d'un défi ciblé en défi ouvert.
--  2) defi_accept : push aux binômes PERDANTS de la course (candidatures
--     rejetées quand un binôme complet rafle la place).
-- ============================================================
BEGIN;

create extension if not exists pg_net;
create extension if not exists supabase_vault;

-- ---------- 1) Refus / expiration d'un défi ----------
CREATE OR REPLACE FUNCTION public.fn_defi_targeted_decline()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_is_chal  boolean;
  v_is_tgt   boolean;
  v_status   text;
  v_creator  uuid;
  v_a_elo    numeric;
  v_p_elo    numeric;
  v_floor_lv numeric;
  v_url text := 'https://icshhobxeppttgayxmba.supabase.co/functions/v1/send-push';
  v_key text;
BEGIN
  -- Refus OU expiration d'une invitation (transition entrante seulement).
  IF NOT (NEW.status IN ('declined','expired') AND OLD.status IS DISTINCT FROM NEW.status) THEN
    RETURN NEW;
  END IF;

  SELECT is_challenge, is_targeted, status, creator_id
    INTO v_is_chal, v_is_tgt, v_status, v_creator
    FROM open_games WHERE id = NEW.game_id FOR UPDATE;
  IF v_is_chal IS NOT TRUE OR v_status IN ('confirmed','cancelled','closed') THEN
    RETURN NEW;
  END IF;

  -- Défi NON ciblé : seul le cas BROUILLON compte (le partenaire créateur,
  -- Team A, refuse/expire avant publication → le brouillon ne publiera jamais).
  IF v_is_tgt IS NOT TRUE THEN
    IF v_status = 'draft' AND NEW.team_side LIKE 'A%' THEN
      UPDATE open_games SET status = 'cancelled' WHERE id = NEW.game_id;
    END IF;
    -- Un défi ouvert (race) utilise defi_applications, pas ce chemin.
    RETURN NEW;
  END IF;

  -- Défi CIBLÉ :
  --   • partenaire créateur (A) refuse/expire → annulation (binôme incomplet).
  IF (NEW.team_side LIKE 'A%') THEN
    UPDATE open_games SET status = 'cancelled' WHERE id = NEW.game_id;
    RETURN NEW;
  END IF;

  --   • membre du binôme ciblé (B) refuse/expire → conversion en défi OUVERT.
  SELECT elo_score INTO v_a_elo FROM players WHERE id = v_creator;
  SELECT p.elo_score INTO v_p_elo
    FROM game_participants gp JOIN players p ON p.id = gp.player_id
    WHERE gp.game_id = NEW.game_id AND gp.team_side LIKE 'A%' AND gp.player_id <> v_creator
    LIMIT 1;
  v_floor_lv := (public.elo_to_level(coalesce(v_a_elo,1000)) + public.elo_to_level(coalesce(v_p_elo, v_a_elo))) / 2.0;

  DELETE FROM game_participants
    WHERE game_id = NEW.game_id AND team_side LIKE 'B%';

  UPDATE open_games SET
    is_targeted = false,
    min_elo = public.level_to_elo(v_floor_lv),
    max_elo = public.level_to_elo(least(8.0, v_floor_lv + 1.5)),
    status = 'open',
    spots_available = 2
  WHERE id = NEW.game_id;

  -- Push au créateur : ton défi ciblé est refusé → maintenant ouvert à tous.
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';
  IF v_key IS NOT NULL AND v_creator IS NOT NULL THEN
    PERFORM net.http_post(
      url     := v_url,
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key),
      body    := jsonb_build_object(
                   'playerIds', jsonb_build_array(v_creator),
                   'title', '🔓 Défi désormais ouvert',
                   'body',  'Ton défi ciblé a été refusé — il est maintenant ouvert à tous dans « À relever ».',
                   'data',  jsonb_build_object('type','challenge'))
    );
  END IF;

  RETURN NEW;
END;
$$;

-- (le trigger trg_defi_targeted_decline reste branché sur cette fonction)

-- ---------- 2) Push aux binômes perdants de la course ----------
CREATE OR REPLACE FUNCTION public.defi_accept(p_app_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_me        uuid := public.current_player_id();
  v_game_id   uuid;
  v_initiator uuid;
  v_partner   uuid;
  v_app_stat  text;
  v_min       int;
  v_max       int;
  v_avg       numeric;
  v_b_taken   text[];
  v_side_i    text;
  v_side_p    text;
  v_losers    uuid[];
  v_url text := 'https://icshhobxeppttgayxmba.supabase.co/functions/v1/send-push';
  v_key text;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT a.game_id, a.initiator_id, a.partner_id, a.status
    INTO v_game_id, v_initiator, v_partner, v_app_stat
    FROM defi_applications a WHERE a.id = p_app_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'application not found'; END IF;
  IF v_me <> v_partner THEN RAISE EXCEPTION 'not the invited partner'; END IF;
  IF v_app_stat <> 'pending' THEN RAISE EXCEPTION 'application not pending'; END IF;

  PERFORM 1 FROM open_games WHERE id = v_game_id FOR UPDATE;
  SELECT min_elo, max_elo INTO v_min, v_max FROM open_games WHERE id = v_game_id;

  IF EXISTS (SELECT 1 FROM defi_applications WHERE game_id = v_game_id AND status = 'locked') THEN
    UPDATE defi_applications SET status = 'rejected', resolved_at = now() WHERE id = p_app_id;
    RETURN 'too_late';
  END IF;

  SELECT avg(elo_score) INTO v_avg FROM players WHERE id IN (v_initiator, v_partner);
  IF v_avg < coalesce(v_min, 0) OR v_avg > coalesce(v_max, 999999) THEN
    UPDATE defi_applications SET status = 'rejected', resolved_at = now() WHERE id = p_app_id;
    RAISE EXCEPTION 'binome out of level band';
  END IF;

  SELECT array_agg(team_side) INTO v_b_taken
    FROM game_participants
    WHERE game_id = v_game_id AND status = 'accepted' AND team_side IN ('B_GAU','B_DRO');
  v_b_taken := coalesce(v_b_taken, '{}'::text[]);
  v_side_i := CASE WHEN 'B_GAU' <> ALL(v_b_taken) THEN 'B_GAU' ELSE 'B_DRO' END;
  v_side_p := CASE WHEN v_side_i = 'B_GAU' THEN 'B_DRO' ELSE 'B_GAU' END;

  UPDATE defi_applications SET status = 'locked', resolved_at = now() WHERE id = p_app_id;

  INSERT INTO game_participants (game_id, player_id, status, team_side)
    VALUES (v_game_id, v_initiator, 'accepted', v_side_i),
           (v_game_id, v_partner,   'accepted', v_side_p);

  -- Rejeter les autres candidatures pending + collecter leurs joueurs (perdants).
  WITH rej AS (
    UPDATE defi_applications
      SET status = 'rejected', resolved_at = now()
      WHERE game_id = v_game_id AND status = 'pending' AND id <> p_app_id
      RETURNING initiator_id, partner_id
  )
  SELECT array_agg(DISTINCT pid) INTO v_losers
    FROM (SELECT initiator_id AS pid FROM rej UNION ALL SELECT partner_id FROM rej) x;

  UPDATE open_games SET status = 'confirmed', spots_available = 0 WHERE id = v_game_id;

  -- Push aux binômes perdants : un autre binôme a raflé la place.
  IF v_losers IS NOT NULL AND array_length(v_losers, 1) > 0 THEN
    SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';
    IF v_key IS NOT NULL THEN
      PERFORM net.http_post(
        url     := v_url,
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key),
        body    := jsonb_build_object(
                     'playerIds', to_jsonb(v_losers),
                     'title', '⏳ Défi déjà relevé',
                     'body',  'Un autre binôme a relevé le défi avant vous.',
                     'data',  jsonb_build_object('type','challenge'))
      );
    END IF;
  END IF;

  RETURN 'locked';
END;
$$;

GRANT EXECUTE ON FUNCTION public.defi_accept(uuid) TO authenticated;

COMMIT;
