# Binômes ouverts aux défis + défi ciblé — Design

**Date** : 2026-06-29
**Branche** : `feature/refonte-defi`
**Statut** : design validé, prêt pour le plan d'implémentation
**Prérequis** : la refonte défi 2v2 (Phases 1-6) est en place et live (modèle ouvert : `open_games is_challenge`, `defi_applications`, RPC `defi_apply`/`defi_accept`, mise ELO, `cancel_defi`).

## Contexte & vision

Le modèle actuel est **ouvert** : je poste un défi (mon binôme) → n'importe quel binôme éligible le relève (course). Cette feature ajoute le **sens inverse** : des binômes se déclarent **« ouverts aux défis »** (vitrine), et on peut les **défier nommément** (défi ciblé), sans passer par une course.

Deux briques neuves qui se complètent :
1. **Binôme en vitrine** — une paire déclarée (nomination + confirmation), éphémère, affichée tant qu'elle n'est pas fermée, pour être découverte et défiée.
2. **Défi ciblé** — un défi où l'adversaire est **désigné d'office** (le binôme en vitrine), au lieu d'être ouvert à la course.

## Décisions produit (verrouillées)

- **Binôme en vitrine = nomination unilatérale + confirmation** (pas d'entité « équipe » durable). `player_a` nomme `player_b` ; `player_b` confirme.
- **Fermeture manuelle** par l'un des deux membres (pas de TTL). **Auto-fermeture** de la paire qui entre dans un défi **confirmé**.
- **Plusieurs vitrines par joueur** simultanément (je peux être « ouvert » avec X, Y, Z). Unique par **paire** (pas deux vitrines pour le même couple).
- **Défi ciblé = les 4 joueurs nommés**, **les deux membres du binôme ciblé doivent accepter** (consentement à la date/club/mise), + mon propre partenaire. Confirmé à **4/4**.
- **Pas de plancher/plafond** sur un défi ciblé (les deux binômes sont choisis → l'éligibilité niveau ne s'applique pas).
- **Refus → conversion** : si un membre du **binôme ciblé** décline → le défi **bascule en défi ouvert** (« à relever »). Si **mon propre partenaire** décline → le défi est **annulé** (mon binôme s'effondre, rien à rouvrir).
- **Plafond à la conversion** = **plancher + 1.5 niveau** (plancher = moyenne de ma paire).

## Modèle de données

### Nouvelle table `showcase_binomes`

```
id          uuid PK default gen_random_uuid()
player_a    uuid NOT NULL → players(id) ON DELETE CASCADE   -- le nominateur
player_b    uuid NOT NULL → players(id) ON DELETE CASCADE   -- l'invité
status      text NOT NULL default 'pending'  CHECK IN ('pending','active','closed')
created_at  timestamptz NOT NULL default now()
resolved_at timestamptz                                     -- confirmation ou fermeture
```

- Index sur `(status)` et sur `(player_a)`, `(player_b)` pour la vitrine et les vues « mes binômes ».
- **Unicité par paire non ordonnée** : contrainte pour empêcher deux vitrines actives/pending pour le même couple `{a,b}` (ex. index unique sur `least(a,b), greatest(a,b)` filtré `status IN ('pending','active')`).
- **RLS** : lecture des `active` par tous (vitrine publique) ; lecture des `pending` par les 2 membres ; écriture via RPC `SECURITY DEFINER` uniquement.

### `open_games` — colonne ajoutée

| Colonne | Type | Rôle |
|---|---|---|
| `is_targeted` | `boolean NOT NULL DEFAULT false` | défi ciblé (adversaire nommé) ; jamais dans « À relever », pas de draft→open, pas de bande |

Un défi ciblé : `is_challenge=true`, `is_targeted=true`, 4 `game_participants` invités, `stake_multiplier` posé, `min_elo/max_elo` NULL (pas de bande).

## Flux

### 1. Déclarer un binôme en vitrine (depuis le profil)

- Sur **mon profil (vue self)** : « M'ouvrir aux défis avec… » → choisir un partenaire `X`.
- RPC `showcase_open(p_partner_id)` → insère `showcase_binomes(player_a=moi, player_b=X, status='pending')` (refuse si une vitrine active/pending existe déjà pour ce couple). Notifie `X`.
- `X` confirme (depuis une notif / sa liste d'invitations) → RPC `showcase_confirm(p_id)` → `status='active'` → apparaît dans la vitrine.
- L'un des deux ferme quand il veut → RPC `showcase_close(p_id)` → `status='closed'`.
- Ma liste de vitrines (actives + en attente) est visible sur mon profil ; je peux les fermer.

### 2. Défier un binôme en vitrine (depuis le hub)

- Hub Défi → section **« Binômes ouverts »** → un binôme actif `A & X` → « Défier ce binôme ».
- Ouvre le **`CreateWizard` en mode Défi CIBLÉ** : Team B **pré-remplie et verrouillée** avec `A & X` ; je choisis/confirme **mon partenaire** (Team A) ; je pose **date, club, mise** ; **pas de curseur de plafond** (pas de bande).
  - Mon partenaire peut être choisi ad-hoc OU être un binôme que j'ai moi-même en vitrine (dans les deux cas il est invité et devra accepter — décision « les deux acceptent »).
- Publication → `open_games(is_challenge=true, is_targeted=true, stake_multiplier, min_elo=NULL, max_elo=NULL)` + 4 `game_participants` : moi (`A_GAU`, accepted), mon partenaire (`A_DRO`, invited), `A` (`B_GAU`, invited), `X` (`B_DRO`, invited).
- **Pas de statut `draft`/`open`** au sens vitrine : le défi ciblé est directement « en attente d'acceptations » et **invisible dans « À relever »** (grâce à `is_targeted=true`).

### 3. Confirmation

- Les **3 invités acceptent** (mon partenaire + A + X) via le flux d'invitation existant (lobby « À venir » / notifs) → à **4/4 accepted**, `open_games.status='confirmed'`.
- À la confirmation : **auto-fermeture** des `showcase_binomes` correspondant aux paires engagées (celle de `A & X`, et la mienne si je défiais depuis ma propre vitrine) → `status='closed'`.
- Anti-chevauchement ±2h : s'applique aux 4 joueurs (triggers existants).

### 4. Refus → conversion ou annulation

Déclenché quand un invité passe `declined` sur un défi `is_targeted` :

- **Décline = A ou X (Team B)** → **conversion en défi ouvert** :
  - `is_targeted=false`, retrait des 2 `game_participants` Team B (A & X),
  - `min_elo = padelLevelToElo(moyenne de niveau de ma paire)`, `max_elo = padelLevelToElo(plancher_niveau + 1.5)`,
  - `status='open'` → apparaît dans « À relever » (course de binômes classique).
- **Décline = mon partenaire (Team A)** → **annulation** : `status='cancelled'` (mon binôme est incomplet, rien à rouvrir). Réutilise l'esprit de `cancel_defi`.

Implémentation : un trigger `game_participants AFTER UPDATE` (statut → `declined`) qui, pour un défi `is_targeted`, applique la règle selon le `team_side` du déclineur (A_* → annuler, B_* → convertir). Réutilise le pattern des triggers existants (`fn_publish_defi_on_partner_accept`).

## Surfaces UI

- **Profil (self)** — `PlayerProfile` en mode self : action « M'ouvrir aux défis avec… » + une liste « Mes binômes ouverts » (actifs + en attente) avec bouton « Fermer ». Le partenaire nommé voit une **invitation à confirmer** (notif + point d'entrée).
- **Hub Défi** — nouvelle **5ᵉ section « Binômes ouverts »** : liste des `showcase_binomes` actifs (paires A & X), avec « Défier ce binôme » → ouvre le wizard en mode ciblé. (On exclut mes propres binômes de la vitrine « à défier ».)

## Réutilisé vs neuf

- **Réutilisé** : `open_games`, invitations `game_participants` (invited→accepted), saisie de score, ELO ×mise, `cancel_defi`, notifications (`notifyPlayers`/`send-push`), `CreateWizard` (mode Défi étendu).
- **Neuf** : table `showcase_binomes` + RPC (`showcase_open`/`confirm`/`close`), colonne `is_targeted`, mode « ciblé » du wizard (Team B verrouillée + pas de bande), trigger de conversion/annulation au refus, trigger d'auto-fermeture des vitrines à la confirmation, section vitrine (hub) + toggle profil, notifs dédiées.

## Notifications

- Nomination → notif au partenaire nommé (« X veut être ton binôme ouvert aux défis »).
- Défi ciblé créé → notifs aux 3 invités (mon partenaire + A + X).
- Conversion au refus → notif au créateur (« ton défi ciblé a été refusé, il est maintenant ouvert à tous »).
- Confirmation 4/4 → notif aux 4 (réutilise `notifyDefiConfirmed`).

## Hors périmètre (YAGNI)

- Entité « équipe » persistante / ELO d'équipe : toujours écartée.
- TTL automatique des vitrines : non (fermeture manuelle + auto-fermeture à la confirmation seulement).
- Défi ciblé vers un binôme **non** en vitrine (défier une paire arbitraire) : non — on ne défie que des binômes déclarés ouverts.

## Risques & points d'attention

- **Conversion au refus** : bien distinguer le `team_side` du déclineur (A → annuler, B → convertir) et poser la bande de niveau uniquement à la conversion. Tester les deux chemins.
- **Bande à la conversion** : `min_elo` = moyenne de niveau de ma paire (comme le défi ouvert), `max_elo` = plancher + 1.5 niveau — attention à la contrainte `open_games_defi_stake_chk` (elle ne contraint que le stake, pas la bande, donc OK).
- **Unicité par paire** : empêcher les doublons de vitrine sur le même couple ; gérer le cas où B a déjà une vitrine pending avec A.
- **Auto-fermeture** : ne fermer QUE les vitrines des paires réellement engagées dans le défi confirmé (pas les autres vitrines des mêmes joueurs).
- **Wizard mode ciblé** : Team B verrouillée + masquage du curseur de plafond + `is_targeted=true` à l'insert — sans casser le mode Défi ouvert existant ni les parties normales.
