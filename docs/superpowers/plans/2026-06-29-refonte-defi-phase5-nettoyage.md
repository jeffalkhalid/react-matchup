# Refonte Défi 2v2 — Phase 5 : Nettoyage de l'ancien modèle `challenges` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Retirer les derniers usages de l'ancienne table/lib `challenges` (1v1) : remplacer la source de notifs « défi reçu » par le nouveau modèle (invitations binôme = `defi_applications`), supprimer les écritures `challenges` mortes du lobby, et supprimer `lib/challenges.ts`. La **table reste dormante** (pas de DROP).

**Architecture:** Le centre de notifications (`lib/notifications.ts`) lit encore `challenges` pour fabriquer les items « défi reçu ». On bascule cette source sur `defi_applications` (invitations où je suis le partenaire `pending`). Les deux `challenges.update` du lobby (réflexion accept/decline d'un ancien défi) deviennent des no-op et sont retirés. Plus aucun importeur → on supprime `lib/challenges.ts`.

**Tech Stack:** React Native / Expo (TS), Supabase. Vérif = `npx tsc --noEmit`.

## Global Constraints

- **Table `challenges` laissée DORMANTE** : aucune migration, aucun `DROP`. On arrête juste de la lire/écrire (décision de design : réversible).
- **Parité de la cloche** : le total de la cloche est `items.length` de `buildNotificationItems` (source unique, cf. mémoire). En remplaçant la source, le NOUVEL item « invitation binôme » doit s'intégrer dans la même liste (même forme d'item) pour ne pas casser le compteur.
- **`defi_applications`** : invitations binôme = lignes où `partner_id = playerId` ET `status = 'pending'`. RLS déjà en place (Phase 1).
- **Routing** : l'item d'invitation binôme route vers le hub Défi (`/(tabs)/matchmaking`), comme l'ancien item « défi reçu ».
- **Ne pas régresser** les autres items de la cloche (invitations partie, scores à valider, badges, trophées, DM…) — on ne touche QUE la branche `challenges`.

---

### Task 1 : `lib/notifications.ts` — source défi = `defi_applications`

**Files:**
- Modify: `react-matchup/lib/notifications.ts`

**Interfaces:**
- Consumes: table `defi_applications`.
- Produces: items de cloche « invitation binôme » à la place des items « défi reçu » 1v1 ; plus aucune dépendance à `lib/challenges`.

- [ ] **Step 1 : Remplacer la requête `challenges` du `Promise.all`**

Dans `react-matchup/lib/notifications.ts`, la 1ʳᵉ requête du `Promise.all` (~ligne 66-71) lit `challenges`. La remplacer par une requête `defi_applications` (invitations binôme pour moi, en attente) :

```ts
    supabase
      .from('defi_applications')
      .select('id, initiator:initiator_id(name)')
      .eq('partner_id', playerId)
      .eq('status', 'pending'),
```

Et renommer la variable déstructurée (~ligne 55) `{ data: challenges }` → `{ data: binomeInvites }` (garder la MÊME position dans le tuple).

- [ ] **Step 2 : Remplacer la construction des items**

Dans `react-matchup/lib/notifications.ts` (~lignes 254-265), remplacer le bloc qui mappe `challenges` (avec `isReceivedChallengeVisible`) par :

```ts
    ...(binomeInvites ?? []).map((a: any) => ({
      id: `binome-${a.id}`,
      type: 'challenge' as const,
      title: 'Invitation binôme',
      subtitle: `${a.initiator?.name ?? '?'} veut relever un défi avec toi`,
      route: '/(tabs)/matchmaking',
    })),
```

(plus de filtre `isReceivedChallengeVisible` : la requête `defi_applications` est déjà filtrée `partner_id`+`status='pending'`, et la RLS garantit la visibilité.)

- [ ] **Step 3 : Retirer l'import de `lib/challenges`**

Supprimer la ligne (~4) :
```ts
import { isReceivedChallengeVisible, CHALLENGE_PARTICIPANTS_SELECT } from './challenges';
```
Vérifier qu'aucune autre référence à `isReceivedChallengeVisible` / `CHALLENGE_PARTICIPANTS_SELECT` ne subsiste dans le fichier (mettre à jour le commentaire ~255 qui mentionnait `lib/challenges`). `nowIso` n'est plus utilisé par cette requête — le retirer SEULEMENT s'il n'est plus utilisé ailleurs dans la fonction (vérifier ; sinon le garder).

- [ ] **Step 4 : Typecheck** — `cd react-matchup && npx tsc --noEmit` → zéro erreur.

- [ ] **Step 5 : Commit**
```bash
git add react-matchup/lib/notifications.ts
git commit -m "refactor(defi): cloche — source défi = defi_applications (invitations binôme) au lieu de challenges"
```

