# Localisation — Lot 3 (carte des parties) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter à l'Explorer une bascule « Liste | Carte » : la carte montre, sur un fond OpenStreetMap, les parties retenues par les filtres, avec le point de départ du joueur, et un panneau qui ouvre la fiche d'une partie.

**Architecture:** Deux modules purs et testés font le travail de fond — `lib/mapMarkers.ts` regroupe les parties en repères (club précis, ou ville pour les clubs placés au centre-ville) et prépare les lignes du panneau ; `lib/exploreMapHtml.ts` construit la page Leaflet embarquée, pilotée par messages. Un composant `components/lobby/ExploreMap.tsx` assemble la page (WebView) et le panneau, et l'Explorer (`app/(tabs)/lobby.tsx`) bascule entre liste et carte. Les distances et le point de départ viennent du magasin partagé `hooks/useOrigin.ts` (lot 1).

**Tech Stack:** React Native 0.86 / Expo SDK 57, TypeScript, `react-native-webview` + Leaflet embarqué (`assets/leaflet/leaflet.bundle`), vitest.

**Spec:** `docs/superpowers/specs/2026-09-17-localisation-design.md` (section 4 « Lot 3 », sections 5 à 7).

## Global Constraints

- Sélecteur **Liste | Carte** en haut de l'Explorer ; la carte affiche les parties retenues par `filterExplore` (**mêmes filtres, recherche comprise**), mises à jour **sans rechargement de la carte**.
- Repères (fonction pure `groupMapMarkers`, testée) : **un repère par position de club précise**, avec le nombre de parties ; les clubs **au centre-ville** regroupés en **un repère par ville**, style **atténué**, « **emplacement exact inconnu** ».
- Point de départ : **point bleu (GPS)** ou **repère de zone** ; **cercle du rayon si « Distance max » est actif**. Carte **centrée sur le point de départ, sinon cadrée sur les repères**.
- Toucher un repère : panneau en bas **dessiné dans l'écran (pas de fenêtre modale native)** listant club(s) et parties (**heure, niveau, places, distance**) ; toucher une partie ouvre **sa fiche habituelle**.
- Réutilise l'asset Leaflet embarqué, **sans changement de comportement pour l'assistant de création**. Échanges app ↔ carte **par messages**.
- Hors ligne : « **Carte indisponible hors ligne** », la liste reste utilisable.
- Distances (lot 1, ne pas réécrire) : `formatGameDistance` — « 800 m », « 4,2 km », « 23 km », approximatif préfixé « ~ ».
- Places : `spotsLabel` de `lib/games.ts` (source unique, jamais `spots_available`). Niveau : même règle que la carte de partie du lobby.
- Aucune demande d'autorisation GPS depuis la carte (aucun appel à `requestGps` dans ce lot).
- Textes en français, tutoiement, sans jargon. Emoji 🎾 interdit partout.
- Ne jamais lire `e.nativeEvent` dans une fonction passée à `setState` (garde-fou `lib/__tests__/nativeEventInUpdater.test.ts`) : lire la valeur d'abord, puis `setX(prev => …)`.
- `expo-location` n'est nommé que dans `lib/location.ts` (garde-fou `lib/__tests__/noDirectExpoLocation.test.ts`).
- Règles des hooks : tout hook avant le premier `return` anticipé du composant.

### Décision prise dans ce plan

- La spec propose d'élargir `buildClubsMapHtml` (carte de l'assistant de création). Ce plan crée plutôt **une page à part, `lib/exploreMapHtml.ts`, qui réutilise le même asset Leaflet** : l'assistant ne change pas d'un octet, ce qui garantit l'exigence « sans changement de comportement pour l'assistant de création ». Coût : une vingtaine de lignes de page en double (fond de carte, fonction `post`).

### Règles du dépôt (valables pour chaque tâche)

- Travail directement sur `main`. Commits locaux par tâche, **jamais poussés**. `git add` uniquement les fichiers précis de la tâche — **jamais** `git add -A` / `git add .`, jamais `git stash`, `git checkout --`, `git restore`.
- Le dossier `supabase/` n'est pas versionné ; ce lot n'y touche pas (aucune migration).
- Tests : `node node_modules/vitest/vitest.mjs run lib` depuis la racine (820 tests avant ce lot). Types : `npx tsc --noEmit -p tsconfig.json`.
- Windows : pour un script ponctuel, écrire un fichier puis l'exécuter (les heredocs mangent antislashs et guillemets).
- Message de commit terminé par la ligne `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## Carte des fichiers

| Fichier | Rôle |
|---|---|
| `lib/games.ts` (modifié) | + `levelRangeLabel(game)` : le libellé de niveau, une seule fois |
| `lib/mapMarkers.ts` (créé) | Pur : `groupMapMarkers`, `panelRows`, `whenLabel` |
| `lib/__tests__/mapMarkers.test.ts` (créé) | Tests des trois fonctions et de `levelRangeLabel` |
| `lib/exploreMapHtml.ts` (créé) + `lib/__tests__/exploreMapHtml.test.ts` (créé) | Page Leaflet de l'Explorer et son contrat de messages |
| `hooks/useOrigin.ts` (modifié) | Expose `clubIndex` (positions des clubs déjà chargées) |
| `components/lobby/ExploreMap.tsx` (créé) | WebView + panneau en bas + messages hors ligne / vide |
| `app/(tabs)/lobby.tsx` (modifié) | Bascule Liste/Carte, défilement bloqué en mode carte, hauteur de la carte, niveau de la carte de partie via `levelRangeLabel` |

---

### Task 1 : repères et panneau (pur)

**Files:**
- Modify: `lib/games.ts` (ajout de `levelRangeLabel` juste après `gameEloRange`)
- Create: `lib/mapMarkers.ts`
- Create: `lib/__tests__/mapMarkers.test.ts`

**Interfaces:**
- Consumes (lot 1) : `normClubName`, `formatGameDistance`, types `ClubPoint` (`{ lat, lng, approx }`), `DistanceOf` de `lib/geo.ts` ; `gameEloRange`, `spotsLabel` de `lib/games.ts` ; `eloToLevel` de `lib/theme.ts`.
- Produces :
  - `levelRangeLabel(game): string | null` dans `lib/games.ts` — « 3.1 – 4.1 », une valeur seule si les bornes se confondent, `null` sans fourchette.
  - `type MarkerKind = 'club' | 'city'`
  - `interface MapMarker { key: string; kind: MarkerKind; lat: number; lng: number; label: string; clubs: string[]; gameIds: string[] }`
  - `groupMapMarkers(games, pointOf, cityOf): { markers: MapMarker[]; unplaced: number }`
  - `interface PanelRow { id: string; when: string; club: string; level: string | null; places: string; distance: string | null }`
  - `panelRows(games, marker, distanceOf, now?): PanelRow[]`
  - `whenLabel(iso, now?): string`

- [ ] **Step 1 : écrire les tests qui échouent**

Créer `lib/__tests__/mapMarkers.test.ts` :

```ts
import { describe, it, expect, vi } from 'vitest';

