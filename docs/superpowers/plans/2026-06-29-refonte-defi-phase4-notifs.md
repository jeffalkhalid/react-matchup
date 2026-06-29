# Refonte Défi 2v2 — Phase 4 : Notifications — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Pousser les notifications des événements défi qui n'en envoient pas aujourd'hui : (1) le **partenaire invité à relever** (`defi_apply`) reçoit un push ; (2) à **verrouillage du binôme** (`defi_accept` → `'locked'`), les **3 autres joueurs** sont prévenus que le défi est confirmé.

**Architecture:** Tout en **client-side** via `notifyPlayers` (→ edge function `send-push`), comme le reste de l'app. On centralise la logique dans **`lib/defiNotify.ts`** (helpers réutilisés par le hub et le lobby, DRY). Routing au tap : `data.type='challenge'` ouvre le hub Défi, `data.type='lobby'+gameId` ouvre la partie (routing existant, rien à ajouter).

**Tech Stack:** React Native / Expo (TS), Supabase Edge Functions (`send-push`, déjà déployée). Vérif = `npx tsc --noEmit`.

## Global Constraints

- **`notifyPlayers`** (`lib/notify.ts`) : `notifyPlayers({ playerIds: string[], title: string, body: string, data?: Record<string,string> })`, fire-and-forget (ne throw jamais).
- **Routing au tap** (`usePushNotifications.ts`) : `'challenge'`→hub Défi (`/(tabs)/matchmaking`), `'lobby'`+`gameId`→`/(tabs)/lobby?gameId=…`. Réutiliser ces deux types, NE PAS en inventer.
- **Pas de changement de RPC** : `defi_apply`/`defi_accept` (Phase 1, en prod) restent inchangés. Les notifs sont émises par le client APRÈS l'appel RPC réussi.
- **`DefiApplication`** (lib/defis) embarque `game` (avec `creator_id` + `participants` Team A) et `initiator`/`partner` → assez d'info pour cibler les 3 autres joueurs sans requête supplémentaire.
- **Hors périmètre (assumé)** : notif au créateur quand son partenaire publie le défi (draft→open, événement DB — webhook = plus tard) ; notif aux binômes **rejetés** par la course (nécessite la liste des rejetés côté serveur — `defi_accept` ne la renvoie pas ; à traiter par webhook ou changement de RPC plus tard). Documenté, non bloquant.

---

### Task 1 : Helpers de notification `lib/defiNotify.ts`

**Files:**
- Create: `react-matchup/lib/defiNotify.ts`

**Interfaces:**
- Consumes: `notifyPlayers` (lib/notify), types `DefiApplication` (lib/defis).
- Produces:
  - `notifyPartnerInvitedToRelever(partnerId: string, inviterName: string): void`
  - `notifyDefiConfirmed(app: DefiApplication, accepterId: string): void`

- [ ] **Step 1 : Écrire `lib/defiNotify.ts`**

```ts
// react-matchup/lib/defiNotify.ts
// Notifications des événements défi (émises côté client après un appel RPC réussi).
// Centralise les messages pour que le hub ET le lobby envoient EXACTEMENT les mêmes.
import { notifyPlayers } from './notify';
import type { DefiApplication } from './defis';

// Suite à defi_apply : prévenir le partenaire qu'on l'invite à relever un défi.
// Tap → hub Défi (section « Invitations binôme »).
export function notifyPartnerInvitedToRelever(partnerId: string, inviterName: string): void {
  if (!partnerId) return;
  notifyPlayers({
    playerIds: [partnerId],
    title: '🎾 Invitation binôme',
    body: `${inviterName} veut relever un défi avec toi — accepte pour verrouiller le binôme.`,
    data: { type: 'challenge' },
  });
}

// Suite à defi_accept = 'locked' : prévenir les 3 AUTRES joueurs (créateur + son
// partenaire Team A, + l'initiateur de la candidature Team B) que le défi est
// confirmé. L'appelant (le partenaire qui accepte) est exclu via accepterId.
// Tap → la partie dans le lobby.
export function notifyDefiConfirmed(app: DefiApplication, accepterId: string): void {
  const g = app.game;
  const teamAIds = (g?.participants ?? [])
    .filter(p => (p.team_side ?? '').startsWith('A'))
    .map(p => p.player_id);
  const ids = Array.from(new Set([
    app.initiator_id,
    ...(g?.creator_id ? [g.creator_id] : []),
    ...teamAIds,
  ])).filter(id => !!id && id !== accepterId);
  if (ids.length === 0) return;
  notifyPlayers({
    playerIds: ids,
    title: '✅ Défi confirmé',
    body: 'Le binôme est complet — rendez-vous sur le terrain !',
    data: g?.id ? { type: 'lobby', gameId: g.id } : { type: 'challenge' },
  });
}
```

