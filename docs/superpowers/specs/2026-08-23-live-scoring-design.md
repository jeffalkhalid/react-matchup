# Score en direct (live scoring) — Design

**Date** : 2026-08-23 (brainstorming entamé le 2026-06-10, repris et conclu le 2026-08-23)
**Statut** : validé section par section — en attente du plan d'implémentation

## 1. Objectif et périmètre

Permettre de suivre le score d'une partie **pendant le match**, jeu par jeu, au lieu de la
saisie unique post-match (`app/score-entry.tsx`). Objectifs retenus : **score
incontestable** (saisi au fil de l'eau devant tout le monde), **stats riches** (journal
d'événements exploitable plus tard), **confort de saisie** (~1 tap par jeu, sur les pauses
naturelles).

Hors périmètre (décisions explicites) :
- Pas de mode spectateur public (seuls les 4 joueurs voient le live).
- Pas de saisie point par point (granularité = jeu ; le point en or est invisible à ce niveau).
- Pas de distribution de badges dans le live (flux post-match existant inchangé, fenêtre 48 h).
- Surfaces « télécommande » (notification Android, Live Activity iOS, app Garmin) = phases
  ultérieures, voir §9.

## 2. Décisions structurantes (historique)

| Décision | Choix |
|---|---|
| Granularité | Jeu par jeu ; sets et match reconstruits automatiquement |
| Écrivain | 1 scoreur désigné, les 3 autres lecteurs realtime |
| Désignation | Volontariat dans le lobby avant le match (« Je scorerai »), badge ⌚ si montre connectée ; personne → pas de live |
| Contestation | Marqueur silencieux : event `contest`, aucune interruption du match |
| Fin de match | Auto-détection + confirmation scoreur, avec « Continuer un set » (set fun) |
| Pont vers `matches` | 0 contestation ouverte → insert `confirmed` (ELO immédiat) ; ≥ 1 → insert `pending` (flux classique) |
| Scoreur défaillant | N'importe quel autre joueur reprend le rôle sans validation (`scorer_changed`) |
| Activation | Feature flag `app_config.live_scoring_enabled`, toggle dans le Panel Arbitre, défaut éteint |

