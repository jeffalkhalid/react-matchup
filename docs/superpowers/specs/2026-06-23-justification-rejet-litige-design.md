# Justifier rejet/litige + infos du match dans « Score à valider »

Date : 2026-06-23

## Objectif

Dans le tunnel de validation des scores, deux améliorations :

1. **Message de justification** joint au rejet (contestation) et au litige, pour que
   l'administrateur dispose du contexte au moment de trancher.
2. **Infos du match** (lieu + date) affichées dans la carte de validation, pour que
   le joueur sache exactement quelle partie il valide.

## Contexte existant

La feuille `PendingValidationSheet` (`app/(tabs)/lobby.tsx`) gère deux cas :

- **validate** — un adversaire a soumis un score (`pending`) : boutons `✅ Valider`
  (→ `validated`) ou `✏️ Contester` (→ navigue vers `score-entry.tsx?matchId=…`
  pour proposer un score alternatif → `counter_proposed`).
- **resolve** — mon score a été contesté (`counter_proposed`, `created_by === moi`) :
  boutons `✅ Accepter leur score` (→ `validated`) ou `⚖️ Maintenir (litige)`
  (→ `disputed`, l'admin tranche dans `app/(tabs)/admin.tsx`).

La colonne `matches.counter_reason` **existe déjà** dans le type `Match`
(`types/index.ts`) et est **déjà affichée** dans la carte litige admin
(`admin.tsx:121`), mais **aucun code ne la remplit** : fonctionnalité à moitié
construite.

Les cartes de validation n'affichent aujourd'hui que le score et les noms des
joueurs. La requête de matches (`lobby.tsx:1741`) embarque déjà
`game:game_id(location, match_date, creator_id)`, et un helper `formatDate(iso)`
existe au niveau module — donc lieu/date sont disponibles sans requête supplémentaire.

## Conception

### 1. Message de justification

**Rejet / contestation** (flux conservé — on propose toujours un score alternatif)

- Dans `score-entry.tsx`, en mode contestation (`contestMatchId` défini), ajouter un
  champ texte **optionnel** « Pourquoi contestes-tu ce score ? » (max ~200 caractères,
  compteur visible).
- Au submit (branche contest de `doSubmit`), écrire ce texte dans
  `matches.counter_reason` (colonne existante, déjà lue côté admin).
- Texte vide → `null`.

**Litige** (bouton « ⚖️ Maintenir (litige) » du cas resolve)

- Nouvelle colonne SQL `matches.dispute_reason text` (distincte de `counter_reason` :
  le contestataire et celui qui maintient son score sont deux personnes avec deux
  raisons différentes).
- Dans `PendingValidationSheet`, taper « Maintenir (litige) » **déroule un mini-champ
  texte inline** (« Explique le désaccord — l'admin tranchera », optionnel, ~200 car.)
  suivi d'un bouton de confirmation, au lieu de déclencher l'action immédiatement.
- `handleResolveDispute` écrit `dispute_reason` (vide → `null`).

**Admin**

- `admin.tsx` : sous l'affichage existant de `counter_reason`, ajouter l'affichage de
  `dispute_reason` (libellé « Litige : … », même style italique). N'apparaît que si
  renseigné.
- `types/index.ts` : ajouter `dispute_reason?: string` à l'interface `Match`.

### 2. Infos du match dans la carte de validation

- Dans **les deux** cartes du `PendingValidationSheet` (cas validate et cas resolve),
  ajouter une ligne d'en-tête : `📍 {game.location} · 📅 {formatDate(game.match_date)}`.
- Affichage conditionnel : si `game` absent ou champs nuls, on masque proprement la
  partie manquante.
- Aucune donnée ni requête supplémentaire (déjà chargées + helper existant).

## Migration SQL

```sql
ALTER TABLE matches ADD COLUMN IF NOT EXISTS dispute_reason text;
```

Fichier versionné dans `react-matchup/sql/`. ⚠️ Migrations appliquées **à la main** en
prod (drift connu) : à passer manuellement. Le code dégrade proprement si la colonne
manque (le champ reste simplement vide / l'update ignoré).

## Hors-scope (YAGNI)

- Type de partie et « qui a soumis » dans la carte de validation (non retenus).
- Refonte du flux de contestation (on conserve la contre-proposition de score).
- Notifications enrichies avec le motif (le push reste générique).
- Rendre les motifs obligatoires (ils restent optionnels des deux côtés).

## Fichiers touchés

- `react-matchup/app/score-entry.tsx` — champ raison contestation → `counter_reason`.
- `react-matchup/app/(tabs)/lobby.tsx` — mini-champ raison litige → `dispute_reason`,
  + lignes lieu/date dans les cartes de validation.
- `react-matchup/app/(tabs)/admin.tsx` — affichage `dispute_reason`.
- `react-matchup/types/index.ts` — `dispute_reason?` sur `Match`.
- `react-matchup/sql/` — nouvelle migration `add_dispute_reason.sql`.