- [ ] **Step 2 : Typecheck** — `cd react-matchup && npx tsc --noEmit` → zéro erreur.
- [ ] **Step 3 : Commit**
```bash
git add react-matchup/lib/defiNotify.ts
git commit -m "feat(defi): helpers de notification (invitation binôme + défi confirmé)"
```

---

### Task 2 : Brancher les notifs (hub + lobby) + corriger la copie d'invitation créateur

**Files:**
- Modify: `react-matchup/app/(tabs)/matchmaking.tsx`
- Modify: `react-matchup/app/(tabs)/lobby.tsx`

**Interfaces:**
- Consumes: `notifyPartnerInvitedToRelever`, `notifyDefiConfirmed` (lib/defiNotify).

- [ ] **Step 1 : Hub — notifier le partenaire à l'envoi de candidature**

Dans `react-matchup/app/(tabs)/matchmaking.tsx`, importer :
```ts
import { notifyPartnerInvitedToRelever, notifyDefiConfirmed } from '../../lib/defiNotify';
```
Dans `submitRelever` (Task 3b/Task 2), juste après le `await applyToDefi(releverGame.id, partner.id);` réussi (avant/après le toast, mais APRÈS le succès), ajouter :
```ts
      notifyPartnerInvitedToRelever(partner.id, player.name);
```

- [ ] **Step 2 : Hub — notifier les 3 autres au verrouillage**

Dans `handleAcceptBinome` (matchmaking.tsx), après un `res === 'locked'` réussi (avant ou après `fetchData()`), ajouter :
```ts
      if (res === 'locked') notifyDefiConfirmed(app, player.id);
```
(`app` est la `DefiApplication` passée au handler ; `player.id` = l'accepteur.)

- [ ] **Step 3 : Lobby — notifier les 3 autres au verrouillage**

Dans `react-matchup/app/(tabs)/lobby.tsx`, importer `notifyDefiConfirmed` depuis `'../../lib/defiNotify'`. Dans `acceptBinomeFromLobby` (Phase 3b Task 4), après `res === 'locked'`, ajouter `if (res === 'locked') notifyDefiConfirmed(app, player.id);`.

- [ ] **Step 4 : Lobby — corriger la copie d'invitation du partenaire créateur**

Dans `react-matchup/app/(tabs)/lobby.tsx` `handlePublish`, le `notifyPlayers` envoyé aux invités quand `isChallenge` utilise actuellement le texte 1v1 (« ⚡ Tu as été défié ! » / « te défie en duel »). Pour un défi 2v2, le seul invité est le **partenaire** du créateur → remplacer le texte par :
```ts
        title: isChallenge ? '🎾 Invitation à un défi' : '⚡ Invitation reçue',
        body: isChallenge
          ? `${player.name} t'invite comme binôme pour un défi 2v2`
          : `${player.name} t'invite à une partie de padel`,
```
(garder la structure existante du `notifyPlayers` ; ne changer que `title`/`body`.)

- [ ] **Step 5 : Typecheck** — `cd react-matchup && npx tsc --noEmit` → zéro erreur.

- [ ] **Step 6 : Commit**
```bash
git add react-matchup/app/(tabs)/matchmaking.tsx react-matchup/app/(tabs)/lobby.tsx
git commit -m "feat(defi): notifs — partenaire invité à relever + défi confirmé (hub & lobby) + copie invitation binôme"
```

---

## Self-review (Phase 4)

- **Couverture** : partenaire invité à relever notifié (Task 2 Step 1) ✓ ; 3 autres joueurs notifiés au verrouillage, depuis le hub ET le lobby (Steps 2-3) ✓ ; copie d'invitation créateur corrigée 2v2 (Step 4) ✓ ; DRY via `lib/defiNotify.ts` (Task 1) ✓ ; routing au tap réutilise `challenge`/`lobby` (rien de neuf) ✓.
- **Hors périmètre (documenté)** : notif au créateur à la publication (draft→open) et notif aux binômes rejetés par la course → nécessitent un webhook serveur ou un changement de retour de `defi_accept` ; à traiter dans une passe ultérieure (Phase 4b ou via webhooks comme `notify-*` existants).
- **Risque** : s'assurer que `player.name`/`player.id` sont disponibles dans `submitRelever`/`handleAcceptBinome` (ils le sont via `usePlayer`). `notifyPlayers` est fire-and-forget → aucune régression si l'edge function échoue.

## Runbook Phase 4

Aucune migration. `send-push` déjà déployée. Rebuild app. Dépend de Phases 1/2/3.
