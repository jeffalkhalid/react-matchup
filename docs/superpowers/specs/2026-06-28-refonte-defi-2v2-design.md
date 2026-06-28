# Refonte du défi — Défi 2v2 (binôme contre binôme)

**Date** : 2026-06-28
**Branche** : `feature/refonte-defi`
**Statut** : design validé, prêt pour le plan d'implémentation

## Contexte & motivation

Le défi actuel est un **1v1** : depuis l'onglet *Suggestions* du matchmaking, on
« Défie » un joueur suggéré → une ligne `challenges` (challenger/challenged) liée à
une `open_game` → le défié voit le défi dans *Défis reçus*, accepte/décline, rejoint
la partie liée. L'expiration est molle (7 j, filtrée client) et toute une couche de
prédicats de visibilité fragiles a été greffée par-dessus le système de
parties/invitations (`lib/challenges.ts`, badges, notifications).

On repart **propre**. Nouvelle vision : le défi devient **2v2 — un binôme défie un
autre binôme — avec plus de points en jeu** (ELO majoré). L'architecture doit pouvoir
accueillir d'autres **types de défis** plus tard (ex. format compétitif où les
partenaires se greffent après) ; on n'implémente ici que le **défi classique 2v2**.

## Vision produit

- Un **binôme** est une paire **ad-hoc**, créée pour un défi donné. Pas d'entité
  « équipe » persistante. On garde seulement un **historique dérivé** « toi & X : N
  défis ensemble » (calculé à partir des défis joués, pas une table d'équipe).
- Côté défieur : je crée le défi et **j'invite un partenaire précis**. Tant qu'il n'a
  pas accepté, **le défi n'est pas publié**.
- Côté adverse : **course de binômes**. Un joueur postule en invitant son propre
  partenaire ; le binôme ne verrouille la place que lorsque **les deux ont accepté** ;
  **le premier binôme complet rafle les deux places**. Pas d'approbation du défieur.
- **La mise** : le défieur dose le risque avec un **curseur libre ×1.5 → ×3** sur le
  delta ELO. Symétrique (le gagnant gagne plus, le perdant perd plus). L'adversaire
  accepte cette mise en relevant le défi.
- **Éligibilité par niveau** : le binôme candidat doit avoir une **moyenne de niveau**
  comprise entre la **moyenne de la paire créatrice** (plancher) et un **plafond fixé
  par le défieur** (curseur).

## Décisions d'architecture

### 1. Le défi est une `open_game`, pas une entité séparée

Un défi = une `open_game` **2v2** marquée `is_defi`. On **réutilise** l'infrastructure
existante (lobby, saisie de score, anti-chevauchement ±2h, calcul ELO). On n'ajoute
que les champs de défi et la mécanique de candidature-binôme. Raison : le scoring/ELO
existant est robuste ; une entité `defi_matches` autonome dupliquerait beaucoup et
créerait des divergences d'état (l'anti-pattern qu'on cherche justement à éviter).

### 2. Candidature-binôme atomique (la pièce « logique propre »)

Le système d'`open_game` actuel sait remplir des **places individuelles**
(candidatures/promotion par joueur, avec niveau et vote). Il ne sait **pas** verrouiller
**deux places d'un coup en tant que binôme**, ni gérer une course « premier binôme
complet gagne ». On introduit donc un objet explicite :

- Table **`defi_applications`** : `(id, game_id, initiator_id, partner_id, status,
  created_at, resolved_at)`. `status ∈ {pending, locked, rejected, cancelled}`.
- `pending` : l'initiateur a postulé, le partenaire n'a pas encore accepté.
- Quand le partenaire accepte, une **RPC `SECURITY DEFINER`** résout la course
  **atomiquement** : la première candidature à atteindre les deux acceptations passe
  `locked` et **occupe les deux places de Team B** ; toutes les autres candidatures
  `pending` du même défi passent `rejected` (et sont notifiées). Verrou applicatif
  (lock de ligne sur le défi) pour éviter deux binômes lockés en simultané.

### 3. La mise ELO

À la validation du score, le **delta de chaque joueur** est multiplié par
`stake_multiplier` :

```
delta = round( K × (1 − attendu) × antiFarm × marge × stake )
```

- Symétrique : appliqué aux 4 joueurs (gagnants comme perdants).
- **`antiFarm` conservé** : un binôme qui écrase un binôme bien plus faible gagne moins,
  même en défi (anti-farm préservé malgré la mise).
- Autorité = le trigger SQL `fn_distribute_elo_on_validate` (`elo_per_player_k.sql`).
  **Répliquer à l'identique** dans `lib/elo.ts` (le simulateur de l'admin), sinon
  divergence simulateur/réalité.

