-- À LIRE AVANT d'appliquer le backfill : qui serait déplacé, et où.
SELECT t.name                         AS tournoi,
       t.status,
       count(*)                       AS solos_assis_a_deplacer
  FROM public.tournaments t
  JOIN public.tournament_registrations r ON r.tournament_id = t.id
 WHERE t.status IN ('INSCRIPTIONS_OUVERTES', 'COMPLET')
   AND r.waitlist_position IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.tournament_participants tp
                    WHERE tp.tournament_id = r.tournament_id
                      AND tp.player_id     = r.player_id)
 GROUP BY t.id, t.name, t.status
 ORDER BY 3 DESC;
