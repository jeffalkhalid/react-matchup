-- ============================================================
-- Reprise des tournois DEJA CREES : rendre les sieges morts.
--
-- ORDRE D'APPLICATION - il n'y a pas de runner, un humain applique a la main.
-- A appliquer APRES tournament_pairs_only_seats.sql, et seulement apres.
--
-- ⚠️ CE FICHIER MODIFIE DES DONNEES, contrairement aux trois precedents qui ne
-- changeaient que des fonctions. C'est le SEUL de la serie a deplacer des
-- gens, et ca se verra dans l'app : un joueur assis seul passera en file.
-- Relisez-le avant de l'appliquer.
--
-- POURQUOI IL FAUT LE FAIRE : les migrations de fonctions ne rattrapent pas le
-- passe. La regle « un siege appartient a un binome » s'applique aux
-- inscriptions A VENIR et aux promotions A VENIR ; un joueur DEJA assis seul
-- garde son siege mort indefiniment. Le tournoi reste « COMPLET » et
-- injouable, ce qui est exactement le probleme qu'on vient de corriger.
--
-- CE QU'IL NE TOUCHE PAS, et c'est deliberé :
--
--   * les tournois qui ont depasse les inscriptions (CHECK_IN, PRET, EN_COURS,
--     TERMINE, CLASSEMENT_VALIDE, ANNULE). Deplacer quelqu'un la veille au soir
--     serait brutal, et sur un tournoi lance ca casserait les tirages. Les
--     solos assis d'une soiree imminente sont l'affaire de l'organisateur,
--     pas d'une migration ;
--   * les joueurs APPARIES, evidemment ;
--   * les positions de file existantes : personne ne recule.
--
-- OU ILS ATTERRISSENT : en TETE de file, a la position minimale courante — ils
-- etaient assis, donc plus anciens que tout ce qui attend, et `registered_at`
-- departage entre eux. Des qu'ils trouvent un binome, ils repassent devant.
--
-- IDEMPOTENT : relance sans effet une fois les sieges rendus (la clause
-- `waitlist_position IS NULL` ne trouve plus personne).
-- ============================================================
BEGIN;

-- 1) Les joueurs assis SANS binome, sur les tournois encore aux inscriptions,
--    retournent en file — en tete.
WITH ouverts AS (
  SELECT t.id
    FROM public.tournaments t
   WHERE t.status IN ('INSCRIPTIONS_OUVERTES', 'COMPLET')
),
tete AS (
  SELECT o.id AS tournament_id,
         coalesce(min(r.waitlist_position), 1) AS pos
    FROM ouverts o
    LEFT JOIN public.tournament_registrations r
           ON r.tournament_id = o.id AND r.waitlist_position IS NOT NULL
   GROUP BY o.id
)
UPDATE public.tournament_registrations r
   SET waitlist_position = tete.pos
  FROM tete
 WHERE r.tournament_id = tete.tournament_id
   AND r.waitlist_position IS NULL
   AND NOT EXISTS (
         SELECT 1 FROM public.tournament_participants tp
          WHERE tp.tournament_id = r.tournament_id
            AND tp.player_id     = r.player_id);

-- 2) La file tourne : les sieges ainsi rendus repartent aux binomes qui
--    attendaient. `fn_tournament_promote_waitlist` ne promeut plus que des
--    binomes, et remet aussi le statut du tournoi d'aplomb
--    (fn_tournament_sync_capacity_status, appele en fin de promotion) — un
--    tournoi passe « COMPLET » par des solos redevient donc ouvert.
DO $$
DECLARE v_id uuid;
BEGIN
  FOR v_id IN
    SELECT id FROM public.tournaments
     WHERE status IN ('INSCRIPTIONS_OUVERTES', 'COMPLET')
  LOOP
    PERFORM public.fn_tournament_promote_waitlist(v_id);
  END LOOP;
END $$;

COMMIT;