## Modèle de données

### `open_games` — colonnes ajoutées

| Colonne | Type | Rôle |
|---|---|---|
| `is_defi` | `boolean NOT NULL DEFAULT false` | marque la partie comme défi |
| `stake_multiplier` | `numeric(3,2)` | mise ELO 1.50 → 3.00 (NULL si non-défi) |
| `defi_level_floor` | `numeric` | plancher = moyenne de niveau de la paire créatrice (figé à la création) |
| `defi_level_cap` | `numeric` | plafond de niveau choisi par le défieur |

Contrainte : si `is_defi`, alors `stake_multiplier ∈ [1.5, 3.0]` et
`defi_level_cap ≥ defi_level_floor`.

### `defi_applications` — nouvelle table

```
id           uuid PK
game_id      uuid  → open_games(id) ON DELETE CASCADE
initiator_id uuid  → players(id)
partner_id   uuid  → players(id)
status       text  CHECK (status IN ('pending','locked','rejected','cancelled'))
created_at   timestamptz DEFAULT now()
resolved_at  timestamptz
```

- Index sur `(game_id, status)`.
- RLS : visible par le défieur (créateur du `game`) et par les membres de la
  candidature ; insert/maj via RPC `SECURITY DEFINER` uniquement.

### `challenges` (ancienne table)

**Laissée dormante.** On arrête de l'écrire et de la lire côté client ; pas de `DROP`
immédiat (réversible, sans perte de données). Migration de dépréciation documentée ;
drop optionnel plus tard une fois la refonte éprouvée.

## Cycle de vie

```
[Créateur] crée défi (date, club, mise, plafond) + invite partenaire
        → open_game is_defi=true, statut interne "draft" (NON publié, invisible)
[Partenaire] accepte → statut "open" (publié, visible dans le hub Défi)
             refuse  → défi annulé (open_game supprimée/cancelled)
[Adversaire] postule + invite SON partenaire → defi_applications(pending)
             (plusieurs candidatures pending possibles en parallèle)
[Partenaire adverse] accepte → RPC résout la course :
        1re candidature complète → locked, occupe les 2 places de Team B
        autres pending           → rejected + notifiées
        → open_game à 4/4 → "confirmed"
[Match joué] → saisie de score → validation → ELO ×stake distribué
```

L'état « draft / open / confirmed » s'exprime via les statuts existants d'`open_game`
(on n'invente pas un cycle de vie parallèle) ; `draft` = non publié = exclu des
requêtes du hub tant que le partenaire créateur n'a pas accepté.

## Éligibilité

Un binôme candidat `(a, b)` peut relever un défi ssi :

```
defi_level_floor ≤ moyenne(level(a), level(b)) ≤ defi_level_cap
```

- `defi_level_floor` = `moyenne(level(créateur), level(partenaire créateur))`, figé à
  la création. Exemple : créateur niv. 4 + partenaire niv. 5 → plancher **4.5**.
- `defi_level_cap` = curseur du défieur, contraint `≥ defi_level_floor`.
- Le niveau dérive de l'ELO via `eloToLevel` (échelle existante, saturation niv. 8 à
  ELO 1750). Le filtre s'applique **côté requête** du hub (ne montrer que les défis
  éligibles) **et** est revalidé **côté RPC** au moment du lock (anti-triche / anti-race
  sur un changement d'ELO entre l'affichage et la candidature).

