# Refonte Défi 2v2 — Phase 3b : Relève riche + compat + surfaçage lobby — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Compléter le hub Défi (Phase 3a) : un vrai **sélecteur de partenaire** pour relever un défi (→ `applyToDefi`), le **classement par compatibilité** de « À relever » + suggestions de partenaire, et le **surfaçage des invitations binôme dans le lobby « À venir »** (2ᵉ surface).

**Architecture:** On réintroduit le moteur de compatibilité (supprimé du hub en 3a) dans un module pur **`lib/compat.ts`** (extrait fidèlement de l'historique). Le hub `matchmaking.tsx` gagne un **modal sélecteur de partenaire** (recherche + suggestions compat) qui appelle `applyToDefi`, et classe « À relever » par compat. Le **lobby** lit `fetchBinomeInvitations` et affiche les invitations binôme dans « À venir » avec un bouton d'acceptation (`acceptBinomeInvitation`).

**Tech Stack:** React Native / Expo (TS), Supabase. Vérif = `npx tsc --noEmit` (+ device).

## Global Constraints

- **Modèle Phase 1/2/3a** inchangé : `applyToDefi(gameId, partnerId)` (RPC `defi_apply`), `acceptBinomeInvitation(appId)` (RPC `defi_accept`) — exportés par `lib/defis.ts`, NE PAS les modifier.
- **`lib/compat.ts`** = extraction VERBATIM des fonctions de scoring (logique inchangée). Pas de JSX dans ce module (juste data + supabase).
- **Éligibilité au lock** est revalidée côté serveur (`defi_apply` rejette `binome out of level band`). Le client AFFICHE la bande ; il peut pré-filtrer les partenaires inéligibles mais ce n'est pas obligatoire (le serveur tranche).
- **Court side** : `player.court_side` (valeurs `'left'|'right'|'both'` RN) alimente `scoreSide`. Champ déjà présent sur `Player`.
- **Lobby** : les invitations binôme s'affichent dans l'onglet « À venir » SANS casser l'existant (parties classiques). Surface additive.

---

### Task 1 : Module `lib/compat.ts` (extraction du moteur)

**Files:**
- Create: `react-matchup/lib/compat.ts`

**Interfaces:**
- Produces: `CompatDetail`, `DAYS_FR`, `scoreElo`, `getPlayerGameData`, `scoreClubs`, `scoreDays`, `scoreSide`, `computeCompatDetail` — logique identique à l'ancien hub (port web `compatibility.ts`).

- [ ] **Step 1 : Écrire `lib/compat.ts` (verbatim)**

```ts
// react-matchup/lib/compat.ts
// Moteur de COMPATIBILITÉ entre joueurs (port de web compatibility.ts).
// Extrait de l'ancien matchmaking.tsx (Phase 3a l'avait retiré). Pur data +
// supabase : aucun JSX. Réutilisé par le hub Défi (classement « À relever » +
// suggestions de partenaire).
import { supabase } from './supabase';

export interface CompatDetail {
  score: number;
  eloScore: number; eloGap: number;
  clubScore: number; sharedClubs: string[];
  dayScore: number; sharedDays: string[];
  sideScore: number; sideMatch: string;
}

export const DAYS_FR = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

export function scoreElo(eloA: number, eloB: number): number {
  const gap = Math.abs(eloA - eloB);
  if (gap <= 75)  return 40;
  if (gap <= 150) return 32;
  if (gap <= 250) return 20;
  if (gap <= 400) return 10;
  return 0;
}

export async function getPlayerGameData(playerId: string): Promise<{ clubs: Map<string, number>; days: Set<number> }> {
  const { data: parts } = await supabase
    .from('game_participants')
    .select('game_id')
    .eq('player_id', playerId);
  const gameIds = (parts ?? []).map((p: any) => p.game_id as string).filter(Boolean);
  if (gameIds.length === 0) return { clubs: new Map(), days: new Set() };

  const { data: games } = await supabase
    .from('open_games')
    .select('location, match_date')
    .in('id', gameIds)
    .neq('status', 'cancelled');

  const clubs = new Map<string, number>();
  const days = new Set<number>();
  for (const row of games ?? []) {
    if (row.location) clubs.set(row.location, (clubs.get(row.location) ?? 0) + 1);
    if (row.match_date) days.add(new Date(row.match_date).getDay());
  }
  return { clubs, days };
}

export function scoreClubs(a: Map<string, number>, b: Map<string, number>): { score: number; shared: string[] } {
  const shared: string[] = [];
  for (const club of a.keys()) { if (b.has(club)) shared.push(club); }
  if (shared.length === 0) return { score: 0, shared: [] };
  return { score: shared.length >= 2 ? 30 : 20, shared };
}

export function scoreDays(a: Set<number>, b: Set<number>): { score: number; shared: string[] } {
  const nums = [...a].filter(d => b.has(d));
  const shared = nums.map(d => DAYS_FR[d]);
  if (shared.length === 0) return { score: 0, shared: [] };
  return { score: shared.length >= 2 ? 20 : 12, shared };
}

export function scoreSide(sideA: string | null | undefined, sideB: string | null | undefined): { score: number; sideMatch: string } {
  const norm = (s: string | null | undefined) => {
    if (!s) return 'mixte';
    if (s === 'left'  || s === 'Gauche') return 'gauche';
    if (s === 'right' || s === 'Droit')  return 'droit';
    return 'mixte';
  };
  const a = norm(sideA), b = norm(sideB);
  if (a === 'mixte' || b === 'mixte') return { score: 5,  sideMatch: 'flexible' };
  if ((a === 'gauche' && b === 'droit') || (a === 'droit' && b === 'gauche'))
    return { score: 10, sideMatch: 'complémentaires' };
  return { score: 2, sideMatch: 'même côté' };
}

export async function computeCompatDetail(
  meId: string, myElo: number, mySide: string | null | undefined,
  myData: { clubs: Map<string, number>; days: Set<number> },
  otherId: string, otherElo: number, otherSide: string | null | undefined,
): Promise<CompatDetail> {
  const otherData = await getPlayerGameData(otherId);
  const eloGap   = Math.abs(myElo - otherElo);
  const eloScore = scoreElo(myElo, otherElo);
  const { score: clubScore, shared: sharedClubs } = scoreClubs(myData.clubs, otherData.clubs);
  const { score: dayScore,  shared: sharedDays  } = scoreDays(myData.days, otherData.days);
  const { score: sideScore, sideMatch            } = scoreSide(mySide, otherSide);
  return { score: eloScore + clubScore + dayScore + sideScore, eloScore, eloGap, clubScore, sharedClubs, dayScore, sharedDays, sideScore, sideMatch };
}
```

- [ ] **Step 2 : Typecheck** — `cd react-matchup && npx tsc --noEmit` → zéro erreur.
- [ ] **Step 3 : Commit**
```bash
git add react-matchup/lib/compat.ts
git commit -m "feat(defi): lib/compat.ts (moteur de compatibilité extrait, réutilisable)"
```

---

### Task 2 : Sélecteur de partenaire pour « Relever » (→ applyToDefi)

**Files:**
- Modify: `react-matchup/app/(tabs)/matchmaking.tsx`

**Interfaces:**
- Consumes: `applyToDefi` (lib/defis), `computeCompatDetail`/`getPlayerGameData` (lib/compat), `supabase` (recherche joueurs).
- Produces: un modal `PartnerPicker` ; `handleRelever(game)` ouvre le modal ; la sélection d'un partenaire appelle `applyToDefi(game.id, partner.id)`.

- [ ] **Step 1 : État du sélecteur**

Dans `MatchmakingScreen`, ajouter :
```ts
  const [releverGame, setReleverGame] = useState<DefiGame | null>(null); // défi en cours de relève
  const [partnerSearch, setPartnerSearch] = useState('');
  const [partnerResults, setPartnerResults] = useState<{ id: string; name: string; elo_score: number; court_side?: string }[]>([]);
  const [applying, setApplying] = useState(false);
```
Remplacer le stub `handleRelever` par : `const handleRelever = (game: DefiGame) => { setReleverGame(game); setPartnerSearch(''); setPartnerResults([]); };`

- [ ] **Step 2 : Recherche de joueurs (même pattern que le wizard)**

Ajouter un `useEffect` (importer `useEffect`) déclenché sur `partnerSearch` (≥2 car., debounce 300ms), qui interroge `players` (ilike name, exclut moi, `deleted_at null`, limit 8) et `setPartnerResults`. (Copier le pattern de `CreateWizard.tsx` ~ligne 406-418.)

- [ ] **Step 3 : Fonction d'application**

```ts
  const submitRelever = async (partner: { id: string; name: string }) => {
    if (!releverGame || applying) return;
    setApplying(true);
    try {
      await applyToDefi(releverGame.id, partner.id);
      setReleverGame(null);
      showToast(`Candidature envoyée — ${partner.name} doit accepter pour verrouiller le binôme.`);
      fetchData();
    } catch (e: any) {
      const msg = e?.message?.includes('out of level band')
        ? 'Ton binôme est hors de la bande de niveau de ce défi.'
        : e?.message?.includes('already in game')
        ? 'Toi ou ton partenaire êtes déjà engagés sur ce défi.'
        : (e?.message ?? 'Candidature impossible.');
      Alert.alert('Impossible', msg);
    } finally {
      setApplying(false);
    }
  };
```
Importer `applyToDefi` depuis `lib/defis`.

- [ ] **Step 4 : Modal `PartnerPicker`**

Avant le `return` final de `MatchmakingScreen`, rendre un `Modal` (RN) visible quand `releverGame !== null` : un en-tête « Choisis ton binôme pour relever », un `TextInput` de recherche, la liste `partnerResults` (carte joueur tappable → `submitRelever(p)`), un bouton fermer (`setReleverGame(null)`), et un `ActivityIndicator` quand `applying`. Réutiliser `PlayerAvatar`, `eloToLevel`, `Colors`, `Fonts`. (Structure calquée sur le panneau d'invitation du wizard.)

- [ ] **Step 5 : Suggestions compat dans le sélecteur (optionnel mais voulu)**

Quand le modal s'ouvre et que `partnerSearch` est vide, afficher des **partenaires suggérés** : charger mes joueurs fréquents (cf. le `useEffect` "frequent players" du wizard, ~ligne 330-351) puis les classer par `computeCompatDetail(me, candidate)` décroissant. Afficher en tête « Suggérés pour toi » avec un petit score. (Si le coût est trop élevé, se limiter à la recherche en V1 et noter la suggestion comme polish.)

- [ ] **Step 6 : Typecheck + Commit**
```bash
git add react-matchup/app/(tabs)/matchmaking.tsx
git commit -m "feat(defi): sélecteur de partenaire pour relever un défi (→ applyToDefi) + suggestions compat"
```

---

### Task 3 : Classement de « À relever » par compatibilité

**Files:**
- Modify: `react-matchup/app/(tabs)/matchmaking.tsx`

**Interfaces:**
- Consumes: `scoreElo`, `scoreClubs`, `scoreDays`, `getPlayerGameData` (lib/compat).
- Produces: `openDefis` triés par un score de compat défi-spécifique ; un petit indicateur de compat sur `DefiReleverCard`.

- [ ] **Step 1 : Calculer un score de compat par défi**

Après `fetchData` (ou dans un effet dédié sur `openDefis`), calculer pour chaque défi un score :
- `scoreElo(myElo, bandMidElo)` où `bandMidElo = ((min_elo ?? myElo) + (max_elo ?? myElo)) / 2` ;
- `scoreClubs(myClubs, new Map(défi.location ? [[défi.location,1]] : []))` ;
- `scoreDays(myDays, new Set(défi.match_date ? [new Date(défi.match_date).getDay()] : []))`.
`myClubs/myDays` via `getPlayerGameData(player.id)` (charger une fois). Stocker dans une `Map<gameId, number>`.

- [ ] **Step 2 : Trier la section « À relever »**

Trier `openDefis` (au rendu) par score décroissant, fallback date ascendante. Afficher un petit badge compat (réutiliser `compatTier` si gardé, sinon un simple « 🔥 compatible » quand score élevé).

- [ ] **Step 3 : Typecheck + Commit**
```bash
git add react-matchup/app/(tabs)/matchmaking.tsx
git commit -m "feat(defi): classement de « À relever » par compatibilité (niveau + clubs + jours)"
```

---

### Task 4 : Surfaçage des invitations binôme dans le lobby « À venir »

**Files:**
- Modify: `react-matchup/app/(tabs)/lobby.tsx`

**Interfaces:**
- Consumes: `fetchBinomeInvitations`, `acceptBinomeInvitation` (lib/defis).
- Produces: dans l'onglet « À venir » du lobby, une sous-section « Invitations binôme » avec un bouton d'acceptation.

- [ ] **Step 1 : Charger les invitations binôme**

Dans `lobby.tsx` `fetchData`, ajouter un appel `fetchBinomeInvitations(player.id)` (Promise.all) et un état `const [binomeInvites, setBinomeInvites] = useState<DefiApplication[]>([])`. Importer depuis `lib/defis`.

- [ ] **Step 2 : Rendre la sous-section dans « À venir »**

Dans le rendu de l'onglet « À venir » (identifier la condition de tab dans lobby.tsx), AVANT la liste des parties, si `binomeInvites.length > 0`, afficher une petite carte par invitation : « X t'invite comme binôme pour relever un défi » + bande/mise + bouton « Accepter & verrouiller ». Le bouton appelle un handler `acceptBinomeFromLobby(app)` qui fait `acceptBinomeInvitation(app.id)`, toast `'locked'`/`'too_late'`, refetch, `reloadNotifs` (cf. le même handler que le hub). Réutiliser le style des cartes du lobby.

- [ ] **Step 3 : Typecheck + Commit**
```bash
git add react-matchup/app/(tabs)/lobby.tsx
git commit -m "feat(defi): invitations binôme aussi dans le lobby « À venir » (2e surface)"
```

---

## Self-review (Phase 3b)

- **Couverture** : moteur compat réintroduit proprement (`lib/compat.ts`, Task 1) ✓ ; sélecteur de partenaire → `applyToDefi` (Task 2) ✓ ; suggestions de partenaire par compat (Task 2 Step 5) ✓ ; classement « À relever » par compat (Task 3) ✓ ; 2ᵉ surface lobble pour les invitations binôme (Task 4) ✓.
- **Reporté / hors périmètre** : feature « binômes ouverts aux défis + défi ciblé » (sa propre future brique) ; affichage du draft du créateur dans « Mes défis » (déjà couvert par `fetchMyDefis` en 3a) ; annulation/retrait d'un défi par le créateur (polish à prévoir).
- **Risque** : Task 2/3 modifient le même fichier `matchmaking.tsx` → exécuter en séquence (2 puis 3). Task 3's compat par défi est une heuristique légère (niveau vs milieu de bande) — volontairement simple. Task 4 touche `lobby.tsx` (gros fichier) → bien cibler l'onglet « À venir » sans régresser les parties classiques.

## Runbook Phase 3b

Aucune migration. Rebuild app. Dépend de Phases 1/2/3a.