---

### Task 2 : Lobby — retirer les écritures `challenges` mortes

**Files:**
- Modify: `react-matchup/app/(tabs)/lobby.tsx`
- Modify: `react-matchup/lib/games.ts` (commentaire seulement)

**Interfaces:** aucune (suppression de code mort).

- [ ] **Step 1 : Retirer le reflet `challenges` dans `handleAcceptInvitation`**

Dans `react-matchup/app/(tabs)/lobby.tsx` (~ligne 2499-2507), supprimer le bloc :
```ts
    // Si cette invitation est un défi, refléter la réponse sur la table
    // `challenges` (sinon le défi reste 'pending' ...). No-op si ce n'est pas un défi.
    await supabase
      .from('challenges')
      .update({ status: 'accepted' })
      .eq('game_id', gameId)
      .eq('challenged_id', player.id)
      .eq('status', 'pending');
```
(Le nouveau modèle gère la publication via le trigger `draft→open` — ce reflet est mort.)

- [ ] **Step 2 : Retirer le reflet `challenges` dans `handleDeclineInvitation`**

Dans `react-matchup/app/(tabs)/lobby.tsx` (~ligne 2537-2543), supprimer le bloc analogue :
```ts
    // Refléter le refus sur la table `challenges` (no-op si ce n'est pas un défi).
    await supabase
      .from('challenges')
      .update({ status: 'declined' })
      .eq('game_id', gameId)
      .eq('challenged_id', player.id)
      .eq('status', 'pending');
```

- [ ] **Step 3 : Nettoyer le commentaire de `lib/games.ts`**

Dans `react-matchup/lib/games.ts` (~ligne 63), le commentaire mentionne `isReceivedChallengeVisible` (ancien modèle). L'ajuster ou le retirer pour ne plus référencer l'ancien défi (changement cosmétique, pas de code).

- [ ] **Step 4 : Vérifier qu'aucune lecture/écriture `challenges` ne subsiste**

Run : `grep -rn "from('challenges')\|from(\"challenges\")" "app/(tabs)/lobby.tsx"` → attendu : aucune.

- [ ] **Step 5 : Typecheck + Commit**
```bash
cd react-matchup && npx tsc --noEmit
git add react-matchup/app/(tabs)/lobby.tsx react-matchup/lib/games.ts
git commit -m "refactor(defi): retrait des écritures challenges mortes (accept/decline) du lobby"
```

---

### Task 3 : Supprimer `lib/challenges.ts`

**Files:**
- Delete: `react-matchup/lib/challenges.ts`

**Interfaces:** aucune (plus aucun importeur après Task 1).

- [ ] **Step 1 : Confirmer zéro importeur**

Run : `grep -rn "lib/challenges\|from './challenges'\|from '../../lib/challenges'\|isReceivedChallengeVisible\|CHALLENGE_PARTICIPANTS_SELECT" app/ hooks/ lib/ components/` → attendu : aucune référence d'import/usage (hors d'éventuels commentaires déjà nettoyés). Si une référence subsiste, NE PAS supprimer — la corriger d'abord et le signaler.

- [ ] **Step 2 : Supprimer le fichier**

```bash
git rm react-matchup/lib/challenges.ts
```

- [ ] **Step 3 : Typecheck** — `cd react-matchup && npx tsc --noEmit` → zéro erreur (preuve qu'aucun importeur ne restait).

- [ ] **Step 4 : Commit**
```bash
git commit -m "chore(defi): suppression de lib/challenges.ts (ancien modèle 1v1, table laissée dormante)"
```

---

## Self-review (Phase 5)

- **Couverture** : source cloche basculée sur `defi_applications` (Task 1) ✓ ; écritures `challenges` mortes du lobby retirées (Task 2) ✓ ; `lib/challenges.ts` supprimé (Task 3) ✓ ; table laissée dormante, aucun DROP ✓ ; compteur cloche reste `items.length` (l'item binôme reste un item de la même liste) ✓.
- **Risque** : Task 1 touche la source unique du compteur de cloche → vérifier que le nouvel item s'intègre dans le même `return [ ... ]` que les autres (même niveau de spread). Ne pas casser les autres items. Le `nowIso` orphelin : ne retirer que s'il n'est plus référencé.
- **Hors périmètre** : DROP de la table `challenges` (volontairement différé) ; notifs défi serveur (créateur-publish, binômes rejetés) = Phase 4b/webhook future ; feature « binômes ouverts aux défis ».

## Runbook Phase 5

Aucune migration. Rebuild app. La table `challenges` reste en base (dormante) — purge/DROP éventuel plus tard.