// lib/games charge le client Supabase au chargement ; les fonctions testees
// ici sont pures : on neutralise le module (meme principe qu'urgentGame.test).
vi.mock('../supabase', () => ({ supabase: {} }));

import { groupMapMarkers, panelRows, whenLabel, type MapMarker } from '../mapMarkers';
import { levelRangeLabel } from '../games';

const points: Record<string, { lat: number; lng: number; approx: boolean }> = {
  'Padel 4 Maroc': { lat: 33.53, lng: -7.64, approx: false },
  'Voisin Exact': { lat: 33.53, lng: -7.64, approx: false },       // même point exact
  'COC Padel': { lat: 33.5731, lng: -7.5898, approx: true },       // centre de Casablanca
  'Club Centre 2': { lat: 33.5731, lng: -7.5898, approx: true },   // même ville
  'ACSA': { lat: 34.0209, lng: -6.8416, approx: true },            // centre de Rabat
};
const villes: Record<string, string> = {
  'Padel 4 Maroc': 'Bouskoura', 'Voisin Exact': 'Bouskoura',
  'COC Padel': 'Casablanca', 'Club Centre 2': 'Casablanca', 'ACSA': 'Rabat',
};
const pointOf = (l: string) => points[l] ?? null;
const cityOf = (l: string) => villes[l] ?? null;
const g = (id: string, location: string | null) => ({ id, location });

describe('regrouper les parties en repères', () => {
  it('un repère par position de club PRÉCISE, avec ses parties', () => {
    const { markers } = groupMapMarkers([g('a', 'Padel 4 Maroc'), g('b', 'Padel 4 Maroc')], pointOf, cityOf);
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ kind: 'club', label: 'Padel 4 Maroc', clubs: ['Padel 4 Maroc'], gameIds: ['a', 'b'] });
  });

  it('deux clubs précis au même point : un seul repère, les deux noms', () => {
    const { markers } = groupMapMarkers([g('a', 'Padel 4 Maroc'), g('b', 'Voisin Exact')], pointOf, cityOf);
    expect(markers).toHaveLength(1);
    expect(markers[0].label).toBe('Padel 4 Maroc · Voisin Exact');
    expect(markers[0].clubs).toEqual(['Padel 4 Maroc', 'Voisin Exact']);
  });

  it('clubs au centre-ville : UN repère par ville, jamais un faux point par club', () => {
    const { markers } = groupMapMarkers([g('a', 'COC Padel'), g('b', 'Club Centre 2'), g('c', 'ACSA')], pointOf, cityOf);
    const casa = markers.find(m => m.label === 'Casablanca')!;
    expect(casa).toMatchObject({ kind: 'city', clubs: ['COC Padel', 'Club Centre 2'], gameIds: ['a', 'b'] });
    expect(markers.find(m => m.label === 'Rabat')).toMatchObject({ kind: 'city', gameIds: ['c'] });
    expect(markers).toHaveLength(2);
  });

  it('lieu inconnu ou vide : pas de repère, mais on le COMPTE', () => {
    const r = groupMapMarkers([g('a', 'Club Inconnu'), g('b', null), g('c', 'Padel 4 Maroc')], pointOf, cityOf);
    expect(r.unplaced).toBe(2);
    expect(r.markers).toHaveLength(1);
  });

  it('club au centre-ville SANS ville connue : repère à son nom, toujours atténué', () => {
    const r = groupMapMarkers([g('a', 'COC Padel')], pointOf, () => null);
    expect(r.markers[0]).toMatchObject({ kind: 'city', label: 'COC Padel' });
  });

  it('ordre stable d un appel à l autre', () => {
    const a = groupMapMarkers([g('a', 'ACSA'), g('b', 'Padel 4 Maroc'), g('c', 'COC Padel')], pointOf, cityOf);
    const b = groupMapMarkers([g('c', 'COC Padel'), g('a', 'ACSA'), g('b', 'Padel 4 Maroc')], pointOf, cityOf);
    expect(a.markers.map(m => m.key)).toEqual(b.markers.map(m => m.key));
  });
});

describe('libellé de niveau (même règle que la carte du lobby)', () => {
  it('fourchette déclarée', () => {
    expect(levelRangeLabel({ creator_id: 'c', min_elo: 1000, max_elo: 1400 })).toMatch(/^\d\.\d – \d\.\d$/);
  });
  it('bornes confondues : une seule valeur', () => {
    expect(levelRangeLabel({ creator_id: 'c', min_elo: 1200, max_elo: 1200 })).toMatch(/^\d\.\d$/);
  });
  it('aucune fourchette ni joueur : null', () => {
    expect(levelRangeLabel({ creator_id: 'c' })).toBeNull();
  });
});

describe('le moment d une partie', () => {
  const now = new Date(2026, 8, 18, 10, 0);
  it('aujourd hui, demain, puis la date', () => {
    expect(whenLabel(new Date(2026, 8, 18, 19, 30).toISOString(), now)).toBe("Aujourd'hui · 19:30");
    expect(whenLabel(new Date(2026, 8, 19, 9, 5).toISOString(), now)).toBe('Demain · 09:05');
    expect(whenLabel(new Date(2026, 8, 21, 20, 0).toISOString(), now)).toMatch(/^Lun\.? 21 sept\.? · 20:00$/);
  });
  it('sans date : « Date à fixer »', () => {
    expect(whenLabel(null, now)).toBe('Date à fixer');
  });
});

