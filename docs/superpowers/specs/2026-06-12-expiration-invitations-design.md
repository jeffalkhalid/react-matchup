# Expiration & retrait des invitations à une partie — Design

> PAG MATCH (react-matchup) · 2026-06-12
> Statut : design validé en brainstorming, en attente de relecture avant plan d'implémentation.

## 1. Problème

Une invitation à une partie (`game_participants.status = 'invited'`) **n'a aujourd'hui aucun délai** : un invité qui ne répond jamais **occupe une place indéfiniment**. `freeSpots()` compte un `invited` comme occupant ([lobby.tsx:57](../../../app/(tabs)/lobby.tsx#L57)), donc la place reste bloquée. Préjudices confirmés (les quatre comptent) :

1. **Place bloquée (liquidité)** — d'autres joueurs ne peuvent pas prendre la place.
2. **Partie incomplète à l'heure J** — l'invité peut ne jamais confirmer, partie bancale au dernier moment.
3. **Créateur sans contrôle** — l'organisateur ne peut ni retirer ni remplacer l'invité.
4. **Mauvaise expérience invité** — invitation fantôme / re-proposée en boucle.

> À ne pas confondre avec les **défis** (`challenges`), qui ont déjà un TTL de 7 j (`expires_at`), mais « mou » (filtré côté client). Voir mémoire `project_challenges_expiry`.

## 2. Objectif

Donner **deux leviers complémentaires** pour qu'une invitation qui traîne libère sa place :

- **Retrait manuel** par le créateur, à tout moment (contrôle immédiat).
- **Filet de sécurité automatique** : l'invitation expire seule si l'invité ne répond pas à temps.

## 3. Règle d'expiration

Une seule date stockée par invitation, `invite_expires_at`, calculée **une fois** par un trigger DB (source de vérité unique, formule non duplicable côté client) :

```
raw = least(now() + interval '48 hours', match_date - interval '6 hours')   -- min des deux bornes
exp = greatest(raw, now() + interval '1 hour')                              -- plancher de grâce
exp = least(exp, match_date)                                                -- plafond = début du match
```

Constantes (**48 h après l'envoi / 6 h avant le match / 1 h de grâce**) : définies **uniquement** dans la fonction trigger.

Comportement aux bornes :

| Quand on invite | Résultat | L'invité a… |
|---|---|---|
| 5 jours avant | `envoi + 48h` | 2 jours |
| 30 h avant (match−6h dans le futur) | `match − 6h` | jusqu'à 6 h avant |
| 3 h avant (match−6h passé) | plancher `envoi + 1h` | 1 h, puis place rouverte (~2 h de backfill) |
| 45 min avant (`envoi+1h` > match) | plafond = début du match | jusqu'au coup d'envoi |

Le **bouton « Retirer » du créateur court-circuite** toujours cette temporisation.

## 4. Architecture : hybride (lecture lazy + cron)

Les deux couches lisent **le même** `invite_expires_at` — elles ne peuvent jamais être en désaccord sur *si* une invitation est expirée, seulement sur *ce qu'elles en font*.

### 4.1 Couche lecture (lazy — effet immédiat)

Une invitation `invite_expires_at < now()` est traitée comme **inexistante** partout où on lit, sans attendre le cron :

- `freeSpots()` : un `invited` expiré **ne compte plus** comme occupant → c'est ce qui rouvre la place ressentie.
- Listes de joueurs présents (GameDetailsSheet, cartes lobby) : invité expiré masqué.
- « À venir » de l'invité : l'invitation expirée n'apparaît plus comme actionnable.
- Requis : les requêtes participants (`GAME_SELECT`, etc.) **ramènent `invite_expires_at`**.

### 4.2 Couche cron (`expire_stale_invitations()`, ~10 min)

Gardée par `pg_extension WHERE extname='pg_cron'` (pattern `cleanup_unconfirmed_accounts.sql`). À chaque tick :

1. sélectionne `status='invited' AND invite_expires_at < now()` ;
2. bascule en `status='expired'` (idempotent : plus jamais resélectionné) ;
3. appelle `free_spot_and_promote(game_id)` (cf. §7) ;
4. si **défi lié** encore `pending` (`challenges.game_id` + `challenged_id`) → `'expired'` ;
5. **pousse la notif** « ⌛ Invitation expirée » à l'invité.

### 4.3 Cohérence des deux couches

Entre l'instant d'expiration et le tick du cron (≤10 min), la place est **déjà libre à l'écran** (lazy) ; l'état terminal `expired`, la notif, la promotion et le cache sont rattrapés au tick suivant. Aucune fenêtre où la place resterait bloquée pour les autres.

## 5. Candidature atomique (`join_game()`)

**Problème résolu** : aujourd'hui rejoindre une partie gate sur le **compteur stocké** `open_games.spots_available` ([lobby.tsx:1853-1878](../../../app/(tabs)/lobby.tsx#L1853-L1878)), pas sur `freeSpots()`. Pendant la fenêtre lazy, l'affichage (dérivé) montre la place libre alors que le compteur stocké est encore en retard → un candidat peut être renvoyé en attente alors que l'écran promettait la place. Pas de surbooking, mais incohérence affichage ↔ réservabilité de ≤10 min.

**Solution** : RPC `join_game(p_game_id, p_side)` `SECURITY DEFINER` qui, en **une transaction** :

- `SELECT … FOR UPDATE` sur la partie (sérialise les candidatures concurrentes) ;
- calcule l'**occupation vivante** = créateur + `accepted` + `invited` **non expiré** ;
- insère le candidat avec le bon statut (`accepted` / `pending` si approbation requise / `waitlist` si plein), en respectant la logique ELO/approbation existante ;
- réconcilie le cache `spots_available`.

Conséquence : `spots_available` devient un **cache d'arrière-plan** (réconcilié par le cron / les RPC), **plus la vérité**. S'aligne sur la mémoire `project_spots_available_drift`.

## 6. Retrait manuel (`withdraw_invitation()`)

- **UI** : dans `GameDetailsSheet`, le créateur voit `invitedPlayers` (`status='invited'`). Action **« Retirer »** (✕ discret) + confirmation.
- **RPC** `withdraw_invitation(p_game_id, p_player_id)` `SECURITY DEFINER` : **vérifie que l'appelant est le créateur** (la RLS `participants_write` actuelle est trop permissive — `FOR ALL TO authenticated USING (current_player_id() IS NOT NULL)` — on ne s'appuie donc pas dessus), puis :
  - `DELETE` la ligne `invited` (silencieux, disparaît en realtime côté invité, ré-invitation possible plus tard) ;
  - répercute le **défi lié** → `declined` ;
  - appelle `free_spot_and_promote(game_id)`.
- **Pas de notif** à l'invité (décision : retrait manuel = silencieux).

## 7. Promotion de la liste d'attente (généralisation)

La promotion auto **existe déjà** mais seulement sur départ d'un **accepté**, et **côté client** ([lobby.tsx:2189-2222](../../../app/(tabs)/lobby.tsx#L2189-L2222)) — donc inaccessible au cron et incohérente avec les nouveaux chemins de libération.

On **extrait** la logique en fonction serveur partagée `free_spot_and_promote(p_game_id)` :

1. promeut le 1er en `waitlist` (par `created_at`) → `accepted`, lui assigne un côté libre, **le notifie** « 🎉 Place libérée — tu es accepté ! » ;
2. sinon → `spots_available + 1`, `status='open'`.

**Tous** les chemins de libération l'appellent : cron (§4.2), retrait manuel (§6), **et** le départ d'un accepté existant (on rebranche `handleLeaveGame` dessus → dé-duplication + fin du drift). Comportement cohérent quelle que soit la cause de la libération.

> **À revisiter ultérieurement** (note utilisateur) : le *critère* de promotion (actuellement premier arrivé par `created_at`). La généralisation v1 réutilise le critère existant tel quel ; son raffinement (ELO, équité, etc.) fera l'objet d'un passage dédié.

## 8. Notifications

| Évènement | Notif à l'invité ? |
|---|---|
| Retrait **manuel** (créateur) | ❌ Silencieux |
| **Expiration auto** (cron) | ✅ « ⌛ Invitation expirée — la partie du [date] s'est faite sans toi » |
| Promotion d'un waitlister (effet de bord) | ✅ « 🎉 Place libérée — tu es accepté ! » (existant) |

**Point d'intégration à valider à l'implémentation** : l'envoi push **depuis SQL**. Concerne **tout chemin serveur qui notifie** — l'expiration (cron) **et** la promotion (`free_spot_and_promote()`, désormais en SQL). Atteindre la fonction Edge `send-push` via `pg_net` (HTTP depuis Postgres) **ou** insérer dans le mécanisme de notif que l'app relit déjà. Seul point infra non tranché ; le reste est du SQL standard. (Aujourd'hui la notif de promotion est côté client via `notifyPlayers` ; la migrer en SQL la fait dépendre de ce même canal.)

## 9. Interactions verrouillées

- **Mécanisme overlap (±2h)** : ne re-propose que les `declined` avec `auto_declined=true`. Un `'expired'` en est exclu **par construction** ; un retrait manuel = ligne supprimée → rien à re-proposer. Aucune collision.
- **L'invité répond avant l'échéance** : `invited` → `accepted`/`declined` ; `invite_expires_at` devient sans effet (ignoré dès `status ≠ 'invited'`).
- **Re-proposition overlap d'une invitation périmée** : masquée par la couche lazy → ne « ressuscite » jamais.

## 10. Cas limites

- `match_date` nulle (ne devrait pas arriver) → trigger se rabat sur `now() + 48h`.
- Partie créée très proche du match → plancher/plafond du §3.
- `pg_cron` non activé → bloc `DO` qui prévient ; `expire_stale_invitations()` appelable à la main.
- Concurrence de candidatures → `FOR UPDATE` dans `join_game()`.
- **`match_date` figée après création** (aucun flux d'édition trouvé). Si une édition est ajoutée plus tard : recalculer `invite_expires_at` via un trigger sur `open_games`. **Hors scope v1.**

## 11. Composants livrables

**SQL (migrations)**
1. `invite_expiry.sql` — colonne `invite_expires_at` ; `CHECK` statut + `'expired'` ; trigger `set_invite_expiry` (BEFORE INSERT/UPDATE) ; fonction `expire_stale_invitations()` ; planif `pg_cron` ~10 min gardée.
2. `free_spot_and_promote.sql` — fonction partagée de §7.
3. `join_game_rpc.sql` — RPC de §5 + `GRANT` à `authenticated`.
4. `withdraw_invitation_rpc.sql` — RPC de §6 + `GRANT`.

**Client (react-matchup)**
5. `freeSpots()` + requêtes participants : ramènent/ignorent `invite_expires_at` (expirés exclus).
6. « À venir » : ignore les invités expirés.
7. `GameDetailsSheet` : bouton « Retirer » → appel `withdraw_invitation()`.
8. Remplacement du chemin de candidature client par `join_game()`.
9. `handleLeaveGame` : rebranché sur `free_spot_and_promote()` (via une RPC `leave_game()` ou en réutilisant la fonction).
10. Carte invité : compte à rebours « expire dans X h » (lecture de `invite_expires_at`).

**Infra**
11. Branchement `expire_stale_invitations()` → `send-push` (cf. §8).

## 12. Vérification

Le repo n'a pas de framework de test JS → gate = **typecheck + SQL + device**.

- **TS** : `tsc` passe (le gate de qualité du projet).
- **SQL** : assertions sur la formule du trigger (match lointain / proche / 3 h avant / 45 min avant / date nulle) ; idempotence de `expire_stale_invitations()` ; concurrence `join_game()` (2 sessions, pas de surbooking) ; `withdraw_invitation()` rejette un non-créateur ; `free_spot_and_promote()` promeut le bon waitlister et notifie.
- **Device (2 appareils, cf. mémoire `project_push_notifications`)** : invitation → expiration (intervalle de test court) → place rouvre + notif reçue ; retrait manuel → disparition silencieuse côté invité ; promotion d'un waitlister → notif reçue.

## 13. Décisions actées (récap)

| Sujet | Décision |
|---|---|
| Mécanismes | Retrait manuel **+** filet auto (les deux) |
| Ancre expiration | `min(envoi+48h, match−6h)`, plancher `envoi+1h`, plafond début du match |
| Déclenchement | Hybride : lecture lazy (instantané) + cron ~10 min (notif/état/cache) |
| Retrait manuel | Silencieux, `DELETE` via RPC vérifiant le créateur |
| Notif invité | Auto-expiration **oui**, retrait manuel **non** |
| Candidature | RPC `join_game()` atomique sur occupation vivante |
| Promotion waitlist | Généralisée v1 via `free_spot_and_promote()` (critère à revisiter) |
| Défi lié | Manuel → `declined`, auto → `expired` |
| `match_date` éditable | Non (hors scope v1) |
| Point ouvert | Invocation `send-push` depuis SQL (`pg_net` vs table de notifs) |
