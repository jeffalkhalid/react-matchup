# Promotion par niveau + vote des présents — Design

**Date :** 2026-06-14
**Statut :** Validé (design), à planifier
**Projet :** PAG MATCH (react-matchup, Supabase `icshhobxeppttgayxmba`)

## Problème

`free_spot_and_promote(p_game_id)` promeut le **premier joueur en liste d'attente
par `created_at ASC`, sans aucun contrôle de niveau** (les bornes `min_elo` /
`max_elo` de la partie sont ignorées). Conséquence : un joueur **hors-niveau**
premier en file est promu automatiquement en `accepted` dès qu'une place se
libère (cron d'expiration, retrait manuel, départ d'un accepté). C'est le
comportement central, pas un cas de bord.

Or la candidature **directe** (`join_game`) applique déjà la bonne règle :
`fit → accepted`, `hors-niveau → pending` (soumis à approbation). La promotion
depuis la file est donc **incohérente** avec la candidature directe.

## Objectif

Aligner la promotion sur la candidature directe : **priorité d'entrée
automatique aux joueurs dans-le-niveau ; un hors-niveau n'entre que par vote
unanime des joueurs présents.**

## Définitions

- **Dans-le-niveau (fit)** : `elo_score ∈ [coalesce(min_elo,0), coalesce(max_elo,9999)]`.
  Règle identique à `getEloFit` (lobby.tsx) et `join_game`.
- **Joueurs présents** : le créateur + tous les `game_participants` `accepted`.
- **Vote** : mécanisme `approvals` **existant** (tableau de `player_id`). Un
  `pending` devient `accepted` quand **TOUS** les présents l'ont approuvé
  (unanimité). Aucune nouvelle mécanique de comptage.
- **Occupation vivante** (`occupiesSpot`) : `accepted` **ou** `invited` non
  expiré. Un `pending` **n'occupe pas** de place.

## Règles (machine à états)

Quand une place se libère dans une partie (`free_spot_and_promote`) :

