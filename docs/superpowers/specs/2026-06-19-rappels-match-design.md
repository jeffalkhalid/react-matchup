# Rappels de match (push confort T‑1h / T‑30min) — Design

Date : 2026-06-19
Statut : validé, en attente de plan d'implémentation

## Objectif

Envoyer aux joueurs d'une partie **complète** un rappel push **confort** (sans
action) avant le début du match, pour réduire les oublis. Deux rappels :
**T‑1h** et **T‑30min** avant `open_games.match_date`.

Décision produit explicite : rappel **confort uniquement**. Pas de CTA
« je peux / je ne peux plus », **aucun branchement** sur le projet
« intégrité des parties » (backfill / anti‑annulation tardive). Si ce besoin
émerge plus tard, il fera l'objet d'un design distinct.

## Comportement produit

- **Deux pushs** : T‑1h puis T‑30min avant `match_date`.
- **Destinataires** : les joueurs **engagés au moment de l'envoi** =
  **acceptés + créateur** uniquement. Recalculés à chaque envoi : un joueur
  qui s'est désisté entre‑temps ne reçoit rien ; les restants reçoivent quand
  même. Les invités non‑expirés (pas encore acceptés) **ne reçoivent pas** de
  rappel (rappeler un match non confirmé n'a pas de sens).
- **Parties éligibles** : uniquement celles qui ont **atteint 4/4 à un
  moment** (`confirmed_full_at IS NOT NULL`). Une partie jamais complète ne
  génère aucun rappel (elle risque de ne pas avoir lieu). Une fois confirmée
  pleine, elle reste éligible même si un joueur part ensuite.
- **Marge requise par rappel** : chaque rappel ne part que s'il restait sa
  marge entière quand la partie est devenue complète :
  - **T‑1h** : seulement si `confirmed_full_at <= match_date - 60min`.
  - **T‑30min** : seulement si `confirmed_full_at <= match_date - 30min`.

  Selon l'heure de remplissage :
  - pleine à **> 1h** du début → **1h + 30min** ;
  - pleine entre **1h et 30min** → **30min seulement** (le 1h est sauté, sa
    fenêtre est déjà passée) ;
  - pleine à **< 30min** → **aucun rappel** (trop tard, pas de ping de
    dernière seconde).

### Contenu des pushs

- **T‑1h** — titre `⏳ Ton match approche` — corps
  `Rendez‑vous dans 1 h. Prépare ton sac !`
- **T‑30min** — titre `⏰ Plus que 30 min` — corps
  `Ton match commence bientôt. En route !`
- `data: { type: 'lobby', gameId }` — ouvre le lobby au tap (cohérent avec les
  autres notifs).

## Architecture technique

Une seule migration SQL, **zéro changement client**, calquée sur
`supabase/migrations/invite_expiry.sql` (pg_cron + fonction SECURITY DEFINER).
Le push part par `pg_net` (`net.http_post`) directement vers l'edge function
`send-push` existante — **pas de webhook ni d'edge function dédiée**, car il
n'y a pas de transition de ligne à écouter (déclenchement purement temporel).

### a) Marqueur « a été complète » — `open_games.confirmed_full_at timestamptz`

Posé **une seule fois** (guard `IS NULL`, idempotent) par un trigger
`AFTER INSERT OR UPDATE` sur `game_participants` qui compte les occupants
**acceptés + créateur** et fixe `confirmed_full_at = now()` au passage à 4/4.
C'est ce qui rend une partie éligible aux rappels même si un joueur part
ensuite, et ce qui porte la logique de marge ci‑dessus.

Occupation **dérivée des participants**, jamais du compteur dénormalisé
`spots_available` (sujet au drift, cf. notes projet).

### b) Flags anti‑doublon — `open_games.reminded_1h_at`, `reminded_30m_at timestamptz`

Garantissent qu'un rappel ne part qu'une fois et rendent le cron robuste au
jitter : il envoie au **premier passage** dans la fenêtre, puis pose le flag.

### c) Fonction `send_match_reminders()` (SECURITY DEFINER, service_role)

À chaque tick, deux passes :

- **Rappel 1h** — parties telles que :
  - `confirmed_full_at IS NOT NULL`
  - `confirmed_full_at <= match_date - interval '60 min'`
  - `reminded_1h_at IS NULL`
  - `match_date > now()` ET `match_date <= now() + interval '60 min'`
  - statut ni `closed` ni `cancelled`

  Pour chacune : recalcule les destinataires (acceptés + créateur) →
  `net.http_post` vers `send-push` (un appel, tableau `playerIds`, payload
  T‑1h) → pose `reminded_1h_at = now()`.

- **Rappel 30min** — idem avec `match_date - interval '30 min'`, fenêtre
  `match_date <= now() + interval '30 min'`, flag `reminded_30m_at`, payload
  T‑30min.

`REVOKE ALL ... FROM PUBLIC` + `GRANT EXECUTE ... TO service_role`, comme
`expire_stale_invitations`.

### d) Planification

`cron.schedule('send-match-reminders', '*/5 * * * *', $$ SELECT public.send_match_reminders(); $$)`
dans un bloc `DO` gardé par `pg_extension WHERE extname = 'pg_cron'` (même
pattern que `invite_expiry.sql`).

Précision : le 1h part entre T‑60 et T‑55, le 30min entre T‑30 et T‑25.
Suffisant pour du confort.

## Cas limites & garde‑fous

- **Match déjà commencé / cron en retard** : borne `match_date > now()` →
  jamais de rappel pour un match commencé ; le flag empêche tout double envoi.
- **Remplissage tardif** : géré par les conditions de marge (voir produit) —
  1h+30min / 30min seul / aucun, selon l'heure de remplissage.
- **Annulé ou fermé après être devenu complet** : exclu par le filtre `status`.
- **Aucun destinataire** (cas dégénéré, tous désistés) : `playerIds` vide → on
  **pose quand même le flag sans appeler `send-push`** (pas d'appel inutile).
- **Quiet hours** : volontairement non gérées (YAGNI) — un rappel ne part que
  pour un match planifié à cette heure précise, choisie par les joueurs.
- **Idempotence / rejeu** : les deux flags rendent `send_match_reminders()`
  sûre à exécuter aussi souvent que voulu.
- **Drift historique** : une partie devenue pleine *avant* cette migration n'a
  pas `confirmed_full_at` → pas de rappel rétroactif. Acceptable (les rappels
  ne concernent que le futur).

## Hors périmètre

- Toute action sur le push (confirmation de présence, désistement, backfill).
- Gestion des quiet hours / préférences de notification par joueur.
- Rappels pour parties non complètes.
- Tout changement client (React Native) — la feature est 100 % backend.

## Suivi de déploiement (rappel process projet)

Les migrations de ce projet ne sont **pas timestampées** et sont appliquées à
la main en prod (drift connu). À l'implémentation : appliquer la migration en
prod, vérifier que `pg_cron` planifie bien le job, et tester la livraison push
avec un match complet réel (penser au piège « token par appareil » :
notifications croisées multi‑comptes sur un même device — tester avec 2
appareils si possible).