describe('les lignes du panneau', () => {
  const now = new Date(2026, 8, 18, 10, 0);
  const partie = (id: string, location: string, jour: number, heure: number) => ({
    id, location, creator_id: 'c', match_date: new Date(2026, 8, jour, heure).toISOString(),
    min_elo: 1000, max_elo: 1400,
    participants: [{ player_id: 'x', status: 'accepted' }],
  });
  const marker: MapMarker = {
    key: 'ville:casablanca', kind: 'city', lat: 0, lng: 0, label: 'Casablanca',
    clubs: ['COC Padel', 'Club Centre 2'], gameIds: ['tard', 'tot'],
  };
  const distanceOf = (l: string | null | undefined) => (l === 'COC Padel' ? { km: 12.2, approx: true } : null);

  it('les parties du repère, de la plus proche dans le temps à la plus lointaine', () => {
    const rows = panelRows(
      [partie('tard', 'Club Centre 2', 20, 20), partie('tot', 'COC Padel', 18, 19), partie('ailleurs', 'ACSA', 18, 12)],
      marker, distanceOf, now,
    );
    expect(rows.map(r => r.id)).toEqual(['tot', 'tard']);
  });

  it('chaque ligne dit heure, club, niveau, places et distance', () => {
    const [row] = panelRows([partie('tot', 'COC Padel', 18, 19)], marker, distanceOf, now);
    expect(row).toMatchObject({ id: 'tot', when: "Aujourd'hui · 19:00", club: 'COC Padel', places: '2 places dispo', distance: '~12 km' });
    expect(row.level).toMatch(/^\d\.\d – \d\.\d$/);
  });

  it('distance inconnue : null, jamais un chiffre inventé', () => {
    const [row] = panelRows([partie('tard', 'Club Centre 2', 20, 20)], marker, distanceOf, now);
    expect(row.distance).toBeNull();
  });
});
```

- [ ] **Step 2 : lancer, vérifier l'échec**

Run: `node node_modules/vitest/vitest.mjs run lib/__tests__/mapMarkers.test.ts`
Expected: FAIL — `Failed to resolve import "../mapMarkers"` (et `levelRangeLabel` absent de `lib/games.ts`).

- [ ] **Step 3 : ajouter `levelRangeLabel` dans `lib/games.ts`**

En tête de `lib/games.ts`, ajouter l'import (avec les autres imports) :

```ts
import { eloToLevel } from './theme';
```

Juste après la fin de la fonction `gameEloRange`, ajouter :

```ts
/**
 * Le libellé de niveau d'une partie : « 3.1 – 4.1 », une seule valeur quand
 * les bornes se confondent, `null` sans fourchette connue.
 *
 * Source UNIQUE : la carte de partie du lobby et le panneau de la carte
 * l'affichent ; deux copies finiraient par annoncer deux niveaux différents.
 */
export function levelRangeLabel(game: Parameters<typeof gameEloRange>[0]): string | null {
  const r = gameEloRange(game);
  if (!r) return null;
  const bas = eloToLevel(r.min).toFixed(1);
  const haut = eloToLevel(r.max).toFixed(1);
  return bas === haut ? bas : `${bas} – ${haut}`;
}
```

Si `lib/theme.ts` importe déjà `lib/games.ts` (import circulaire), arrêter et le signaler dans le rapport au lieu de contourner.

- [ ] **Step 4 : écrire `lib/mapMarkers.ts`**

```ts
// lib/mapMarkers.ts — ce que montre la carte de l'Explorer.
//
// PUR ET TESTÉ (lib/__tests__/mapMarkers.test.ts). Deux règles :
//
//   * un repère par position de club PRÉCISE ; les clubs placés au centre de
//     leur ville (position approximative) sont regroupés en UN repère par
//     ville — sinon on dessinerait dix faux points empilés sur la même place ;
//   * le panneau d'un repère liste ses parties avec heure, club, niveau,
//     places et distance, par les mêmes fonctions que le reste de l'app
//     (spotsLabel, levelRangeLabel, formatGameDistance).
import { normClubName, formatGameDistance, type ClubPoint, type DistanceOf } from './geo';
import { spotsLabel, levelRangeLabel } from './games';

export type MarkerKind = 'club' | 'city';

export interface MapMarker {
  /** Identifiant stable : 'club:<lat>,<lng>' ou 'ville:<nom normalisé>'. */
  key: string;
  kind: MarkerKind;
  lat: number;
  lng: number;
  /** Nom du club (ou des clubs au même point), ou nom de la ville. */
  label: string;
  clubs: string[];
  gameIds: string[];
}

export interface MarkerGame { id: string; location?: string | null }

export function groupMapMarkers<G extends MarkerGame>(
  games: G[],
  pointOf: (location: string) => ClubPoint | null,
  cityOf: (location: string) => string | null,
): { markers: MapMarker[]; unplaced: number } {
  const parCle = new Map<string, MapMarker>();
  let unplaced = 0;
  for (const g of games) {
    const lieu = (g.location ?? '').trim();
    const point = lieu ? pointOf(lieu) : null;
    if (!point) { unplaced++; continue; }
    let key: string;
    let kind: MarkerKind;
    let label: string;
    if (point.approx) {
      const ville = cityOf(lieu);
      kind = 'city';
      label = ville ?? lieu;
      key = `ville:${normClubName(label)}`;
    } else {
      kind = 'club';
      label = lieu;
      key = `club:${point.lat.toFixed(5)},${point.lng.toFixed(5)}`;
    }
    let m = parCle.get(key);
    if (!m) {
      m = { key, kind, lat: point.lat, lng: point.lng, label, clubs: [], gameIds: [] };
      parCle.set(key, m);
    }
    if (!m.clubs.includes(lieu)) m.clubs.push(lieu);
    if (kind === 'club') m.label = m.clubs.join(' · ');
    m.gameIds.push(g.id);
  }
  const markers = [...parCle.values()].sort((a, b) => a.key.localeCompare(b.key));
  return { markers, unplaced };
}

