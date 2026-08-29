-- ============================================================
-- App montre — initiales d'equipe pour les petits ecrans.
--
-- ORDRE : après watch_rpcs.sql (et watch_feature_flag.sql). Ré-appliquable.
--
-- La montre affiche « admin & Kay » quand la place le permet, « A&K » quand
-- elle manque, rien du tout sur les plus petits ecrans. Les deux formes sont
-- calculees ICI : Monkey C n'a pas de split() et la montre ne doit rien
-- deduire (spec §4).
--
-- Ce fichier REDEFINIT fn_watch_payload en repartant du corps ACTUEL de
-- supabase/migrations/watch_rpcs.sql (celui qui tourne en production, avec
-- game_label, match_decided et le flag has_session) et n'y ajoute que
-- team1_short / team2_short. Toutes les autres clés et tout leur calcul
-- sont conservés à l'identique.
--
-- SANS ACCENT, ET LA REGLE S'ARRETAIT ICI.
--
-- Les polices système Garmin ne garantissent pas les accents : un caractère
-- manquant est rendu par une image « glyphe absent » qui mange une cellule
-- entière. C'est le défaut qui sortait « 000[?]000 » au milieu du code
-- d'appairage, et toutes les chaînes ÉCRITES dans l'app montre sont depuis
-- volontairement en ASCII pur. Mais team1/team2/team1_short/team2_short ne
-- sont pas écrites dans l'app : elles sont fabriquées ICI, à partir des noms
-- bruts des joueurs. Une équipe « Émilie » + « Karim » donnait donc « É&K »,
-- soit une case sur deux perdue sur le barreau d'affichage — les initiales —
-- qui n'existe QUE pour les petits cadrans ronds, le dernier avant que les
-- noms ne disparaissent complètement. Des prénoms accentués ne sont pas un
-- cas limite pour cette base d'utilisateurs.
--
-- On aplatit donc les accents ici, avec EXACTEMENT le motif déjà employé par
-- public.frmt_normalize (frmt_auto_match_bonus.sql) : un translate() sur la
-- table des accents FR, sans aucune extension (unaccent est indisponible).
-- frmt_normalize elle-même ne peut pas être appelée telle quelle : elle passe
-- en minuscules et TRIE les tokens du nom (« Jean-Pierre Dupont » y devient
-- « dupont jean pierre »), ce qui rendrait l'initiale « D ». Il faut la même
-- table, mais en préservant la casse et l'ordre — d'où watch_ascii ci-dessous,
-- qui ajoute seulement les capitales accentuées à la même table.
-- ============================================================
BEGIN;