1. **Chercher le 1er dans-le-niveau en file** (`status='waitlist'`,
   `fit`, tri `created_at ASC`).
   - **Trouvé** → promotion directe `waitlist → accepted`, assignation du côté
     libre (logique d'assignation actuelle conservée). Décrément implicite de la
     place. Notif « 🎉 Place libérée — tu es accepté ».
2. **Aucun dans-le-niveau en file** → la place **rouvre** (`spots_available += 1`,
   `status='open'`, branche `ELSE` actuelle) **ET** tous les hors-niveau en file
   passent `waitlist → pending`. Notif aux **présents** : « 🗳️ Un joueur
   hors-niveau souhaite rejoindre — à valider ».
3. Un `pending` n'occupe pas de place → un joueur dans-le-niveau qui arrive
   pendant un vote (candidature directe) **prend la place instantanément**.
   Priorité absolue, **jamais de gel** de la place par un hors-niveau.
4. Un hors-niveau est accepté **uniquement** par vote unanime. **Sa position en
   file est ignorée** : seuls les votes décident.

## Architecture & composants

### 1. `free_spot_and_promote.sql` (cœur — modifié)

Fichier : `supabase/migrations/free_spot_and_promote.sql` (CREATE OR REPLACE).

- Le `SELECT` du prochain candidat joint `players` et filtre sur le fit :
  ```sql
  SELECT gp.id INTO v_next_id
  FROM game_participants gp
  JOIN players p ON p.id = gp.player_id
  JOIN open_games g ON g.id = gp.game_id
  WHERE gp.game_id = p_game_id
    AND gp.status = 'waitlist'
    AND p.elo_score >= coalesce(g.min_elo, 0)
    AND p.elo_score <= coalesce(g.max_elo, 9999)
  ORDER BY gp.created_at ASC
  LIMIT 1;
  ```
- `IF v_next_id IS NOT NULL` → promotion `accepted` + assignation du côté
  (bloc d'assignation `v_taken` / `v_side` **inchangé**).
- Branche `ELSE` (aucun fit) → comportement actuel (rouvrir la place)
  **+ nouvelle ligne** :
  ```sql
  UPDATE game_participants
    SET status = 'pending'
    WHERE game_id = p_game_id AND status = 'waitlist';
  ```
  (Convertit tous les hors-niveau restants en `pending`. Comme aucun `waitlist`
  n'était fit, cet UPDATE ne touche que des hors-niveau.)
- `SECURITY DEFINER`, `search_path = public`, grants inchangés.

### 2. `join_game` (inchangé)

Aucune modification. Fait déjà `fit → accepted` / `hors-niveau → pending`
(`join_game_rpc.sql:46-54`). Le fait qu'un hors-niveau puisse encore atterrir en
`waitlist` (partie pleine) est sans danger : il ne sera jamais promu par
position (règle 4) et sera converti en `pending` à la réouverture (règle 2).

### 3. `notify-vote-requested` (nouvelle edge function)

La conversion `waitlist → pending` se produit **côté serveur** (RPC appelé par
cron/triggers), donc la notif de vote aux présents ne peut **pas** venir du
client (contrairement à la candidature directe, qui notifie via
`notifyPlayers` dans lobby.tsx).

- Fichier : `supabase/functions/notify-vote-requested/index.ts`, **calqué sur
  `notify-promotion/index.ts`**.
- Déclenché par un **Database Webhook** sur `game_participants` `UPDATE` quand
  `status` passe `waitlist → pending`.
- Charge les présents (`accepted` + créateur) de la partie, POST `send-push`
  avec « 🗳️ Un joueur hors-niveau souhaite rejoindre — à valider ».
- Le webhook doit être créé **à la main dans le dashboard** (Database →
  Webhooks), comme les autres `notify-*`. À documenter dans le runbook de
  déploiement (`docs/DEPLOIEMENT_MAROC.md`).

> Note : les webhooks `game_participants` existent déjà (vérifié 2026-06-14).
> Il faut soit ajouter une condition de routage, soit un webhook dédié ciblant
> `waitlist → pending`. La promotion in-level (`waitlist → accepted`) réutilise
> `notify-promotion` déjà câblé.

### 4. Client (inchangé sur le fond)

L'UI d'approbation (`approvals`, lobby.tsx:2061-2088) gère déjà l'affichage et
le vote sur les `pending`. Aucun écran nouveau requis. Vérifier seulement que
les `pending` issus d'une conversion s'affichent comme les `pending` issus
d'une candidature directe (même requête `GAME_SELECT`, même rendu).

## Flux de données

```
place libérée (cron expire / retrait / départ accepté)
        │
        ▼
free_spot_and_promote(game)
        │
        ├─ 1er waitlist FIT existe ?
        │      OUI → UPDATE status=accepted, assign side
        │             └─ webhook waitlist→accepted → notify-promotion → push « accepté »
        │      NON → spots_available += 1, status='open'
        │             UPDATE tous waitlist → pending
        │             └─ webhook waitlist→pending → notify-vote-requested → push présents « à valider »
        ▼
present players votent (approvals existant)
        │
        └─ unanimité → pending→accepted (re-check place vivante libre) → push « accepté »
```

## Cas limites

1. **Plusieurs hors-niveau convertis en `pending` pour 1 place** : accepté
   (choix produit). Le 1er à obtenir l'unanimité prend la place ; les autres
   restent `pending` (acceptables sur une future place, ou nettoyés à la
   fermeture de la partie). Pas de réservation.
2. **Unanimité obtenue mais place déjà reprise** par un dans-le-niveau entre
   temps → l'acceptation d'un `pending` doit **re-vérifier qu'une place vivante
   est libre** avant de passer `accepted` ; sinon le `pending` reste en attente.
   (Vérifier/renforcer la logique d'acceptation côté lobby.tsx:2061-2088.)
3. **ELO du joueur change** alors qu'il est `pending` (repasse dans-le-niveau) :
   reste soumis au vote, pas de re-bascule auto (simple, YAGNI).
4. **Un hors-niveau déjà `pending` quand une 2e place se libère** : il n'est pas
   re-converti (déjà `pending`) ; l'UPDATE `waitlist → pending` ne le concerne
   pas. OK.
5. **Conversion qui ne touche aucun `waitlist`** (file vide) : UPDATE no-op,
   aucun webhook, aucune notif. OK.

## Tests

Nouveau fichier `sql/tests/test_free_spot_and_promote.sql`, **calqué sur
`sql/tests/test_join_game.sql`** (transaction `BEGIN … ROLLBACK`, fixtures
joueurs/parties, blocs `DO $$ … RAISE EXCEPTION`). Cas :

1. **Promotion saute un hors-niveau** : file = [hors-niveau (créé avant),
   dans-le-niveau (créé après)] → `free_spot_and_promote` promeut le
   **dans-le-niveau** en `accepted`, le hors-niveau reste `waitlist`.
2. **File 100% hors-niveau** → aucun `accepted`, `spots_available` incrémenté,
   `status='open'`, **tous** les hors-niveau passent `pending`.
3. **File 100% dans-le-niveau** → 1er (FIFO) promu `accepted`, les autres
   restent `waitlist` (régression : comportement FIFO conservé pour les fit).
4. **File vide** → branche ELSE, `spots_available` incrémenté, aucun `pending`,
   no-op sur la conversion.
5. **Côté assigné** : la promotion d'un fit assigne un `team_side` libre cohérent
   (réutilise la vérif d'assignation existante).

Lancement : exécuter le fichier SQL dans une transaction sur la base (psql /
SQL editor), attendu `test_free_spot_and_promote: OK` puis ROLLBACK.

## Hors périmètre (YAGNI)

- Pas de majorité / quorum : unanimité réutilisée telle quelle.
- Pas de re-bascule automatique sur changement d'ELO.
- Pas de réservation de place pendant un vote.
- Pas de nouvel écran : l'UI `approvals` existante suffit.
- Pas de refonte du compteur `spots_available` (sujet séparé : drift).