const deux = (n: number) => String(n).padStart(2, '0');
const memeJour = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** « Aujourd'hui · 19:30 », « Demain · 09:05 », « Lun. 21 sept. · 20:00 ». */
export function whenLabel(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return 'Date à fixer';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Date à fixer';
  const heure = `${deux(d.getHours())}:${deux(d.getMinutes())}`;
  if (memeJour(d, now)) return `Aujourd'hui · ${heure}`;
  const demain = new Date(now.getTime() + 86_400_000);
  if (memeJour(d, demain)) return `Demain · ${heure}`;
  const jour = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  return `${jour.charAt(0).toUpperCase()}${jour.slice(1)} · ${heure}`;
}

export interface PanelRow {
  id: string;
  when: string;
  club: string;
  level: string | null;
  places: string;
  distance: string | null;
}

type PanelGame = MarkerGame & Parameters<typeof spotsLabel>[0] & Parameters<typeof levelRangeLabel>[0] & {
  match_date?: string | null;
};

/** Les parties d'un repère, dans l'ordre du temps. */
export function panelRows<G extends PanelGame>(
  games: G[], marker: MapMarker, distanceOf: DistanceOf, now: Date = new Date(),
): PanelRow[] {
  const ids = new Set(marker.gameIds);
  const quand = (g: G) => {
    const t = g.match_date ? new Date(g.match_date).getTime() : NaN;
    return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
  };
  return games
    .filter(g => ids.has(g.id))
    .sort((a, b) => quand(a) - quand(b))
    .map(g => {
      const d = distanceOf(g.location);
      return {
        id: g.id,
        when: whenLabel(g.match_date, now),
        club: (g.location ?? '').trim(),
        level: levelRangeLabel(g),
        places: spotsLabel(g),
        distance: d ? formatGameDistance(d) : null,
      };
    });
}
```

- [ ] **Step 5 : lancer les tests et les types**

Run: `node node_modules/vitest/vitest.mjs run lib/__tests__/mapMarkers.test.ts` puis `node node_modules/vitest/vitest.mjs run lib` puis `npx tsc --noEmit -p tsconfig.json`
Expected: tout passe (820 + les nouveaux) ; types propres. Si le test `Lun. 21 sept.` échoue seulement à cause du format de date de Node (point absent, casse), ajuster la regex du test pour accepter la variante réellement produite **et** le signaler dans le rapport, sans toucher au code.

- [ ] **Step 6 : commit**

```bash
git add lib/games.ts lib/mapMarkers.ts lib/__tests__/mapMarkers.test.ts
git commit -m "feat(localisation): repères de la carte et lignes du panneau (lot 3)"
```

---

### Task 2 : la page Leaflet de l'Explorer

**Files:**
- Create: `lib/exploreMapHtml.ts`
- Create: `lib/__tests__/exploreMapHtml.test.ts`

**Interfaces:**
- Consumes : `LEAFLET_JS`, `LEAFLET_CSS` de `assets/leaflet/leaflet.bundle` (déjà utilisés par `lib/clubsMapHtml.ts` et `lib/zoneMapHtml.ts`).
- Produces : `buildExploreMapHtml(): string`. Contrat de la page :
  - l'app appelle `window.setMarkers(markers)` avec des `MapMarker` (Task 1) et `window.setOrigin(origin, radiusKm)` avec `{ lat, lng, source: 'gps' | 'zone' } | null` et `number | null` ;
  - la page envoie `{ type: 'ready' }`, `{ type: 'marker', key }` au toucher d'un repère, `{ type: 'tiles', ok: true }` au premier fond de carte chargé, `{ type: 'tiles', ok: false }` quand un fond échoue avant tout succès.

- [ ] **Step 1 : écrire le test qui échoue**

Créer `lib/__tests__/exploreMapHtml.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { buildExploreMapHtml } from '../exploreMapHtml';

// components/lobby/ExploreMap.tsx dépend de ces noms : les changer d'un côté
// sans l'autre laisserait une carte muette, sans aucune erreur.
describe('carte de l Explorer : contrat avec l écran', () => {
  const html = buildExploreMapHtml();

  it('expose setMarkers et setOrigin', () => {
    expect(html).toContain('window.setMarkers = function(MARKERS)');
    expect(html).toContain('window.setOrigin = function(ORIGIN, RADIUS_KM)');
  });

  it('annonce ready, le toucher d un repère et l état du fond de carte', () => {
    expect(html).toContain("post({ type: 'ready' })");
    expect(html).toContain("post({ type: 'marker', key: m.key })");
    expect(html).toContain("post({ type: 'tiles', ok: true })");
    expect(html).toContain("post({ type: 'tiles', ok: false })");
  });

  it('échappe les noms de clubs avant de les écrire dans la page', () => {
    // Un nom de club contenant < ou & ne doit jamais devenir du HTML actif.
    expect(html).toContain('function esc(s)');
    expect(html).toContain('esc(m.label)');
  });

  it('les repères de ville sont atténués et disent « emplacement exact inconnu »', () => {
    expect(html).toContain('.ville');
    expect(html).toContain('emplacement exact inconnu');
  });
});
```

- [ ] **Step 2 : lancer, vérifier l'échec**

Run: `node node_modules/vitest/vitest.mjs run lib/__tests__/exploreMapHtml.test.ts`
Expected: FAIL — `Failed to resolve import "../exploreMapHtml"`.

- [ ] **Step 3 : écrire `lib/exploreMapHtml.ts`**

```ts
// lib/exploreMapHtml.ts — la carte des parties de l'Explorer (Leaflet embarqué).
//
// Page STATIQUE : l'app pousse les repères et le point de départ par
// injectJavaScript, la page répond par postMessage. La page n'est jamais
// rechargée : changer un filtre redessine les repères, sans refaire la carte.
//
// Distincte de lib/clubsMapHtml.ts (carte de l'assistant de création) pour que
// l'assistant ne change pas d'un octet ; elle réutilise le même asset Leaflet.
// Contrat vérifié par lib/__tests__/exploreMapHtml.test.ts.
import { LEAFLET_JS, LEAFLET_CSS } from '../assets/leaflet/leaflet.bundle';