Verdict du spike « notification-télécommande » (2026-08-23) : mécanique boutons d'action
validée de bout en bout côté app ; **iPhone + Garmin impossible** (ANCS ne relaie pas les
actions d'apps tierces) ; Android + montre = crédible, non testé. D'où le phasage §9.

## 3. Modèle de données

Deux tables nouvelles, aucune existante modifiée (sauf une colonne nullable sur
`open_games`, §4).

### `live_match_sessions`
| Colonne | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `game_id` | uuid FK `open_games`, **unique** | une seule session par partie |
| `scorer_id` | uuid FK `players` | scoreur courant |
| `team1_ids` / `team2_ids` | uuid[] | composition figée au démarrage |
| `current_state` | jsonb | `{ sets: [{t1, t2}], finished: bool }` — dérivé du journal, dénormalisé pour affichage instantané |
| `status` | text | `live` \| `finished` \| `abandoned` |
| `contest_count` | int | contestations non résolues |
| `started_at`, `updated_at` | timestamptz | |

### `live_match_events` (append-only — source de vérité)
| Colonne | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `session_id` | uuid FK | |
| `seq` | int, **unique par session**, strictement croissant | |
| `author_id` | uuid | |
| `event_type` | text | `game_won` \| `undo` \| `contest` \| `contest_resolved` \| `scorer_changed` \| `finished` \| `abandoned` |
| `payload` | jsonb | ex. `{team: 1}` pour `game_won`, `{target_seq}` pour `undo`/`contest` |
| `created_at` | timestamptz | |

**Principe** : on n'écrit que des événements, jamais de modification. Un `undo` est un
événement annulant le `game_won` visé ; l'historique complet reste lisible (stats futures).

**RPC `apply_live_event(session_id, event_type, payload)`** : insère l'événement ET
recalcule `current_state` dans la même transaction. Vérifie que l'auteur est le scoreur
courant pour les événements de score (`game_won`, `undo`, `finished`), un participant pour
`contest`/`scorer_changed`.

**Realtime** : canal Supabase sur `live_match_sessions` (même brique que les notifs
realtime en prod) — une mise à jour par jeu, léger.

**RLS** : lecture pour les 4 participants de la partie ; écriture uniquement via les RPC.

## 4. Cycle de vie

- **Désignation** : partie complète → bloc « Score en direct » dans le lobby, bouton
  « Je scorerai ce match ». Premier volontaire = scoreur, stocké dans
  `open_games.live_scorer_id` (colonne nullable ajoutée — seul impact sur l'existant).
  Désistement et remplacement possibles. Badge ⌚ à côté des joueurs avec montre connue.
- **Démarrage** : fenêtre H−15 min → H+2 h. Le scoreur tape « Démarrer le score en
  direct » → session `live`, équipes figées (ajustables sur l'écran de démarrage si
  partenaire changé sur le terrain), notification aux 3 autres.
- **Reprise du rôle** : RPC `take_over_scoring` → event `scorer_changed`, bannière chez
  tous, l'ancien devient lecteur. Aucune validation requise.
- **Abandon** : bouton « Annuler le suivi live » → `abandoned` ; les jeux saisis
  pré-remplissent `score-entry` (brouillon). Filet : cron passe `abandoned` toute session
  `live` de plus de 6 h.
- **Feature flag** : clé `app_config.live_scoring_enabled` (défaut `false`), toggle dans
  le Panel Arbitre (même mécanique que `defi_promotion_window_minutes`), lecture cachée
  côté client. Éteint → bloc lobby invisible, aucune session ne démarre, app identique à
  aujourd'hui. Permet de livrer éteint, tester en réel, puis ouvrir.

## 5. Écrans

**Écran scoreur** (`app/live/[sessionId].tsx`, plein écran, keep-awake actif) :
- Scoreboard en haut : sets terminés + set courant, gros (`Fonts.welcome`), prénoms des équipes.
- Deux énormes boutons pleine largeur « 🎾 Jeu Karim/Mina » / « Jeu Ali/Sara » (jamais
  « équipe 1/2 »). Tap = jeu marqué + retour haptique. Set gagné automatiquement à 6 jeux
  avec 2 d'écart ; tie-break à 6-6 saisi comme un jeu normal (7-6).
- Discrets en bas : ↩︎ Annuler (répétable), pastille ⚠️ contestations, menu ⋯ (terminer
  maintenant, annuler le suivi).

**Écran lecteur** (même route, rendu selon rôle) : scoreboard lecture seule, badge
« EN DIRECT », micro-animation à chaque jeu, actions « Contester ce score » et
« Reprendre le score ». Accès via badge « 🔴 LIVE » sur la carte du match
(`<MatchCard>`, source de rendu unique — cf. lib/matchView).

## 6. Contestation et fin de match

**Contestation (lecteur)** : choix du jeu fautif (dernier, ou liste du set courant) →
event `contest{target_seq}`. Aucune interruption. Le scoreur voit la pastille et, sur le
jeu visé : « Corriger » (undo + re-saisie → `contest_resolved`) ou « Maintenir » (reste
ouvert). Le contestant peut retirer sa contestation.

**Fin détectée** : 2 sets gagnés (ou set décisif supplémentaire) → écran de fin scoreur :
« Victoire Karim/Mina — 6-3 · 6-4 » avec **Valider** · **Continuer un set** (fun) ·
↩︎ Annuler. Garde-fou réutilisé : pas de vainqueur net (ex. 2-2 après set fun) → proposer
un set décisif ou revenir au score d'avant.

**RPC `finalize_live_session`** (transactionnelle, idempotente) :
1. Session → `finished` (+ event).
2. Payload `matches` **identique à celui de `score-entry`** : `winner_id`/`winner_id_2`/
   `loser_id`/`loser_id_2` depuis les équipes, `score_text` même format, `game_id`,
   `game_format`, `is_challenge`, `stake_multiplier`, `created_by = scorer`.
3. `contest_count = 0` → ELO immédiat par le chemin existant : le trigger
   `trg_distribute_elo_on_validate` (migration `elo_on_validate.sql`) ne s'exécute que sur
   **UPDATE** basculant `status` vers **`validated`** — la RPC insère donc la ligne en
   `pending` puis la passe à `validated` dans la même transaction (jamais dupliquer la
   logique ELO). Sinon (`contest_count > 0`) → la ligne reste `pending` (validation 24 h,
   contre-proposition, litige : flux actuel inchangé, qui ignore tout du live).
4. `open_games` → `closed`, notification aux 4.

## 7. Cas limites

- **Réseau faible au terrain** (cas réel n°1) : scoreur = unique écrivain ⇒ offline-first
  sans conflit. Tap appliqué localement (reducer client) + file locale rejouée dans
  l'ordre via RPC au retour du réseau. Lecteurs : score figé + « dernière mise à jour il y
  a X min », jamais un score faux.
- **App tuée / redémarrage** : session `live` me concernant → bannière « Match en cours »,
  écran reconstruit depuis le serveur.
- **Course entre scoreurs** : RPC vérifie `scorer_id` à chaque événement ; événement de
  l'ancien rejeté proprement, son écran bascule lecteur.
- **Undo à cheval sur un set** : rejeu du journal ⇒ le set se rouvre naturellement.
- **Doublon live / post-match** : partie avec session `live` masquée de `score-entry`
  (remplacée par « Score en direct en cours ») ; session `finished` a déjà fermé la partie.

## 8. Tests

- **`lib/liveScore.ts`** : module pur `événements → score`, tests unitaires exhaustifs
  (jeu, sets 6-4/7-5/7-6, undo en cascade, set fun, 2-2 sans vainqueur, reprise scoreur).
- **⚠️ Risque de désynchro** : la même logique de rejeu existe en SQL (RPC) et en TS
  (optimistic UI + offline). Même vigilance que `lib/elo.ts` ↔ SQL : toute modification
  doit toucher les deux, et les tests TS servent de référence.
- **RPC** : non-scoreur rejeté, `seq` strictement croissant, `finalize` idempotente
  (double-tap = une seule ligne `matches`).
- **Protocole manuel à deux téléphones** (scoreur + lecteur) avant d'allumer le flag.

## 9. Livraison et phases suivantes

**Ordre de livraison (Phase 1, flag éteint)** : migration SQL (tables + RPC + RLS + clé
`app_config`) → `lib/liveScore.ts` + tests → bloc lobby → écran live → finalisation +
notifs → toggle admin → test réel → activation.

**Phases ultérieures (hors de cette spec, dans l'ordre de valeur/coût)** :
- **Notification-télécommande Android** : notif avec boutons d'action (mécanique validée
  par le spike `watch-test`) — sert les scoreurs Android et leurs montres
  (Galaxy Watch/Wear OS, Garmin appairée à un Android).
- **Live Activity iOS** (boutons interactifs iOS 17+) : LA surface iPhone — dès que le
  compte Apple Organization est débloqué.
- **App Garmin Connect IQ autonome** (Monkey C, store Garmin — non bloqué par Apple) :
  saisie au poignet pour la config iPhone + Garmin ; parlerait directement à Supabase via
  `makeWebRequest` (proxy Garmin Connect) ; l'authentification (appairage par code court)
  sera un design à part entière.

**Nettoyage préalable** : supprimer le spike (`app/watch-test.tsx` + entrée « Test montre
(spike) » de `ProfileMenuSheet`).
