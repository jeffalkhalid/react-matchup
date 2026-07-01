# Binômes ouverts + défi ciblé — Plan 2 : Client — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Câbler la vitrine et le défi ciblé côté app : couche `lib/showcase.ts`, mode « ciblé » du `CreateWizard` (adversaire pré-rempli + verrouillé, pas de bande, `is_targeted`), section « Binômes ouverts » du hub, déclaration/gestion des vitrines depuis le profil, exclusion des défis ciblés de « À relever », notifs.

**Architecture:** Une couche `lib/showcase.ts` isole l'accès Supabase (vitrine + RPC `showcase_*`). Le défi ciblé réutilise le `CreateWizard` en pré-remplissant Team B via le mécanisme `initialInvites` existant + un flag `targeted` (verrouille Team B, masque le curseur de plafond, pose `is_targeted=true` à l'insert). La vitrine s'affiche dans une 5ᵉ section du hub ; la déclaration + gestion des vitrines se fait depuis le profil (self).

**Tech Stack:** React Native / Expo (TS), Supabase. Vérif = `npx tsc --noEmit`. Backend (Plan 1) supposé appliqué en prod.

## Global Constraints

- **Ne pas toucher aux 6 fichiers WIP de l'utilisateur** (activity/DM/profil en cours) : ne stager que les fichiers listés par tâche.
- **RPC backend (Plan 1)** : `showcase_open(p_partner_id uuid)→uuid`, `showcase_confirm(p_id uuid)→void`, `showcase_close(p_id uuid)→void`. Table `showcase_binomes(id, player_a, player_b, status, created_at, resolved_at)`. `open_games.is_targeted boolean`.
- **Défi ciblé = 4 nommés, pas de bande** : `min_elo/max_elo` NULL, `is_targeted=true`, `stake_multiplier` posé. Team B = le binôme ciblé (B0/B1), Team A = moi (A0) + mon partenaire (A1).
- **`fetchOpenDefis`** (hub « À relever ») doit **exclure** `is_targeted=true`.
- **Wizard** : le mode ciblé n'affecte QUE le type Défi ciblé ; ne casse ni le Défi ouvert ni les parties normales.
- **Notifs** via `notifyPlayers` (réutilise `lib/defiNotify.ts`).

---

### Task 1 : Couche données `lib/showcase.ts`

**Files:**
- Create: `react-matchup/lib/showcase.ts`

**Interfaces:**
- Produces: type `ShowcaseBinome` ; `fetchVitrine(playerId)`, `fetchMyShowcases(playerId)`, `fetchShowcaseInvites(playerId)`, `openShowcase(partnerId)`, `confirmShowcase(id)`, `closeShowcase(id)`.

- [ ] **Step 1 : Écrire `lib/showcase.ts`**

