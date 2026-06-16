# Message de motivation pour candidature hors-niveau — Design

**Date :** 2026-06-16
**Statut :** Validé (design), à planifier
**Projet :** PAG MATCH (react-matchup, Supabase `icshhobxeppttgayxmba`)

## Problème

Un joueur **hors de la zone de niveau** d'une partie passe en `pending` et n'entre
que par **vote unanime des présents** (mécanisme `approvals`, créateur + acceptés).
Aujourd'hui les votants décident **à l'aveugle** : ils voient un nom, un ELO et un
badge « hors zone », rien de plus. Rien ne permet au candidat de plaider sa cause
(« je joue régulièrement à ce niveau », « c'est mon créneau habituel », etc.).

## Objectif

Permettre à un candidat hors-niveau de joindre, **s'il le souhaite**, un **petit
mot court** à sa candidature. Ce mot s'affiche aux votants tant que la candidature
est en attente, pour les aider à décider. Objectif produit : améliorer le taux
d'acceptation des bons candidats hors-niveau **sans** diluer le filtre de niveau.

## Décisions de cadrage (validées)

1. **Hors-niveau uniquement.** Les joueurs dans-le-niveau sont acceptés
   automatiquement (`accepted`) — un message n'aurait aucun sens. La feuille de
   saisie n'apparaît que pour eux ; le chemin dans-le-niveau ne change pas.
2. **Votants uniquement, éphémère.** Le message est visible par les présents
   (créateur + acceptés) sur la carte d'approbation **tant que la candidature est
   `pending`**. Une fois résolue (`accepted` / `declined` / `expired`), la carte de
   vote disparaît — donc le message disparaît avec, gratuitement. Pas de
   persistance ni d'historique après acceptation.
3. **~140 caractères**, une à deux phrases. Tient proprement sur la carte.
4. **Optionnel et non bloquant.** On peut toujours candidater sans message.
5. **Filtre profanité réutilisé** (`lib/profanity.ts → containsProfanity`, déjà
   utilisé pour les commentaires Communauté), appliqué **côté client avant**
   l'appel RPC : si le texte est rejeté, on bloque l'envoi avec un message clair
   (jamais de candidature silencieusement amputée).

## Définitions

- **Hors-niveau (côté client)** : `getEloFit(game, myElo) !== 'fit'` (lobby.tsx:44).
  Couvre `'close'` **et** `'outside'` — les deux atterrissent en `pending` côté
  serveur (`join_game` : fit = `elo ∈ [min,max]`, sinon `pending`).
- **Présents / votants** : créateur + `game_participants` `accepted`.

## Architecture & composants

### 1. Migration — colonne `game_participants.application_note`

Fichier : `supabase/migrations/application_note.sql`.

```sql
ALTER TABLE game_participants
  ADD COLUMN IF NOT EXISTS application_note text;
```

Additive, nullable, réversible. Renseignée **uniquement** quand le statut attribué
est `pending` (voir RPC) ; `NULL` partout ailleurs.

### 2. RPC `join_game` — nouveau paramètre `p_note`

Fichier : `supabase/migrations/join_game_rpc.sql` (CREATE OR REPLACE).

- Nouvelle signature :
  ```sql
  join_game(p_game_id uuid, p_side text DEFAULT NULL,
            p_join_waitlist boolean DEFAULT false,
            p_note text DEFAULT NULL)
  ```
  Le `DEFAULT NULL` préserve la rétro-compatibilité (anciens appels à 3 args).
- À l'`INSERT`, ajouter la colonne `application_note` avec :
  ```sql
  application_note = CASE WHEN v_status = 'pending'
                         THEN nullif(left(trim(p_note), 140), '')
                         ELSE NULL END
  ```
  Le `left(...,140)` est un garde-fou serveur ; le `nullif(...,'')` évite de
  stocker une chaîne vide ; la vraie limite UX est côté client.
- `GRANT EXECUTE ON FUNCTION public.join_game(uuid, text, boolean, text) TO authenticated;`
  (l'ancien grant à 3 args reste valable tant que l'ancienne fonction existe ; le
  `CREATE OR REPLACE` change la signature → vérifier qu'il n'y a pas de surcharge
  orpheline. Si Postgres crée une **surcharge** au lieu de remplacer, droper
  explicitement l'ancienne `join_game(uuid, text, boolean)`).

> ⚠️ Ajouter un paramètre **change la signature** : Postgres voit une nouvelle
> fonction (surcharge), il ne remplace pas l'ancienne. Le plan devra
> `DROP FUNCTION IF EXISTS public.join_game(uuid, text, boolean);` avant/après le
> CREATE pour éviter deux fonctions coexistantes. À valider dans le plan.

### 3. Wrapper `lib/games.ts → joinGame()`

- 4e argument optionnel : `note?: string`.
  ```ts
  export async function joinGame(gameId, side?, joinWaitlist = false, note?): Promise<string>
  ```
  passe `p_note: note ?? null`.
- Le filtre profanité est appliqué **dans `handleApply`** (côté UI, là où on a le
  contexte pour afficher une `Alert`), pas dans le wrapper bas niveau.

### 4. UX de saisie — feuille à la candidature (`lobby.tsx`)

- `handleApply(gameId, joinWaitlist, teamSide)` : avant d'appeler `joinGame`,
  calculer `getEloFit(game, myElo)`.
  - **`!== 'fit'` et candidature normale** (pas waitlist) → ouvrir une **feuille**
    (nouveau composant, ex. `ApplicationNoteSheet`, calqué sur les sheets
    existants) :
    - Titre : « Tu es hors de la zone de niveau — un mot pour convaincre ? (optionnel) »
    - `TextInput` multiline, `maxLength=140`, avec compteur de caractères.
    - Deux actions : **« Envoyer ma demande »** (avec le texte saisi) et
      **« Envoyer sans message »** (note vide). Bouton fermer = annuler la
      candidature.
    - À la validation : si `containsProfanity(note)` → `Alert` « Message non
      autorisé, reformule » et on **ne ferme pas** la feuille. Sinon →
      `joinGame(gameId, teamSide, false, note.trim() || undefined)`.
  - **`=== 'fit'`, ou waitlist** → chemin actuel inchangé, pas de feuille,
    `joinGame(gameId, teamSide, joinWaitlist)`.
- Le reste de `handleApply` (notifs selon `newStatus`, `fetchData`) est inchangé.

### 5. Affichage aux votants — carte d'approbation

- Là où un `pending` est rendu avec son bouton « Valider » (carte d'approbation
  du lobby `handleApprovePending` + détail partie `GameDetailsSheet`), si
  `participant.application_note` est non vide, afficher une bulle/citation sous
  le nom : `💬 « … »` (style discret, italique).
- Étendre la requête de chargement (`GAME_SELECT` / le select des participants)
  pour inclure `application_note`. **Vérifier** que la colonne est bien remontée
  partout où la carte `pending` s'affiche.
- Éphémère « gratuit » : la carte de vote n'existe que pour les `pending`.

### 6. Notification « Nouvelle demande » (aperçu du mot)

Dans `handleApply`, branche `newStatus === 'pending'`, le push existant
« 📋 Nouvelle demande » inclut un aperçu tronqué du mot s'il existe :

```
${player.name} veut rejoindre${loc} — « <note tronquée ~60 car.> »
```

Sinon, message actuel inchangé. Peu coûteux, augmente la valeur de la notif.

## Flux de données

```
joueur tape « Candidater »
        │
        ├─ getEloFit === 'fit' (ou waitlist) → joinGame(...)  [chemin actuel]
        │
        └─ getEloFit !== 'fit' → ouvre ApplicationNoteSheet
                 │  (saisie optionnelle, maxLength 140, compteur)
                 ▼
            « Envoyer » → containsProfanity(note) ?
                 │  oui → Alert, feuille reste ouverte
                 │  non → joinGame(gameId, side, false, note)
                 ▼
            RPC : v_status = 'pending'
                 INSERT ... application_note = pending ? left(trim,140) : null
                 ▼
            push « 📋 Nouvelle demande — « <note> » » aux présents
                 ▼
            carte d'approbation affiche 💬 « note » sous le nom
                 ▼
            vote unanime (approvals) → accepted (carte + note disparaissent)
```

## Cas limites

1. **Message vide / espaces seuls** → `nullif(left(trim(...),140),'')` stocke
   `NULL`, la carte n'affiche pas de bulle. OK.
2. **Profanité** → bloquée côté client avant l'appel ; jamais stockée.
3. **Joueur dans-le-niveau** → jamais de feuille, `application_note` reste `NULL`
   (forcé par le `CASE` serveur même si un `p_note` était passé).
4. **Waitlist** (partie pleine) → pas de feuille (la candidature n'est pas un vote) ;
   `p_note` non transmis. Choix produit : le mot ne sert qu'au vote `pending`.
   Si plus tard un waitlist hors-niveau est converti en `pending`
   (cf. promotion par niveau), il n'aura pas de note — acceptable (YAGNI).
5. **Re-candidature** après `declined`/`expired` → l'`INSERT` (après le `DELETE`
   de la ligne terminale) réécrit une `application_note` fraîche. OK.
6. **Ancien client** (appel 3 args pendant un déploiement progressif) → `p_note`
   prend son `DEFAULT NULL`, aucune régression.

## Tests

Étendre `sql/tests/test_join_game.sql` (transaction `BEGIN … ROLLBACK`) :

1. **Hors-niveau avec note** → ligne `pending`, `application_note` = texte tronqué
   à 140 car.
2. **Hors-niveau note > 140** → stockée tronquée à 140.
3. **Hors-niveau sans note** (`p_note=NULL`) → `pending`, `application_note` `NULL`.
4. **Dans-le-niveau avec `p_note` fourni** → `accepted`, `application_note` `NULL`
   (le `CASE` neutralise la note hors `pending`).
5. **Note = espaces** → `NULL` (via `nullif/trim`).
6. **Appel 3 args** (sans `p_note`) → fonctionne, `application_note` `NULL`.

Côté client : vérif manuelle Expo (la feuille n'apparaît que hors-niveau, compteur,
profanité bloquée, bulle visible sur la carte de vote, push avec aperçu).

## Hors périmètre (YAGNI)

- Pas d'édition du message après envoi.
- Pas de message pour les dans-le-niveau ni la waitlist.
- Pas de persistance/historique après acceptation (éphémère assumé).
- Pas de notif de vote serveur (sujet séparé : promotion par niveau + vote).
- Pas de modération serveur avancée (le filtre client de lancement suffit).