export function buildExploreMapHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <style>${LEAFLET_CSS}
    html,body,#map{margin:0;padding:0;height:100%;width:100%;background:#e9eef2}
    .club{display:flex;align-items:center;justify-content:center;width:32px;height:32px;
      border-radius:50% 50% 50% 0;background:#0A0A0A;transform:rotate(-45deg);
      border:2px solid #FFC11A;box-shadow:0 1px 4px rgba(0,0,0,.4)}
    .club b{transform:rotate(45deg);color:#FFC11A;font:800 12px system-ui}
    .ville{display:flex;flex-direction:column;align-items:center;justify-content:center;
      width:56px;height:56px;border-radius:50%;background:rgba(10,10,10,.35);
      border:2px dashed rgba(255,255,255,.9);color:#fff;font:800 13px system-ui;text-align:center}
    .ville small{font:600 8px system-ui;opacity:.95;line-height:1.1;max-width:50px}
    .gps{width:16px;height:16px;border-radius:50%;background:#1f6feb;border:3px solid #fff;
      box-shadow:0 0 0 6px rgba(31,111,235,.25)}
    .zone{width:22px;height:22px;border-radius:50% 50% 50% 0;background:#1f6feb;
      transform:rotate(-45deg);border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)}
  </style>
</head>
<body>
  <div id="map"></div>
  <script>${LEAFLET_JS}</script>
  <script>
    function post(o){ if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(o)); }
    function esc(s){ return String(s).replace(/[&<>"']/g, function(c){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]; }); }

    var map = L.map('map', { zoomControl: true, attributionControl: true });
    var tuiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap'
    }).addTo(map);
    var tuileOk = false, tuileKo = false;
    tuiles.on('tileload', function(){ if (!tuileOk) { tuileOk = true; post({ type: 'tiles', ok: true }); } });
    tuiles.on('tileerror', function(){ if (!tuileOk && !tuileKo) { tuileKo = true; post({ type: 'tiles', ok: false }); } });
    map.setView([31.7, -7.1], 5); // Maroc, le temps que les données arrivent

    var reperes = L.layerGroup().addTo(map);
    var depart = L.layerGroup().addTo(map);
    var cercle = null, pointDepart = null, points = [];
    var cadreSurDepart = false, cadreSurReperes = false;

    // Centrée sur le point de départ ; sinon cadrée sur les repères. Une seule
    // fois : ensuite la carte reste là où le joueur l'a laissée.
    function cadrer(){
      if (cadreSurDepart) return;
      if (pointDepart) {
        if (cercle) map.fitBounds(cercle.getBounds(), { padding: [24, 24] });
        else map.setView(pointDepart, 12);
        cadreSurDepart = true;
        return;
      }
      if (cadreSurReperes || points.length === 0) return;
      if (points.length === 1) map.setView(points[0], 13);
      else map.fitBounds(points, { padding: [40, 40] });
      cadreSurReperes = true;
    }

    window.setMarkers = function(MARKERS){
      reperes.clearLayers();
      points = [];
      MARKERS.forEach(function(m){
        var n = m.gameIds.length;
        var html = m.kind === 'club'
          ? '<div class="club" title="' + esc(m.label) + '"><b>' + n + '</b></div>'
          : '<div class="ville">' + n + '<small>' + esc(m.label) + '<br/>emplacement exact inconnu</small></div>';
        var taille = m.kind === 'club' ? [32, 32] : [56, 56];
        var ancre = m.kind === 'club' ? [16, 32] : [28, 28];
        var icone = L.divIcon({ html: html, className: '', iconSize: taille, iconAnchor: ancre });
        L.marker([m.lat, m.lng], { icon: icone })
          .on('click', function(){ post({ type: 'marker', key: m.key }); })
          .addTo(reperes);
        points.push([m.lat, m.lng]);
      });
      cadrer();
    };

    window.setOrigin = function(ORIGIN, RADIUS_KM){
      depart.clearLayers();
      cercle = null;
      pointDepart = null;
      if (!ORIGIN) return;
      pointDepart = [ORIGIN.lat, ORIGIN.lng];
      var classe = ORIGIN.source === 'gps' ? 'gps' : 'zone';
      var taille = ORIGIN.source === 'gps' ? [16, 16] : [22, 22];
      var ancre = ORIGIN.source === 'gps' ? [8, 8] : [11, 22];
      L.marker(pointDepart, {
        icon: L.divIcon({ html: '<div class="' + classe + '"></div>', className: '', iconSize: taille, iconAnchor: ancre }),
        interactive: false,
      }).addTo(depart);
      if (RADIUS_KM) {
        cercle = L.circle(pointDepart, {
          radius: RADIUS_KM * 1000, color: '#1f6feb', weight: 2, fillColor: '#1f6feb', fillOpacity: 0.08,
          interactive: false,
        }).addTo(depart);
      }
      cadrer();
    };

    post({ type: 'ready' });
  </script>
</body>
</html>`;
}
```

- [ ] **Step 4 : tests et types**

Run: `node node_modules/vitest/vitest.mjs run lib` puis `npx tsc --noEmit -p tsconfig.json`
Expected: tout passe ; types propres.

- [ ] **Step 5 : commit**

```bash
git add lib/exploreMapHtml.ts lib/__tests__/exploreMapHtml.test.ts
git commit -m "feat(localisation): page Leaflet de la carte des parties (lot 3)"
```

---

### Task 3 : le composant carte + panneau

**Files:**
- Modify: `hooks/useOrigin.ts` (objet rendu par `useOrigin()`)
- Create: `components/lobby/ExploreMap.tsx`

**Interfaces:**
- Consumes : Task 1 (`MapMarker`, `panelRows`, `PanelRow`), Task 2 (`buildExploreMapHtml` et son contrat de messages), lot 1 (`Origin`, `DistanceOf` de `lib/geo.ts`).
- Produces :
  - `useOrigin()` rend en plus `clubIndex: Map<string, ClubPoint>` (positions des clubs par nom normalisé, déjà chargées par le magasin).
  - `<ExploreMap height markers unplaced games origin radiusKm distanceOf onOpenGame />` avec :
    - `height: number`
    - `markers: MapMarker[]`, `unplaced: number`
    - `games: PanelGame[]` (les parties affichées, pour le panneau — toute partie de l'Explorer convient)
    - `origin: Origin | null`
    - `radiusKm: number | null` (le rayon de « Distance max » quand il est actif, sinon `null`)
    - `distanceOf: DistanceOf`
    - `onOpenGame: (id: string) => void`

Pas de test automatique (composant React Native) : la logique vit dans les modules purs des tâches 1 et 2.

- [ ] **Step 1 : exposer l'index des clubs**

Dans `hooks/useOrigin.ts`, dans l'objet rendu par `useOrigin()`, après la ligne `distanceOf: s.distanceOf,`, ajouter :

```ts
    /** Positions des clubs par nom normalisé (lib/geo.normClubName) — la carte de l'Explorer. */
    clubIndex: s.index,
```

Vérifier que `ClubPoint` est bien déjà importé de `../lib/geo` dans ce fichier (il l'est pour le type de l'état).

- [ ] **Step 2 : écrire `components/lobby/ExploreMap.tsx`**

```tsx
// components/lobby/ExploreMap.tsx — la carte des parties de l'Explorer.
//
// Une WebView Leaflet (lib/exploreMapHtml.ts) pilotée par messages, et un
// panneau DESSINÉ DANS L'ÉCRAN (pas de <Modal> native) qui liste les parties
// du repère touché. Toucher une partie ouvre sa fiche habituelle.
//
// La page n'est jamais rechargée : un changement de filtre repousse les
// repères, la carte reste là où le joueur l'a laissée.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { Colors, Fonts } from '../../lib/theme';
import { Icon } from '../community/icons';
import { buildExploreMapHtml } from '../../lib/exploreMapHtml';
import { panelRows, type MapMarker } from '../../lib/mapMarkers';
import type { DistanceOf, Origin } from '../../lib/geo';

type PanelGame = Parameters<typeof panelRows>[0][number];

export function ExploreMap({ height, markers, unplaced, games, origin, radiusKm, distanceOf, onOpenGame }: {
  height: number;
  markers: MapMarker[];
  unplaced: number;
  games: PanelGame[];
  origin: Origin | null;
  radiusKm: number | null;
  distanceOf: DistanceOf;
  onOpenGame: (id: string) => void;
}) {
  const webref = useRef<WebView>(null);
  const [webReady, setWebReady] = useState(false);
  const [tuiles, setTuiles] = useState<'inconnu' | 'ok' | 'ko'>('inconnu');
  const [selection, setSelection] = useState<string | null>(null);
  const source = useMemo(() => ({ html: buildExploreMapHtml(), baseUrl: 'https://localhost' }), []);

  const injecter = useCallback((code: string) => {
    webref.current?.injectJavaScript(`${code}; true;`);
  }, []);

  // Point de départ d'abord (la carte se centre dessus), puis les repères.
  useEffect(() => {
    if (!webReady) return;
    injecter(`window.setOrigin && window.setOrigin(${JSON.stringify(origin)}, ${JSON.stringify(radiusKm)})`);
  }, [webReady, origin, radiusKm, injecter]);

  useEffect(() => {
    if (!webReady) return;
    injecter(`window.setMarkers && window.setMarkers(${JSON.stringify(markers)})`);
  }, [webReady, markers, injecter]);

  // Un repère disparu (filtre changé) ferme son panneau.
  const repere = selection ? markers.find(m => m.key === selection) ?? null : null;
  useEffect(() => {
    if (selection && !repere) setSelection(null);
  }, [selection, repere]);

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    const brut = e.nativeEvent.data;
    try {
      const msg = JSON.parse(brut);
      if (msg.type === 'ready') setWebReady(true);
      else if (msg.type === 'marker' && typeof msg.key === 'string') setSelection(msg.key);
      else if (msg.type === 'tiles') setTuiles(t => (t === 'ok' ? 'ok' : msg.ok ? 'ok' : 'ko'));
    } catch { /* message illisible : ignoré */ }
  }, []);

  const lignes = useMemo(
    () => (repere ? panelRows(games, repere, distanceOf) : []),
    [repere, games, distanceOf],
  );

  return (
    <View style={{ height, borderRadius: 16, overflow: 'hidden', backgroundColor: '#e9eef2', borderWidth: 1, borderColor: Colors.border }}>
      <WebView
        ref={webref}
        source={source}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        nestedScrollEnabled
        onMessage={onMessage}
        style={{ flex: 1, backgroundColor: '#e9eef2' }}
      />

      {!webReady && (
        <ActivityIndicator color={Colors.primary} style={{ position: 'absolute', top: 16, alignSelf: 'center' }} />
      )}

      {/* Hors ligne : la page est embarquée, mais le fond de carte vient du réseau. */}
      {tuiles === 'ko' && (
        <View style={{ position: 'absolute', top: 12, left: 12, right: 12, padding: 12, borderRadius: 12, backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border }}>
          <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>Carte indisponible hors ligne</Text>
          <Text style={{ fontSize: 12, fontFamily: Fonts.ui, color: Colors.textSecondary, marginTop: 2 }}>
            Repasse en « Liste » pour voir les parties.
          </Text>
        </View>
      )}

      {webReady && markers.length === 0 && tuiles !== 'ko' && (
        <View style={{ position: 'absolute', top: 12, left: 12, right: 12, padding: 12, borderRadius: 12, backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border }}>
          <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>Aucune partie à placer sur la carte</Text>
          <Text style={{ fontSize: 12, fontFamily: Fonts.ui, color: Colors.textSecondary, marginTop: 2 }}>
            Élargis tes filtres, ou repasse en « Liste ».
          </Text>
        </View>
      )}

      {unplaced > 0 && !repere && markers.length > 0 && (
        <View style={{ position: 'absolute', bottom: 12, left: 12, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border }}>
          <Text style={{ fontSize: 11, fontFamily: Fonts.uiBold, color: Colors.textSecondary }}>
            {unplaced} partie{unplaced > 1 ? 's' : ''} sans position connue
          </Text>
        </View>
      )}

      {/* Panneau du repère touché — dans l'écran, jamais une fenêtre native. */}
      {repere && (
        <View style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '60%',
          backgroundColor: Colors.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18,
          borderTopWidth: 1, borderColor: Colors.border, paddingTop: 12, paddingHorizontal: 14, paddingBottom: 10,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={2} style={{ fontSize: 15, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>{repere.label}</Text>
              <Text style={{ fontSize: 11.5, fontFamily: Fonts.ui, color: Colors.textSecondary, marginTop: 2 }}>
                {repere.kind === 'city'
                  ? `Emplacement exact inconnu · ${repere.clubs.length} club${repere.clubs.length > 1 ? 's' : ''}`
                  : `${lignes.length} partie${lignes.length > 1 ? 's' : ''}`}
              </Text>
            </View>
            <TouchableOpacity onPress={() => setSelection(null)} hitSlop={10} accessibilityLabel="Fermer">
              <Icon name="x" size={18} color={Colors.textMuted} stroke={2.4} />
            </TouchableOpacity>
          </View>
          <ScrollView nestedScrollEnabled>
            {lignes.map(l => (
              <TouchableOpacity
                key={l.id}
                onPress={() => onOpenGame(l.id)}
                activeOpacity={0.8}
                style={{ paddingVertical: 10, borderTopWidth: 1, borderTopColor: Colors.border, flexDirection: 'row', alignItems: 'center', gap: 10 }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>{l.when}</Text>
                  <Text numberOfLines={1} style={{ fontSize: 12, fontFamily: Fonts.ui, color: Colors.textSecondary, marginTop: 2 }}>
                    {[repere.kind === 'city' ? l.club : null, l.level ? `Niv. ${l.level}` : null, l.places, l.distance]
                      .filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Icon name="chevronRight" size={16} color={Colors.textMuted} stroke={2.4} />
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}
```

- [ ] **Step 3 : types et tests**

Run: `npx tsc --noEmit -p tsconfig.json` puis `node node_modules/vitest/vitest.mjs run lib`
Expected: types propres ; tests verts (garde-fous compris). Si le type `PanelGame` extrait de `panelRows` pose problème à TypeScript, exporter plutôt le type `PanelGame` depuis `lib/mapMarkers.ts` et l'importer ici — le signaler dans le rapport.

- [ ] **Step 4 : commit**

```bash
git add hooks/useOrigin.ts components/lobby/ExploreMap.tsx
git commit -m "feat(localisation): composant carte de l'Explorer avec panneau des parties (lot 3)"
```

---

### Task 4 : bascule Liste | Carte dans l'Explorer

**Files:**
- Modify: `app/(tabs)/lobby.tsx` (composant principal : état, `ScrollView` ; `ExploreTab` : bascule, mode carte ; `GameCard` : libellé de niveau)

**Interfaces:**
- Consumes : Task 1 (`groupMapMarkers`, `levelRangeLabel`), Task 3 (`ExploreMap`, `useOrigin().clubIndex`), lot 1 (`normClubName` de `lib/geo.ts`, `useOrigin()` déjà appelé dans `ExploreTab`).
- Produces : rien pour la suite.

**Contexte :** `app/(tabs)/lobby.tsx` fait ~3 800 lignes. Le composant principal rend `<ScrollView style={{ flex: 1 }} … refreshControl={…}>` qui contient `{tab === 'explorer' && (<ExploreTab … />)}`. `ExploreTab` rend, dans un `<View style={{ paddingBottom: 100 }}>`, d'abord les commandes (barre de recherche, rangée Filtres/Urgent, encart « près de toi », rangée « Trier », sortie « Aucune partie ne correspond », volet `ExploreFilterSheet`), puis les listes (« Pour toi », carte d'exemple de la visite guidée, liste principale). Une WebView dans une `ScrollView` se dispute les gestes : en mode carte, le défilement de la `ScrollView` est coupé.

- [ ] **Step 1 : état et défilement dans le composant principal**

Dans le composant principal, juste après `const [exploreFilters, setExploreFilters] = useState<ExploreFilters>(NO_EXPLORE_FILTERS);`, ajouter :

```tsx
  // Explorer : liste ou carte. En mode carte, la page ne défile plus (la carte
  // prend les gestes) et on mesure la hauteur disponible pour la dimensionner.
  const [exploreView, setExploreView] = useState<'list' | 'map'>('list');
  const [viewportH, setViewportH] = useState(0);
```

Sur la `<ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} refreshControl={…}>` du contenu, ajouter les deux props :

```tsx
          scrollEnabled={!(tab === 'explorer' && exploreView === 'map')}
          onLayout={e => { const h = e.nativeEvent.layout.height; setViewportH(prev => (Math.abs(prev - h) < 1 ? prev : h)); }}
```

Dans `<ExploreTab … />`, ajouter les props :

```tsx
              view={exploreView}
              setView={setExploreView}
              viewportHeight={viewportH}
```

- [ ] **Step 2 : props et données de la carte dans `ExploreTab`**

Ajouter à la signature de `ExploreTab` (déstructuration) `view, setView, viewportHeight,` et à son type de props :

```tsx
  view: 'list' | 'map';
  setView: (v: 'list' | 'map') => void;
  /** Hauteur visible de la zone de contenu (mesurée par l'écran). */
  viewportHeight: number;
```

Compléter la déstructuration de `useOrigin()` déjà présente dans `ExploreTab` en y ajoutant `clubIndex` (garder tous les champs existants). Ajouter les imports en tête de fichier :

```ts
import { ExploreMap } from '../../components/lobby/ExploreMap';
import { groupMapMarkers } from '../../lib/mapMarkers';
```

et ajouter `normClubName` à l'import existant depuis `'../../lib/geo'`, ainsi que `levelRangeLabel` à l'import existant depuis `'../../lib/games'`.

Dans `ExploreTab`, juste après la déclaration de `const filtered = mainListAll;`, ajouter :

```tsx
  // La carte montre EXACTEMENT les parties retenues par les filtres (recherche
  // comprise) : même liste que la vue « Liste ».
  const carte = useMemo(
    () => groupMapMarkers(filtered, l => clubIndex.get(normClubName(l)) ?? null, villeDuClub),
    [filtered, clubIndex, villeDuClub],
  );
  // Hauteur mesurée des commandes au-dessus de la carte.
  const [commandesH, setCommandesH] = useState(0);
  const hauteurCarte = Math.max(300, viewportHeight - commandesH - 100 - 12);
```

- [ ] **Step 3 : la bascule en haut de l'Explorer**

Dans le rendu de `ExploreTab`, envelopper TOUT ce qui précède le bloc `{/* "Pour toi" — pile verticale des parties à ton niveau */}` (c'est-à-dire la barre de recherche, la rangée Filtres/Urgent, l'encart, la rangée « Trier », la sortie « Aucune partie ne correspond » et `<ExploreFilterSheet … />`) dans :

```tsx
      <View onLayout={e => { const h = e.nativeEvent.layout.height; setCommandesH(prev => (Math.abs(prev - h) < 1 ? prev : h)); }}>
        {/* … le bloc existant, inchangé … */}
      </View>
```

Puis, comme PREMIER enfant de cette `View` (au-dessus de la barre de recherche), ajouter la bascule :

```tsx
        {/* Liste | Carte : mêmes parties, mêmes filtres, deux façons de les voir. */}
        <View style={{ flexDirection: 'row', gap: 6, marginHorizontal: 14, marginTop: 12, padding: 4, borderRadius: 12, backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border }}>
          {([['list', 'Liste'], ['map', 'Carte']] as const).map(([v, l]) => {
            const on = view === v;
            return (
              <TouchableOpacity
                key={v}
                onPress={() => setView(v)}
                activeOpacity={0.85}
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, borderRadius: 9, backgroundColor: on ? Colors.primary : 'transparent' }}
              >
                <Icon name={v === 'list' ? 'bookOpen' : 'map'} size={14} color={on ? Colors.brand : Colors.textSecondary} stroke={2.3} />
                <Text style={{ fontSize: 12.5, fontFamily: Fonts.uiBlack, color: on ? Colors.textOnDark : Colors.textSecondary }}>{l}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
```

La barre de recherche a aujourd'hui `marginTop: 12` : la passer à `marginTop: 10` pour garder le même souffle sous la bascule.

- [ ] **Step 4 : le mode carte à la place des listes**

Juste après la `View` enveloppante de l'étape 3 (donc avant `{/* "Pour toi" … */}`), ajouter :

```tsx
      {view === 'map' && (
        <View style={{ paddingHorizontal: 14 }}>
          <ExploreMap
            height={hauteurCarte}
            markers={carte.markers}
            unplaced={carte.unplaced}
            games={filtered}
            origin={origin}
            radiusKm={filters.maxKm}
            distanceOf={distanceOf}
            onOpenGame={id => { const g = filtered.find(x => x.id === id); if (g) onOpenGame(g); }}
          />
        </View>
      )}
```

Puis conditionner les trois blocs de liste à `view === 'list'` : remplacer `{showForYou && (` par `{view === 'list' && showForYou && (`, `{showTourDemo && tourDemoGame && (` par `{view === 'list' && showTourDemo && tourDemoGame && (`, et `{(mainList.length > 0 || !showForYou) && (` par `{view === 'list' && (mainList.length > 0 || !showForYou) && (`.

- [ ] **Step 5 : un seul libellé de niveau**

Dans `GameCard`, remplacer :

```tsx
  const eloRange = gameEloRange(game);
  const levelRange = eloRange
    ? (fmtLevel(eloRange.min) === fmtLevel(eloRange.max)
        ? fmtLevel(eloRange.min)
        : `${fmtLevel(eloRange.min)} – ${fmtLevel(eloRange.max)}`)
    : null;
```

par :

```tsx
  // Même libellé que le panneau de la carte (lib/games.levelRangeLabel).
  const levelRange = levelRangeLabel(game);
```

Si `eloRange` est encore utilisé ailleurs dans `GameCard`, garder la ligne `const eloRange = gameEloRange(game);` et ne remplacer que le calcul de `levelRange`. Si `fmtLevel` ou `gameEloRange` deviennent inutilisés dans le fichier, ne pas les supprimer s'ils servent ailleurs (vérifier par recherche) ; sinon les retirer.

- [ ] **Step 6 : types et tests**

Run: `npx tsc --noEmit -p tsconfig.json` puis `node node_modules/vitest/vitest.mjs run lib`
Expected: types propres ; tous les tests verts (garde-fous compris : les deux nouveaux `onLayout` lisent la hauteur AVANT la fonction de mise à jour).

- [ ] **Step 7 : commit**

```bash
git add "app/(tabs)/lobby.tsx"
git commit -m "feat(localisation): bascule Liste | Carte dans l'Explorer (lot 3)"
```

---

### Task 5 : livraison (contrôleur + utilisateur)

Pas de sous-agent, pas de migration.

- [ ] **Step 1 : publier sur le canal de test**

Run: `EAS_SKIP_AUTO_FINGERPRINT=1 npx eas update --branch preview --environment preview --message "Localisation lot 3 : carte des parties dans l'Explorer" --non-interactive`
Puis `npx eas update:list --branch preview --limit 1 --non-interactive` pour vérifier.

- [ ] **Step 2 : essais sur téléphone (utilisateur)**

1. Explorer → « Carte » : la page ne défile plus, la carte prend la hauteur restante ; retour à « Liste » : tout redevient comme avant.
2. Repères : aujourd'hui presque tous les clubs sont placés au centre de leur ville → un cercle atténué par ville (« emplacement exact inconnu ») avec le nombre de parties.
3. Point de départ : point bleu si la position est autorisée, sinon l'épingle de ta zone ; cercle bleu si « Distance max » est actif ; la carte se centre dessus à l'ouverture.
4. Changer un filtre ou taper une recherche : les repères changent, la carte ne se recharge pas et ne bouge pas.
5. Toucher un repère : panneau en bas avec heure, niveau, places, distance ; toucher une partie ouvre sa fiche.
6. Mode avion : « Carte indisponible hors ligne » ; « Liste » reste utilisable.
7. Assistant de création → carte des clubs : inchangée.