```ts
// react-matchup/lib/showcase.ts
// Couche données UNIQUE de la vitrine « binômes ouverts aux défis ».
import { supabase } from './supabase';

export interface ShowcasePlayer { id: string; name: string; elo_score: number; court_side?: string | null; }
export interface ShowcaseBinome {
  id: string; player_a: string; player_b: string; status: string; created_at: string;
  a?: ShowcasePlayer | null; b?: ShowcasePlayer | null;
}

const COLS =
  'id, player_a, player_b, status, created_at, ' +
  'a:player_a(id, name, elo_score, court_side), b:player_b(id, name, elo_score, court_side)';

// Vitrine publique : binômes ACTIFS que je peux défier (pas les miens).
export async function fetchVitrine(playerId: string): Promise<ShowcaseBinome[]> {
  const { data, error } = await supabase
    .from('showcase_binomes')
    .select(COLS)
    .eq('status', 'active')
    .neq('player_a', playerId)
    .neq('player_b', playerId)
    .order('created_at', { ascending: false });
  if (error) { console.warn('[showcase] fetchVitrine', error); return []; }
  return (data ?? []) as unknown as ShowcaseBinome[];
}

// Mes vitrines (actives + en attente de confirmation de mon partenaire).
export async function fetchMyShowcases(playerId: string): Promise<ShowcaseBinome[]> {
  const { data, error } = await supabase
    .from('showcase_binomes')
    .select(COLS)
    .or(`player_a.eq.${playerId},player_b.eq.${playerId}`)
    .in('status', ['pending', 'active'])
    .order('created_at', { ascending: false });
  if (error) { console.warn('[showcase] fetchMyShowcases', error); return []; }
  return (data ?? []) as unknown as ShowcaseBinome[];
}

// Nominations à confirmer : on m'a proposé d'être binôme (je suis player_b, pending).
export async function fetchShowcaseInvites(playerId: string): Promise<ShowcaseBinome[]> {
  const { data, error } = await supabase
    .from('showcase_binomes')
    .select(COLS)
    .eq('player_b', playerId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) { console.warn('[showcase] fetchShowcaseInvites', error); return []; }
  return (data ?? []) as unknown as ShowcaseBinome[];
}

export async function openShowcase(partnerId: string): Promise<string> {
  const { data, error } = await supabase.rpc('showcase_open', { p_partner_id: partnerId });
  if (error) throw error;
  return data as string;
}
export async function confirmShowcase(id: string): Promise<void> {
  const { error } = await supabase.rpc('showcase_confirm', { p_id: id });
  if (error) throw error;
}
export async function closeShowcase(id: string): Promise<void> {
  const { error } = await supabase.rpc('showcase_close', { p_id: id });
  if (error) throw error;
}
```

- [ ] **Step 2 : Typecheck** — `cd react-matchup && npx tsc --noEmit` → zéro erreur.
- [ ] **Step 3 : Commit**
```bash
git add react-matchup/lib/showcase.ts
git commit -m "feat(vitrine): couche données lib/showcase.ts (vitrine, mes binômes, invitations, RPC)"
```

---

### Task 2 : Exclure les défis ciblés de « À relever »

**Files:**
- Modify: `react-matchup/lib/defis.ts` (`fetchOpenDefis`)

**Interfaces:**
- Consumes: `open_games.is_targeted` (Plan 1).
- Produces: `fetchOpenDefis` ne renvoie que les défis **ouverts non ciblés**.

- [ ] **Step 1 : Ajouter le filtre**

Dans `react-matchup/lib/defis.ts`, dans `fetchOpenDefis`, après `.eq('status', 'open')`, ajouter :
```ts
    .eq('is_targeted', false)
```
(un défi ciblé ne doit jamais apparaître dans « À relever » ; il n'y bascule qu'après conversion, où le trigger a déjà mis `is_targeted=false`).

- [ ] **Step 2 : Typecheck + Commit**
```bash
cd react-matchup && npx tsc --noEmit
git add react-matchup/lib/defis.ts
git commit -m "feat(vitrine): exclure les défis ciblés (is_targeted) de « À relever »"
```

---

### Task 3 : Wizard — mode « ciblé » (Team B verrouillée, pas de bande, is_targeted)

**Files:**
- Modify: `react-matchup/app/(tabs)/CreateWizard.tsx`
- Modify: `react-matchup/app/(tabs)/lobby.tsx` (`handlePublish` + montage du wizard)

**Interfaces:**
- Consumes: `initialInvites` (existant, pré-remplit B0/B1), `WizardResult`.
- Produces: prop `targeted?: boolean` sur `CreateWizard` ; `WizardResult.isTargeted: boolean` ; `handlePublish` insère `is_targeted` et laisse `min_elo/max_elo` NULL en ciblé.

- [ ] **Step 1 : Prop `targeted` + `WizardResult.isTargeted`**

Dans `react-matchup/app/(tabs)/CreateWizard.tsx` :
- Interface `Props` : ajouter `targeted?: boolean;`.
- Signature du composant : `({ ..., initialInvites, targeted }: Props)`.
- Interface `WizardResult` : ajouter `isTargeted: boolean;`.
- Dans l'appel `onPublish({...})` : ajouter `isTargeted: form.gameType === 'Défi' && !!targeted,`.

- [ ] **Step 2 : Verrouiller Team B + sauter l'étape plafond en mode ciblé**