-- Aplatissement d'accents PRÉSERVANT LA CASSE ET L'ORDRE, pour les seules
-- chaînes lues par la montre. Même table que public.frmt_normalize, étendue
-- aux capitales accentuées : sans elles, upper(left('Émilie',1)) rendrait
-- « É », soit précisément le glyphe manquant qu'on élimine.
-- NULL reste NULL : string_agg ignore les NULL, et ce comportement doit être
-- conservé à l'identique.
CREATE OR REPLACE FUNCTION public.watch_ascii(txt text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT translate(
    txt,
    'àâäáãåéèêëíìîïóòôöõúùûüçñÀÂÄÁÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÇÑ',
    'aaaaaaeeeeiiiiooooouuuucnAAAAAAEEEEIIIIOOOOOUUUUCN'
  );
$$;

CREATE OR REPLACE FUNCTION public.fn_watch_payload(p_session_id uuid, p_player uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s RECORD; st jsonb; t1 text; t2 text; t1s text; t2s text;
BEGIN
  SELECT * INTO s FROM public.live_match_sessions WHERE id = p_session_id;
  IF s.id IS NULL THEN RETURN NULL; END IF;
  st := coalesce(s.current_state, public.fn_live_replay(p_session_id));

  -- Les DEUX barreaux sont aplatis, pas seulement les initiales : le nom
  -- complet court le même risque un cran plus tôt (« Émilie & Karim »).
  SELECT string_agg(public.watch_ascii(split_part(p.name, ' ', 1)), ' & ' ORDER BY ord),
         string_agg(upper(left(public.watch_ascii(p.name), 1)), '&' ORDER BY ord)
    INTO t1, t1s
    FROM unnest(s.team1_ids) WITH ORDINALITY AS u(pid, ord)
    JOIN public.players p ON p.id = u.pid;
  SELECT string_agg(public.watch_ascii(split_part(p.name, ' ', 1)), ' & ' ORDER BY ord),
         string_agg(upper(left(public.watch_ascii(p.name), 1)), '&' ORDER BY ord)
    INTO t2, t2s
    FROM unnest(s.team2_ids) WITH ORDINALITY AS u(pid, ord)
    JOIN public.players p ON p.id = u.pid;

  RETURN jsonb_build_object(
    -- ⚠️ Connect IQ n'accepte QUE des objets JSON en réponse : un `null`, une
    -- chaîne, un nombre ou un tableau — pourtant du JSON valide — sont rejetés
    -- côté montre par l'erreur -400 INVALID_HTTP_BODY_IN_NETWORK_RESPONSE, sans
    -- que l'appel serveur n'échoue pour autant. Toute RPC appelée par la montre
    -- doit donc TOUJOURS renvoyer un objet, jamais NULL. D'où `has_session`,
    -- qui porte l'absence de match au lieu de la coder par un `null`.
    'has_session',   true,
    'session_id',    s.id,
    'scoring_mode',  coalesce(s.scoring_mode, 'games'),
    'golden_point',  coalesce(s.golden_point, true),
    'team1',         coalesce(t1, 'Equipe 1'),
    'team2',         coalesce(t2, 'Equipe 2'),
    'team1_short',   coalesce(t1s, 'E1'),
    'team2_short',   coalesce(t2s, 'E2'),
    'sets',          coalesce(st->'sets', '[]'::jsonb),
    'sets_won',      coalesce(st->'setsWon', jsonb_build_object('t1', 0, 't2', 0)),
    'current_game',  coalesce(st->'currentGame', 'null'::jsonb),
    'tie_break',     coalesce(st->'tieBreak', 'false'::jsonb),
    'game_label',    CASE
      WHEN coalesce(s.scoring_mode, 'games') <> 'points'
        OR st->'currentGame' IS NULL
        OR jsonb_typeof(st->'currentGame') = 'null'
      THEN NULL
      ELSE public.fn_game_label(
        (st->'currentGame'->>'t1')::int,
        (st->'currentGame'->>'t2')::int,
        coalesce(s.golden_point, true),
        coalesce((st->>'tieBreak')::boolean, false))
    END,
    'contest_count', coalesce(s.contest_count, 0),
    'input_device',  coalesce(s.input_device, 'phone'),
    'is_scorer',     (s.scorer_id = p_player),
    -- DEUX notions distinctes, à ne surtout pas fusionner (spec §9) :
    --  • finished       = la session n'est plus 'live' → le téléphone a déjà
    --    validé ; c'est ce qui coupe la saisie au poignet.
    --  • match_decided  = le match est JOUÉ (2 sets d'écart-vainqueur) alors que
    --    la session tourne encore → la montre invite à sortir le téléphone,
    --    mais laisse marquer : l'app permet « Continuer un set ».
    -- MIROIR de isMatchDecided (lib/liveScore.ts:173) : évoluer les deux ensemble.
    -- NB : st->>'finished' ne convient PAS ici, il ne vaut true qu'après
    -- l'événement 'finished' posé par finalize_live_session - soit la même
    -- information que s.status, donc toujours trop tard.
    'match_decided', (
      greatest(coalesce((st->'setsWon'->>'t1')::int, 0),
               coalesce((st->'setsWon'->>'t2')::int, 0)) >= 2
      AND coalesce((st->'setsWon'->>'t1')::int, 0) <> coalesce((st->'setsWon'->>'t2')::int, 0)
    ),
    'finished',      (s.status <> 'live')
  );
END; $$;

-- Idem, et c'est le plus sensible des trois : joignable, fn_watch_payload est
-- une lecture NON AUTHENTIFIÉE de l'état d'une session live et des noms des
-- joueurs à partir du seul uuid de session - exactement ce que le commentaire
-- d'en-tête de watch_rpcs.sql interdit.
REVOKE ALL ON FUNCTION public.fn_watch_payload(uuid, uuid) FROM PUBLIC, anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