## UI

### Hub Défi (refonte de `app/(tabs)/matchmaking.tsx`)

Trois sections :

1. **Défis ouverts à relever** — uniquement ceux où la moyenne de mon binôme potentiel
   rentre dans `[floor, cap]`. Carte : créateurs, niveau, club, date, mise (×N), places.
   Action « Relever » → choisir mon partenaire → candidature.
2. **Mes défis** — créés/en cours : `draft` (en attente de mon partenaire), `open`
   (publié, candidatures en cours), `confirmed`.
3. **Candidatures reçues** — binômes qui postulent sur mes défis (informationnel ; la
   résolution est automatique = premier binôme complet).

Le 1v1 « Défier depuis Suggestions » est **retiré**.

### Création du défi — formulaire unique, deux portes

Un **seul composant** de création de défi, atteignable depuis :
- le bouton « Lancer un défi » du **hub Défi** ;
- une option « Défi » dans le **⊕Créer / `CreateWizard`** (sans surcharger la logique du
  wizard de partie : l'option route vers le même composant de création de défi).

Champs : club + date (sélecteurs existants réutilisés), **invite partenaire**, **curseur
de mise** (×1.5→×3), **curseur de plafond de niveau** (≥ plancher auto-calculé et affiché).

### Nettoyage

Retrait de `lib/challenges.ts` (prédicats de visibilité), des notifications/badges liés
à l'ancien défi 1v1, et de l'onglet *Défis reçus* version `challenges`. Le compteur de
cloche (`buildNotificationItems`, source unique) est mis à jour pour refléter les
nouveaux événements de défi (partenaire accepte, binôme locké, candidature rejetée).

## Notifications (réutilise le pipeline `send-push` existant)

- Partenaire créateur invité → « X t'invite comme binôme pour un défi ».
- Partenaire créateur accepte → défi publié (info au créateur).
- Mon partenaire (candidature) invité → « X veut relever un défi avec toi ».
- Binôme locké → notifier les 4 joueurs (« Défi confirmé, rendez-vous… »).
- Candidatures rejetées par la course → notifier les binômes perdants.
- Le reste (rappels de match, score à saisir) passe par les pipelines existants
  puisque le défi est une `open_game` normale une fois `confirmed`.

## Hors périmètre (YAGNI / plus tard)

- Les **autres types de défis** (ex. compétitif où les partenaires se greffent après le
  match) : l'architecture les accueille (`is_defi` + champs extensibles) mais on ne les
  code pas maintenant.
- Entité « équipe » persistante, ELO d'équipe, nom d'équipe : explicitement écartés.
- Drop de la table `challenges` : différé.
- Négociation de date/club après acceptation : non — le défieur fixe à la création.

## Risques & points d'attention

- **Atomicité de la course** : la RPC de lock doit verrouiller la ligne `open_games` du
  défi (`SELECT … FOR UPDATE`) pour qu'un seul binôme passe `locked`. Tester deux
  binômes qui complètent quasi-simultanément.
- **Anti-chevauchement ±2h** : un défi est une `open_game` → le trigger
  `eject_overlapping_candidatures` / `block_accepted_overlaps` s'applique aux 4 joueurs.
  Vérifier l'interaction avec le lock binôme (un membre déjà engagé ±2h ailleurs ne doit
  pas pouvoir verrouiller).
- **Revalidation d'éligibilité au lock** : l'ELO peut bouger entre l'affichage et la
  candidature → revérifier `[floor, cap]` dans la RPC.
- **Miroir `lib/elo.ts` ↔ trigger SQL** : la mise doit être appliquée des deux côtés à
  l'identique, sinon le simulateur admin diverge du réel.
- **Compteur de cloche source unique** : router les nouveaux événements via
  `buildNotificationItems` pour ne pas recréer de divergence de comptage.