Dans `react-matchup/app/(tabs)/CreateWizard.tsx` :
- En mode ciblé (`targeted && form.gameType === 'Défi'`), l'étape « Mise & plafond » ne montre **que la mise** (pas le curseur de plafond) — envelopper le bloc plafond de `renderDefiSettings` dans `{!targeted && (...)}`.
- Team B est déjà pré-remplie via `initialInvites` (B0/B1). En mode ciblé, **empêcher de la modifier** : dans `renderDefiBinome` (ou l'étape équipe), si `targeted`, afficher les 2 adversaires (lecture seule) et ne pas ouvrir l'invite sur les slots B. (Le mode Défi ouvert ne montre déjà pas Team B ; en ciblé, on l'affiche verrouillée à titre informatif.)
- `defiFloorLevel`/bande : en mode ciblé, **pas de plancher** → à la publication, `minLevel`/`maxLevel` ne doivent pas être posés (voir Step 3, handlePublish gère `isTargeted`).

- [ ] **Step 3 : `handlePublish` (lobby) — insert `is_targeted` + bande NULL en ciblé**

Dans `react-matchup/app/(tabs)/lobby.tsx`, `handlePublish`, l'`insert` `open_games` : ajouter `is_targeted` et rendre la bande conditionnelle :
```ts
        is_challenge: data.gameType === 'Défi',
        is_targeted: data.isTargeted === true,
        stake_multiplier: data.gameType === 'Défi' ? data.stakeMultiplier : 1.0,
        gender_pref: data.genre,
        match_date: matchDateIso,
        location: data.location,
        has_reservation: data.hasReservation,
        min_elo: data.isTargeted ? null : padelLevelToElo(data.minLevel),
        max_elo: data.isTargeted ? null : padelLevelToElo(data.maxLevel),
        status: data.gameType === 'Défi' ? (data.isTargeted ? 'open' : 'draft') : 'open',
        spots_available: 3 - data.confirmedPlayers.length,
```
Note : un défi **ciblé** n'a pas de phase draft/vitrine (les 4 sont nommés d'office) → statut initial `'open'` mais **invisible dans « À relever »** grâce à `is_targeted=true` (Task 2). Il se confirme quand les 3 invités acceptent (4/4). Team B pré-remplie = 2 invités → `confirmedPlayers` contient partenaire + 2 adversaires = 3 → `spots_available = 0`.

- [ ] **Step 4 : Typecheck + Commit**
```bash
cd react-matchup && npx tsc --noEmit
git add react-matchup/app/(tabs)/CreateWizard.tsx react-matchup/app/(tabs)/lobby.tsx
git commit -m "feat(vitrine): mode ciblé du wizard (Team B verrouillée, pas de bande, is_targeted)"
```

---

### Task 4 : Hub — section « Binômes ouverts » (vitrine) + « Défier ce binôme »

**Files:**
- Modify: `react-matchup/app/(tabs)/matchmaking.tsx`

**Interfaces:**
- Consumes: `fetchVitrine` (Task 1), `ShowcaseBinome`.
- Produces: une 5ᵉ section `'vitrine'` + carte `VitrineCard` + `handleDefierBinome`.

- [ ] **Step 1 : État + fetch**

Dans `MatchmakingScreen` : `const [vitrine, setVitrine] = useState<ShowcaseBinome[]>([]);` + import `fetchVitrine, type ShowcaseBinome` de `../../lib/showcase`. Dans `fetchData`, ajouter `fetchVitrine(player.id)` au `Promise.all` et `setVitrine(...)`.

- [ ] **Step 2 : 5ᵉ onglet + section**

Ajouter au tableau d'onglets `{ id: 'vitrine' as Tab, label: 'Ouverts', badge: 0 }` (et étendre `type Tab`). Rendu :
```tsx
{tab === 'vitrine' && (
  vitrine.length === 0
    ? <EmptyCard icon="users" title="Aucun binôme ouvert" sub="Déclare le tien depuis ton profil, ou reviens plus tard." />
    : <View style={{ gap: 10 }}>
        {vitrine.map(sb => <VitrineCard key={sb.id} sb={sb} onDefier={() => handleDefierBinome(sb)} />)}
      </View>
)}
```

- [ ] **Step 3 : `VitrineCard` + `handleDefierBinome`**

Ajouter avant l'export un composant `VitrineCard` (réutilise `PlayerAvatar`, `Pill`, `eloToLevel`, `sty.card`) qui affiche la paire `sb.a` & `sb.b` (avatars + noms + moy. niveau) et un bouton « Défier ce binôme ». Et le handler qui ouvre le wizard en mode ciblé — via navigation vers le lobby avec les 2 adversaires en `initialInvites` :
```ts
  const handleDefierBinome = (sb: ShowcaseBinome) => {
    const a = sb.a, b = sb.b;
    if (!a || !b) return;
    router.push(('/(tabs)/lobby?create=1&challenge=1&targeted=1'
      + `&b0=${a.id}&b0n=${encodeURIComponent(a.name)}&b0e=${a.elo_score}`
      + `&b1=${b.id}&b1n=${encodeURIComponent(b.name)}&b1e=${b.elo_score}`) as any);
  };
```

- [ ] **Step 4 : Lobby — lire les params ciblés → initialInvites + targeted**

Dans `react-matchup/app/(tabs)/lobby.tsx` :
- Étendre `useLocalSearchParams` avec `targeted, b0, b0n, b0e, b1, b1n, b1e`.
- Dans le `useEffect` `create==='1'` : si `targeted === '1'`, poser un état `targetedInvites = { B0: {id:b0,name:b0n,elo_score:Number(b0e)}, B1: {id:b1,...} }` + `openDefiMode=true` + un flag `targetedMode=true`.
- Au montage `<CreateWizard>` : `initialInvites={targetedInvites ?? rematchInvites ?? undefined}`, `targeted={targetedMode}`, et `initialGameType='Défi'` déjà géré par `openDefiMode`.
- Réinitialiser `targetedInvites`/`targetedMode` dans `onClose`/`onPublishedDone`.

- [ ] **Step 5 : Typecheck + Commit**
```bash
cd react-matchup && npx tsc --noEmit
git add react-matchup/app/(tabs)/matchmaking.tsx react-matchup/app/(tabs)/lobby.tsx
git commit -m "feat(vitrine): section « Binômes ouverts » du hub + « Défier ce binôme » (wizard ciblé)"
```

---

### Task 5 : Profil — déclarer / gérer ses binômes + confirmer une nomination

**Files:**
- Modify: `react-matchup/components/profile/ProfileMenuSheet.tsx` (entrée « M'ouvrir aux défis »)
- Create: `react-matchup/components/profile/ShowcaseManager.tsx` (feuille de gestion)

**Interfaces:**
- Consumes: `fetchMyShowcases`, `fetchShowcaseInvites`, `openShowcase`, `confirmShowcase`, `closeShowcase` (Task 1).
- Produces: un point d'entrée profil (self) ouvrant `ShowcaseManager`.

- [ ] **Step 1 : `ShowcaseManager.tsx`**

Créer un composant feuille (Modal/overlay, style maison) qui, pour le joueur courant :
- Liste **mes binômes** (`fetchMyShowcases`) : chaque ligne = partenaire (nom + statut `pending`/`active`) + bouton « Fermer » (`closeShowcase`).
- Liste **mes nominations à confirmer** (`fetchShowcaseInvites`) : « X veut être ton binôme ouvert » + boutons « Confirmer » (`confirmShowcase`) / « Fermer » (`closeShowcase`).
- Un bouton « M'ouvrir aux défis avec… » → recherche joueur (même pattern `players` ilike que le sélecteur de partenaire du hub) → `openShowcase(partnerId)` → toast + refetch.
Réutiliser `PlayerAvatar`, `Colors`, `Fonts`, `Alert`. Erreurs mappées (`showcase already exists` → « Tu as déjà une vitrine avec ce joueur »).

- [ ] **Step 2 : Entrée dans `ProfileMenuSheet`**

Dans `react-matchup/components/profile/ProfileMenuSheet.tsx`, ajouter une entrée de menu « ⚔️ M'ouvrir aux défis » (visible en self) qui ouvre `ShowcaseManager`. (Suivre le pattern des entrées existantes du menu.)

- [ ] **Step 3 : Typecheck + Commit**
```bash
cd react-matchup && npx tsc --noEmit
git add react-matchup/components/profile/ShowcaseManager.tsx react-matchup/components/profile/ProfileMenuSheet.tsx
git commit -m "feat(vitrine): profil — déclarer/gérer ses binômes ouverts + confirmer une nomination"
```

---

### Task 6 : Notifications vitrine

**Files:**
- Modify: `react-matchup/lib/defiNotify.ts`
- Modify: `react-matchup/components/profile/ShowcaseManager.tsx` (Task 5) — notifier à la nomination
- Modify: `react-matchup/app/(tabs)/matchmaking.tsx` — (déjà couvert : les 3 invités du défi ciblé reçoivent la notif d'invitation via le flux existant `handlePublish`/`notifyPlayers`)

**Interfaces:**
- Produces: `notifyShowcaseNominated(partnerId, byName)` dans `lib/defiNotify.ts`.

- [ ] **Step 1 : Helper de notif**

Dans `react-matchup/lib/defiNotify.ts`, ajouter :
```ts
export function notifyShowcaseNominated(partnerId: string, byName: string): void {
  if (!partnerId) return;
  notifyPlayers({
    playerIds: [partnerId],
    title: '🤝 Binôme ouvert',
    body: `${byName} veut être ton binôme ouvert aux défis — confirme depuis ton profil.`,
    data: { type: 'challenge' },
  });
}
```

- [ ] **Step 2 : Appeler à la nomination**

Dans `ShowcaseManager.tsx`, après un `openShowcase(partnerId)` réussi, appeler `notifyShowcaseNominated(partnerId, player.name)`.

- [ ] **Step 3 : Notif de conversion (créateur)**

La conversion au refus se fait côté DB (trigger). Une notif au créateur (« ton défi ciblé est refusé → maintenant ouvert ») nécessiterait un webhook serveur — **hors périmètre de ce plan** (noté comme suite possible, cf. la dette notifs déjà identifiée). Le créateur verra le défi passer en « ouvert » dans « Mes défis ».

- [ ] **Step 4 : Typecheck + Commit**
```bash
cd react-matchup && npx tsc --noEmit
git add react-matchup/lib/defiNotify.ts react-matchup/components/profile/ShowcaseManager.tsx
git commit -m "feat(vitrine): notif de nomination de binôme ouvert"
```

---

## Self-review (Plan 2)

- **Couverture spec** : `lib/showcase.ts` (Task 1) ✓ ; exclusion `is_targeted` de « À relever » (Task 2) ✓ ; mode ciblé du wizard + `is_targeted`/bande NULL à l'insert (Task 3) ✓ ; section vitrine + « Défier ce binôme » (Task 4) ✓ ; déclaration/gestion/confirmation depuis le profil (Task 5) ✓ ; notif de nomination (Task 6) ✓.
- **Reuse** : `CreateWizard` (`initialInvites` pré-remplit Team B, mode Défi), invitations `game_participants`, `notifyPlayers`/`notifyDefiConfirmed`, patterns de cartes/recherche du hub.
- **Reporté / hors périmètre** : notif serveur au créateur à la conversion (webhook, futur) ; la confirmation d'une nomination pourrait aussi apparaître dans la cloche (déjà : `data.type='challenge'` route vers le hub — la nomination est gérée depuis le profil pour l'instant).
- **Risques** : (1) le mode ciblé du wizard ne doit pas casser le Défi ouvert ni les parties normales (bien conditionner sur `targeted`). (2) `spots_available=0` pour un ciblé (3 invités) — cohérent. (3) bien réinitialiser `targetedInvites/targetedMode` à la fermeture du wizard. (4) ne stager QUE les fichiers de chaque tâche (fichiers WIP utilisateur intacts).

## Runbook Plan 2

Aucune migration (backend Plan 1 déjà appliqué). Rebuild app.
