-- react-matchup/supabase/migrations/defi_stake_elo.sql
-- ============================================================
-- Défi 2v2 — applique la MISE (stake) au delta ELO per-joueur.
-- Reprend fn_distribute_elo_on_validate dans son état CANONIQUE
-- (elo_placement_phase.sql : phase de placement K=85 / blowout 2.5
-- / cap 90 pour les 4 premiers matchs) — surtout NE PAS repartir de
-- elo_per_player_k.sql qui est antérieur et n'a pas la phase de
-- placement (sinon on la supprimerait en prod).
-- Seules les DEUX branches du delta sont multipliées par STAKE :
--   STAKE = coalesce(NEW.stake_multiplier, 1.0).
-- En placement, le cap 90 s'applique APRÈS le stake (identique à
-- lib/elo.ts : Math.min(delta, 90) après *stakeMultiplier) → une
-- grosse mise ne fait pas exploser un match de placement.
-- Non-défi → stake 1.0 → comportement inchangé.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_distribute_elo_on_validate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  w_ids   uuid[] := array_remove(ARRAY[NEW.winner_id, NEW.winner_id_2], NULL);
  l_ids   uuid[] := array_remove(ARRAY[NEW.loser_id,  NEW.loser_id_2 ], NULL);
  all_ids uuid[] := array_remove(ARRAY[NEW.winner_id, NEW.winner_id_2, NEW.loser_id, NEW.loser_id_2], NULL);
  w_team   numeric;
  l_team   numeric;
  expected numeric;
  anti     numeric;
  margin   numeric;
  factor   numeric;
  stake    numeric := coalesce(NEW.stake_multiplier, 1.0);
BEGIN
  IF NOT (NEW.status = 'validated' AND OLD.status IS DISTINCT FROM 'validated') THEN
    RETURN NEW;
  END IF;

  CREATE TEMP TABLE _elo_snap ON COMMIT DROP AS
    SELECT
      id, elo_score, win_count, loss_count, fiability_pct, last_match_at,
      round(elo_score * public.elo_inactivity_decay(last_match_at))::numeric AS decayed
    FROM public.players
    WHERE id = ANY(all_ids);

  IF NEW.game_format = 'friendly' THEN
    UPDATE public.players SET last_match_at = now() WHERE id = ANY(all_ids);
    DROP TABLE IF EXISTS _elo_snap;
    RETURN NEW;
  END IF;

  IF array_length(w_ids, 1) IS NULL OR array_length(l_ids, 1) IS NULL THEN
    DROP TABLE IF EXISTS _elo_snap;
    RETURN NEW;
  END IF;

  SELECT avg(decayed) INTO w_team FROM _elo_snap WHERE id = ANY(w_ids);
  SELECT avg(decayed) INTO l_team FROM _elo_snap WHERE id = ANY(l_ids);

  expected := 1.0 / (1.0 + power(10.0, (l_team - w_team) / 400.0));

  anti := CASE
    WHEN (w_team - l_team) > 300 THEN 0.5
    WHEN (w_team - l_team) > 150 THEN 0.75
    ELSE 1.0
  END;

  margin := public.elo_margin_multiplier(NEW.score_text);
  factor := (1 - expected) * anti;

  -- delta PAR JOUEUR × MISE (les DEUX branches multipliées par stake).
  --   Placement (matchs joués < 4) : K=85, blowout (1.5) amplifié à 2.5,
  --     cap 90 APRÈS le stake.
  --   Sinon : K per-joueur sur la fiabilité, marge inchangée.
  CREATE TEMP TABLE _elo_delta ON COMMIT DROP AS
    SELECT
      s.id, s.decayed, s.elo_score,
      CASE
        WHEN (coalesce(s.win_count, 0) + coalesce(s.loss_count, 0)) < 4 THEN
          least(
            90,
            round(
              greatest(1, round(85 * factor))
              * (CASE WHEN margin = 1.5 THEN 2.5 ELSE margin END)
              * stake
            )
          )::int
        ELSE
          round(greatest(1, round(public.elo_k_factor(s.fiability_pct) * factor)) * margin * stake)::int
      END AS delta
    FROM _elo_snap s;

  UPDATE public.players p SET
    elo_score     = d.decayed + d.delta,
    win_count     = coalesce(p.win_count, 0) + 1,
    last_match_at = now(),
    fiability_pct = least(greatest(10, coalesce(p.fiability_pct, 10)) + 5, 100)
  FROM _elo_delta d
  WHERE p.id = d.id AND d.id = ANY(w_ids);

  INSERT INTO public.elo_history (player_id, match_id, elo_score, elo_change)
  SELECT d.id, NEW.id, d.decayed + d.delta, (d.decayed + d.delta) - d.elo_score
  FROM _elo_delta d WHERE d.id = ANY(w_ids);

  UPDATE public.players p SET
    elo_score     = greatest(100, d.decayed - d.delta),
    loss_count    = coalesce(p.loss_count, 0) + 1,
    last_match_at = now(),
    fiability_pct = least(greatest(10, coalesce(p.fiability_pct, 10)) + 5, 100)
  FROM _elo_delta d
  WHERE p.id = d.id AND d.id = ANY(l_ids);

  INSERT INTO public.elo_history (player_id, match_id, elo_score, elo_change)
  SELECT d.id, NEW.id, greatest(100, d.decayed - d.delta), greatest(100, d.decayed - d.delta) - d.elo_score
  FROM _elo_delta d WHERE d.id = ANY(l_ids);

  DROP TABLE IF EXISTS _elo_delta;
  DROP TABLE IF EXISTS _elo_snap;
  RETURN NEW;
END;
$$;

COMMIT;
