# Localisation — Lot 1 (socle + Explorer) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner à l'app un point de départ (GPS du téléphone ou zone choisie sur la carte) et l'utiliser dans l'Explorer : distance sur chaque carte de partie, filtre « Distance max », tri « Proximité ».

**Architecture:** Toute la géométrie est pure et testée dans `lib/geo.ts`. Le module natif `expo-location` n'est chargé que par `lib/location.ts`, après vérification que le module natif existe (un ancien APK ne l'a pas). La zone vit dans une table `player_zones` protégée par des règles d'accès ; `lib/playerZone.ts` la lit et l'écrit. Un magasin partagé (`hooks/useOrigin.ts`) résout le point de départ (GPS récent → zone → aucun) et fournit une fonction `distanceOf` mémoïsée, utilisée à la fois par les cartes, le filtre, le compteur de l'onglet et le tri.

**Tech Stack:** React Native 0.86 / Expo SDK 57, TypeScript, Supabase (Postgres + règles d'accès), `expo-location` ~57.0.18, `react-native-webview` + Leaflet embarqué, vitest.

**Spec:** `docs/superpowers/specs/2026-09-17-localisation-design.md` (section 4 « Lot 1 », sections 5 à 7).

## Global Constraints

- Calcul des distances **dans le téléphone**, à partir des coordonnées des clubs. **La position GPS n'est jamais envoyée au serveur.**
- `expo-location` n'est **jamais importé directement** : chargé à l'exécution, son absence (ancien APK) équivaut à un GPS indisponible. Un test garde-fou refuse tout import direct.
- GPS : utilisé si autorisé et position de **moins de 10 minutes**. Autorisation demandée à la **première utilisation d'une fonction de distance, jamais au lancement**. Délai maximal **8 s**, puis repli.
- Ordre de résolution : 1. GPS, 2. zone de référence, 3. aucun (fonctions de distance grisées, encart « Choisis ta zone »). Le point de départ porte sa source ; l'interface l'affiche (« depuis ta position » / « depuis ta zone »).
- Zone : table `player_zones` (`player_id` clé, `lat`, `lng`, `radius_km`, `updated_at`), lecture et écriture **par le joueur uniquement**. Coordonnées **arrondies au 0,005° le plus proche** avant enregistrement, côté app **et** contrôlé côté serveur. Rayons **5 / 10 / 20 / 40 km** ; **20 km** par défaut sans zone.
- Affichage des distances : « 800 m » sous 1 km, « 4,2 km » sous 10 km, « 23 km » au-delà. Club placé au centre-ville → « ~12 km ». Lieu inconnu → rien.
- Coordonnées des clubs retrouvées **par nom normalisé** (même règle que `lib/maps.ts` : `trim().toLowerCase()`), avec leur précision (`geo_confidence = 'exact'` = précis, tout le reste = approximatif).
- Filtre « Distance max » : `maxKm` ∈ {5, 10, 20, 40, null}. Refus si distance inconnue, **approximative**, ou supérieure à `maxKm`. À la première activation, prend le rayon de la zone (20 km sans zone). Compte dans le nombre de filtres, libellé « Distance », proposé par la sortie « retire ce filtre ».
- Tri **Date | Proximité** : état d'affichage, **jamais enregistré** ; distances précises croissantes, puis approximatives, puis inconnues ; la date départage.
- Distances calculées **une fois par point de départ** (mémoïsation), pas à chaque rendu.
- L'app tolère une migration absente : si la table `player_zones` n'existe pas, tout ce qui concerne la zone est masqué, sans erreur.
- Échec d'enregistrement de la zone : message clair, ancienne zone conservée.
- Textes d'interface en français, tutoiement, sans jargon. Emoji 🎾 interdit partout.
- L'accueil reste sur une seule page sans défilement : la distance d'une carte s'affiche **sur la ligne du club**, sans ajouter de hauteur.
- Ne jamais lire `e.nativeEvent` dans une fonction passée à `setState` (garde-fou `lib/__tests__/nativeEventInUpdater.test.ts`).
- Depuis une `<Modal>` React Native : fermer la fenêtre **avant** `router.push`.

### Règles du dépôt (valables pour chaque tâche)

- Travail directement sur `main`. Commits locaux par tâche, **jamais poussés**. `git add` uniquement les fichiers précis de la tâche — **jamais** `git add -A` / `git add .`, jamais `git stash`, `git checkout --`, `git restore`.
- Le dossier `supabase/` n'est **pas versionné** (dépôt GitHub public) : le fichier de migration est créé mais jamais ajouté à git. Le dossier `android/` n'est pas touché par les tâches.
- Tests : `node node_modules/vitest/vitest.mjs run lib` depuis la racine. Types : `npx tsc --noEmit -p tsconfig.json`.
- Windows : les heredocs Python/bash mangent antislashs et guillemets ; pour un script ponctuel, écrire un fichier puis l'exécuter.
- Message de commit terminé par la ligne `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## Carte des fichiers

| Fichier | Rôle |
|---|---|
| `lib/geo.ts` (créé) | Pur : distance, affichage, index des clubs, `distanceOf` mémoïsé, tri de proximité, arrondi de zone, résolution du point de départ |
| `lib/__tests__/geo.test.ts` (créé) | Tests de `lib/geo.ts` |
| `lib/maps.ts`, `lib/clubsMap.ts` (modifiés) | Utilisent `normClubName` de `lib/geo.ts` au lieu de leur copie locale |
| `package.json`, `package-lock.json`, `app.json` (modifiés) | `expo-location`, alignement de `react-dom`, textes d'autorisation iOS |
| `lib/location.ts` (créé) | Seul accès au GPS, chargement prudent du module natif |
| `lib/__tests__/noDirectExpoLocation.test.ts` (créé) | Garde-fou : personne d'autre ne nomme `expo-location` |
| `lib/exploreFilters.ts`, `lib/savedFilters.ts` (+ tests) (modifiés) | `maxKm`, raison `distance`, `ctx.distanceOf` ; « Distance » ignorée par les alertes jusqu'au lot 4 |
| `supabase/migrations/player_zones.sql` (créé, non versionné) | Table, arrondi serveur, règles d'accès, effacement à la suppression du compte |
| `lib/playerZone.ts` (+ `lib/__tests__/playerZone.test.ts`) (créés) | Lecture / écriture / suppression de la zone, détection de la migration absente |
| `hooks/useOrigin.ts` (créé) | Magasin partagé du point de départ |
| `lib/zoneMapHtml.ts` (+ test) , `app/zone.tsx` (créés) | Écran « Ma zone » (épingle déplaçable + rayon) |
| `app/_layout.tsx`, `components/profile/ProfileMenuSheet.tsx`, `app/legal/confidentialite.tsx`, `lib/legal.ts` (modifiés) | Route, entrée de menu, politique de confidentialité |
| `app/(tabs)/lobby.tsx` (modifié) | Distance sur `GameCard`, `distanceOf` dans les calculs, tri, encart |
| `components/lobby/ExploreFilterSheet.tsx` (modifié) | Section « Distance » du volet |

---

### Task 1 : géométrie pure (`lib/geo.ts`)

**Files:**
- Create: `lib/geo.ts`
- Create: `lib/__tests__/geo.test.ts`
- Modify: `lib/maps.ts` (constante `norm`), `lib/clubsMap.ts` (constante `norm`)

**Interfaces:**
- Consumes: rien.
- Produces (utilisé par toutes les tâches suivantes) :
  - `interface LatLng { lat: number; lng: number }`
  - `type OriginSource = 'gps' | 'zone'` ; `interface Origin extends LatLng { source: OriginSource }`
  - `interface ClubPoint extends LatLng { approx: boolean }`
  - `interface GameDistance { km: number; approx: boolean }`
  - `interface GpsFix extends LatLng { at: number }` (horodatage en ms)
  - `interface ZonePoint extends LatLng { radiusKm: number }`
  - `interface ClubRow { name: string | null; latitude: number | null; longitude: number | null; geo_confidence: string | null }`
  - `type DistanceOf = (location: string | null | undefined) => GameDistance | null`
  - `const ZONE_RADII_KM: readonly [5, 10, 20, 40]`, `DEFAULT_RADIUS_KM = 20`, `GPS_MAX_AGE_MS = 600000`, `GPS_TIMEOUT_MS = 8000`, `ZONE_STEP_DEG = 0.005`, `DEFAULT_MAP_CENTER: LatLng`
  - `haversineKm(a: LatLng, b: LatLng): number`
  - `formatKm(km: number): string` ; `formatGameDistance(d: GameDistance): string`
  - `normClubName(s: string): string`
  - `buildClubIndex(rows: ClubRow[]): Map<string, ClubPoint>`
  - `makeDistanceOf(origin: LatLng | null, index: Map<string, ClubPoint>): DistanceOf`
  - `sortByProximity<T extends { location?: string | null; match_date?: string | null }>(games: T[], distanceOf: DistanceOf): T[]`
  - `roundZoneCoord(x: number): number`
  - `isZoneRadius(n: unknown): n is 5 | 10 | 20 | 40`
  - `resolveOrigin(gps: GpsFix | null, zone: LatLng | null, now: number): Origin | null`
  - `originLabel(o: Origin): string`
  - `initialZoneCenter(zone: LatLng | null, gps: GpsFix | null): LatLng`

- [ ] **Step 1 : écrire les tests qui échouent**

Créer `lib/__tests__/geo.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import {
  haversineKm, formatKm, formatGameDistance, normClubName, buildClubIndex, makeDistanceOf,
  sortByProximity, roundZoneCoord, isZoneRadius, resolveOrigin, originLabel, initialZoneCenter,
  DEFAULT_MAP_CENTER, GPS_MAX_AGE_MS, type ClubRow,
} from '../geo';

const CASA = { lat: 33.5731, lng: -7.5898 };
const RABAT = { lat: 34.0209, lng: -6.8416 };

describe('distance à vol d oiseau', () => {
  it('Casablanca → Rabat : environ 85 km', () => {
    const km = haversineKm(CASA, RABAT);
    expect(km).toBeGreaterThan(84);
    expect(km).toBeLessThan(86.5);
  });
  it('un point vers lui-même : 0', () => {
    expect(haversineKm(CASA, CASA)).toBe(0);
  });
});

describe('affichage', () => {
  it('sous 1 km : en mètres, par pas de 50 m, jamais 0', () => {
    expect(formatKm(0.8)).toBe('800 m');
    expect(formatKm(0.012)).toBe('50 m');
    expect(formatKm(0.34)).toBe('350 m');
  });
  it('sous 10 km : une décimale, virgule française', () => {
    expect(formatKm(4.24)).toBe('4,2 km');
    expect(formatKm(0.99)).toBe('1,0 km');
  });
  it('à partir de 10 km : arrondi au kilomètre', () => {
    expect(formatKm(23.4)).toBe('23 km');
    expect(formatKm(9.96)).toBe('10 km');
  });
  it('club au centre-ville : distance précédée de ~', () => {
    expect(formatGameDistance({ km: 12.2, approx: true })).toBe('~12 km');
    expect(formatGameDistance({ km: 4.24, approx: false })).toBe('4,2 km');
  });
});

describe('index des clubs', () => {
  const rows: ClubRow[] = [
    { name: ' Padel 4 Maroc ', latitude: 33.53, longitude: -7.64, geo_confidence: 'exact' },
    { name: 'Club Centre', latitude: 33.5731, longitude: -7.5898, geo_confidence: 'city' },
    { name: 'Sans position', latitude: null, longitude: null, geo_confidence: 'city' },
    { name: null, latitude: 1, longitude: 1, geo_confidence: 'exact' },
  ];
  it('nom normalisé comme lib/maps.ts, précision lue sur geo_confidence', () => {
    const index = buildClubIndex(rows);
    expect(normClubName('  Padel 4 MAROC ')).toBe('padel 4 maroc');
    expect(index.get('padel 4 maroc')).toEqual({ lat: 33.53, lng: -7.64, approx: false });
    expect(index.get('club centre')).toEqual({ lat: 33.5731, lng: -7.5898, approx: true });
    expect(index.has('sans position')).toBe(false);
    expect(index.size).toBe(2);
  });
  it('deux clubs du même nom : la position précise l emporte', () => {
    const index = buildClubIndex([
      { name: 'Doublon', latitude: 33.5, longitude: -7.6, geo_confidence: 'exact' },
      { name: 'doublon', latitude: 33.57, longitude: -7.58, geo_confidence: 'city' },
    ]);
    expect(index.get('doublon')).toEqual({ lat: 33.5, lng: -7.6, approx: false });
  });
});

describe('distance d une partie', () => {
  const index = buildClubIndex([
    { name: 'Padel 4 Maroc', latitude: 33.5331, longitude: -7.645, geo_confidence: 'exact' },
    { name: 'Club Centre', latitude: 33.6, longitude: -7.5, geo_confidence: 'city' },
  ]);
  it('sans point de départ, ou lieu vide ou inconnu : null', () => {
    expect(makeDistanceOf(null, index)('Padel 4 Maroc')).toBeNull();
    const d = makeDistanceOf(CASA, index);
    expect(d('')).toBeNull();
    expect(d(null)).toBeNull();
    expect(d('Club inconnu')).toBeNull();
  });
  it('club précis et club au centre-ville', () => {
    const d = makeDistanceOf(CASA, index);
    const precis = d('padel 4 maroc ')!;
    expect(precis.approx).toBe(false);
    expect(precis.km).toBeGreaterThan(6.5);
    expect(precis.km).toBeLessThan(7);
    expect(d('Club Centre')!.approx).toBe(true);
  });
  it('calculée une seule fois par lieu : même objet rendu', () => {
    const d = makeDistanceOf(CASA, index);
    expect(d('Padel 4 Maroc')).toBe(d('PADEL 4 MAROC'));
  });
});

describe('tri de proximité', () => {
  const distances: Record<string, { km: number; approx: boolean } | null> = {
    loin: { km: 20, approx: false },
    pres: { km: 3, approx: false },
    centre: { km: 1, approx: true },
    inconnu: null,
  };
  const distanceOf = (l: string | null | undefined) => (l ? distances[l] ?? null : null);
  const p = (id: string, location: string, jour: number) =>
    ({ id, location, match_date: new Date(2026, 8, jour, 19).toISOString() });

  it('précises croissantes, puis approximatives, puis inconnues', () => {
    const tri = sortByProximity([
      p('a', 'inconnu', 1), p('b', 'centre', 1), p('c', 'loin', 1), p('d', 'pres', 1),
    ], distanceOf);
    expect(tri.map(g => g.id)).toEqual(['d', 'c', 'b', 'a']);
  });
  it('à distance égale, la date départage', () => {
    const tri = sortByProximity([p('tard', 'pres', 9), p('tot', 'pres', 5)], distanceOf);
    expect(tri.map(g => g.id)).toEqual(['tot', 'tard']);
  });
  it('ne modifie pas la liste reçue', () => {
    const liste = [p('c', 'loin', 1), p('d', 'pres', 1)];
    sortByProximity(liste, distanceOf);
    expect(liste.map(g => g.id)).toEqual(['c', 'd']);
  });
});

describe('zone', () => {
  it('coordonnées arrondies au 0,005° le plus proche', () => {
    expect(roundZoneCoord(33.5731)).toBe(33.575);
    expect(roundZoneCoord(-7.5898)).toBe(-7.59);
    expect(roundZoneCoord(33.575)).toBe(33.575);
    expect(roundZoneCoord(0.0024)).toBe(0);
  });
  it('rayons permis : 5, 10, 20, 40', () => {
    expect([5, 10, 20, 40].every(isZoneRadius)).toBe(true);
    expect(isZoneRadius(15)).toBe(false);
    expect(isZoneRadius('20')).toBe(false);
  });
});

describe('point de départ', () => {
  const now = 1_800_000_000_000;
  const zone = { lat: 33.575, lng: -7.59 };
  it('GPS de moins de 10 minutes : prioritaire', () => {
    const gps = { lat: 34, lng: -6.8, at: now - GPS_MAX_AGE_MS };
    expect(resolveOrigin(gps, zone, now)).toEqual({ lat: 34, lng: -6.8, source: 'gps' });
  });
  it('GPS trop ancien : la zone prend le relais', () => {
    const gps = { lat: 34, lng: -6.8, at: now - GPS_MAX_AGE_MS - 1 };
    expect(resolveOrigin(gps, zone, now)).toEqual({ ...zone, source: 'zone' });
    expect(resolveOrigin(gps, null, now)).toBeNull();
  });
  it('ni GPS ni zone : aucun point de départ', () => {
    expect(resolveOrigin(null, null, now)).toBeNull();
  });
  it('libellé de la source', () => {
    expect(originLabel({ lat: 0, lng: 0, source: 'gps' })).toBe('depuis ta position');
    expect(originLabel({ lat: 0, lng: 0, source: 'zone' })).toBe('depuis ta zone');
  });
  it('centre de la carte de zone : zone, sinon GPS, sinon Casablanca', () => {
    expect(initialZoneCenter(zone, { lat: 1, lng: 1, at: now })).toEqual(zone);
    expect(initialZoneCenter(null, { lat: 1, lng: 2, at: now })).toEqual({ lat: 1, lng: 2 });
    expect(initialZoneCenter(null, null)).toEqual(DEFAULT_MAP_CENTER);
  });
});
```

- [ ] **Step 2 : lancer les tests, vérifier l'échec**

Run: `node node_modules/vitest/vitest.mjs run lib/__tests__/geo.test.ts`
Expected: FAIL — `Failed to resolve import "../geo"`.

- [ ] **Step 3 : écrire `lib/geo.ts`**

```ts
// lib/geo.ts — distances à vol d'oiseau entre le joueur et les clubs.
//
// PUR ET TESTÉ (lib/__tests__/geo.test.ts) : aucun accès réseau, aucun module
// natif. Le GPS vit dans lib/location.ts, la zone dans lib/playerZone.ts, et
// hooks/useOrigin.ts assemble le tout.
//
// Les parties désignent leur club par son NOM (open_games.location) : on
// retrouve la position du club par nom normalisé, avec sa précision. Un club
// « city » est placé au centre de sa ville : sa distance est approximative et
// s'affiche « ~12 km ».

export interface LatLng { lat: number; lng: number }
export type OriginSource = 'gps' | 'zone';
export interface Origin extends LatLng { source: OriginSource }
export interface ClubPoint extends LatLng { approx: boolean }
export interface GameDistance { km: number; approx: boolean }
/** Position du téléphone, avec l'heure où elle a été mesurée (ms). */
export interface GpsFix extends LatLng { at: number }
export interface ZonePoint extends LatLng { radiusKm: number }
export interface ClubRow {
  name: string | null;
  latitude: number | null;
  longitude: number | null;
  geo_confidence: string | null;
}
export type DistanceOf = (location: string | null | undefined) => GameDistance | null;

export const ZONE_RADII_KM = [5, 10, 20, 40] as const;
export const DEFAULT_RADIUS_KM = 20;
/** Une position GPS plus vieille ne décrit plus où est le joueur. */
export const GPS_MAX_AGE_MS = 10 * 60 * 1000;
/** Au-delà, on renonce au GPS et on se replie sur la zone. */
export const GPS_TIMEOUT_MS = 8000;
/** Pas d'arrondi de la zone : ~550 m en latitude, ~460 m en longitude au Maroc. */
export const ZONE_STEP_DEG = 0.005;
/** Casablanca : centre de la carte quand on ne sait rien du joueur. */
export const DEFAULT_MAP_CENTER: LatLng = { lat: 33.5731, lng: -7.5898 };

const RAYON_TERRE_KM = 6371;

export function haversineKm(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * RAYON_TERRE_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** « 800 m » sous 1 km, « 4,2 km » sous 10 km, « 23 km » au-delà. */
export function formatKm(km: number): string {
  const metres = Math.round((km * 1000) / 50) * 50;
  if (metres < 1000) return `${Math.max(50, metres)} m`;
  const unDecimal = Math.round(km * 10) / 10;
  if (unDecimal < 10) return `${unDecimal.toFixed(1).replace('.', ',')} km`;
  return `${Math.round(km)} km`;
}

export function formatGameDistance(d: GameDistance): string {
  return d.approx ? `~${formatKm(d.km)}` : formatKm(d.km);
}

/** Même règle que lib/maps.ts et lib/clubsMap.ts, qui l'importent d'ici. */
export function normClubName(s: string): string {
  return s.trim().toLowerCase();
}

export function buildClubIndex(rows: ClubRow[]): Map<string, ClubPoint> {
  const index = new Map<string, ClubPoint>();
  for (const r of rows) {
    if (!r.name || r.latitude == null || r.longitude == null) continue;
    const cle = normClubName(r.name);
    const point: ClubPoint = {
      lat: Number(r.latitude), lng: Number(r.longitude), approx: r.geo_confidence !== 'exact',
    };
    const deja = index.get(cle);
    // Deux clubs du même nom : ne jamais remplacer une position précise par
    // une position de centre-ville.
    if (deja && !deja.approx && point.approx) continue;
    index.set(cle, point);
  }
  return index;
}

/**
 * La distance de chaque lieu depuis `origin`, calculée UNE fois par lieu : la
 * fonction rendue garde ses résultats. Un nouveau point de départ = une
 * nouvelle fonction (hooks/useOrigin.ts s'en charge).
 */
export function makeDistanceOf(origin: LatLng | null, index: Map<string, ClubPoint>): DistanceOf {
  const memo = new Map<string, GameDistance | null>();
  return (location) => {
    if (!origin || !location || !location.trim()) return null;
    const cle = normClubName(location);
    if (memo.has(cle)) return memo.get(cle) ?? null;
    const club = index.get(cle);
    const d = club ? { km: haversineKm(origin, club), approx: club.approx } : null;
    memo.set(cle, d);
    return d;
  };
}

/** Précises croissantes, puis approximatives, puis inconnues ; la date départage. */
export function sortByProximity<T extends { location?: string | null; match_date?: string | null }>(
  games: T[], distanceOf: DistanceOf,
): T[] {
  const rang = (d: GameDistance | null) => (d == null ? 2 : d.approx ? 1 : 0);
  const quand = (g: T) => {
    const t = g.match_date ? new Date(g.match_date).getTime() : NaN;
    return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
  };
  return games
    .map(g => ({ g, d: distanceOf(g.location) }))
    .sort((a, b) =>
      rang(a.d) - rang(b.d)
      || (a.d && b.d ? a.d.km - b.d.km : 0)
      || quand(a.g) - quand(b.g))
    .map(x => x.g);
}

/** Arrondi au 0,005° le plus proche — le serveur applique la même règle. */
export function roundZoneCoord(x: number): number {
  return Number((Math.round(x / ZONE_STEP_DEG) * ZONE_STEP_DEG).toFixed(3)) || 0;
}

export function isZoneRadius(n: unknown): n is (typeof ZONE_RADII_KM)[number] {
  return typeof n === 'number' && (ZONE_RADII_KM as readonly number[]).includes(n);
}

/** GPS récent → zone → aucun. */
export function resolveOrigin(gps: GpsFix | null, zone: LatLng | null, now: number): Origin | null {
  if (gps && now - gps.at <= GPS_MAX_AGE_MS) return { lat: gps.lat, lng: gps.lng, source: 'gps' };
  if (zone) return { lat: zone.lat, lng: zone.lng, source: 'zone' };
  return null;
}

export function originLabel(o: Origin): string {
  return o.source === 'gps' ? 'depuis ta position' : 'depuis ta zone';
}

/** Où poser l'épingle en ouvrant « Ma zone ». */
export function initialZoneCenter(zone: LatLng | null, gps: GpsFix | null): LatLng {
  if (zone) return { lat: zone.lat, lng: zone.lng };
  if (gps) return { lat: gps.lat, lng: gps.lng };
  return DEFAULT_MAP_CENTER;
}
```

- [ ] **Step 4 : brancher `lib/maps.ts` et `lib/clubsMap.ts` sur `normClubName`**

Dans `lib/maps.ts`, remplacer la ligne :

```ts
const norm = (s: string) => s.trim().toLowerCase();
```

par :

```ts
import { normClubName as norm } from './geo';
```

(placer l'import avec les autres imports en tête du fichier et supprimer la ligne `const norm`). Faire exactement la même chose dans `lib/clubsMap.ts`.

- [ ] **Step 5 : lancer les tests et les types**

Run: `node node_modules/vitest/vitest.mjs run lib` puis `npx tsc --noEmit -p tsconfig.json`
Expected: tous les tests passent (739 existants + ceux de `geo.test.ts`), types propres.

- [ ] **Step 6 : commit**

```bash
git add lib/geo.ts lib/__tests__/geo.test.ts lib/maps.ts lib/clubsMap.ts
git commit -m "feat(localisation): géométrie pure des distances (lot 1)"
```

---

### Task 2 : module GPS chargé prudemment

**Files:**
- Modify: `package.json`, `package-lock.json`, `app.json`
- Create: `lib/location.ts`
- Create: `lib/__tests__/noDirectExpoLocation.test.ts`

**Interfaces:**
- Consumes (Task 1) : `GpsFix`, `GPS_MAX_AGE_MS`, `GPS_TIMEOUT_MS` de `lib/geo.ts`.
- Produces :
  - `type GpsPermission = 'granted' | 'denied' | 'undetermined' | 'unavailable'`
  - `gpsAvailable(): boolean`
  - `gpsPermission(): Promise<GpsPermission>` (ne demande rien)
  - `requestGpsPermission(): Promise<GpsPermission>` (affiche la demande du système)
  - `readGpsPosition(): Promise<GpsFix | null>` (ne demande rien ; null si refusé, absent ou plus de 8 s)

**Contexte :** l'installation d'un paquet à la racine échoue aujourd'hui (`ERESOLVE`) : `react-dom` 19.2.8, tiré par `expo-router`, réclame `react` 19.2.8 alors que l'app est sur `react` 19.2.3 (version imposée par React Native 0.86 — **ne pas changer `react`**). Aligner `react-dom` sur 19.2.3 par une surcharge règle le conflit. Simulation faite le 2026-09-17 sur une copie : avec la surcharge, l'installation d'`expo-location` ne change que 2 paquets (`react-dom` 19.2.8 → 19.2.3 et `expo-location` ajouté). `react-dom` ne sert qu'à la version web.

- [ ] **Step 1 : écrire le garde-fou qui échoue**

Créer `lib/__tests__/noDirectExpoLocation.test.ts` :

```ts
// Garde-fou : `expo-location` ne se nomme QUE dans lib/location.ts.
//
// C'est un module natif. Un APK construit avant son ajout ne le contient pas :
// un import direct ferait planter l'app au démarrage chez tous ceux qui n'ont
// pas encore la nouvelle version. lib/location.ts vérifie d'abord que le
// module natif existe, et ne charge le code qu'ensuite.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const DIRS = ['app', 'components', 'hooks', 'lib'];
const AUTORISE = join('lib', 'location.ts');
const NOM = /['"]expo-location['"]/;

function fichiers(dir: string): string[] {
  const out: string[] = [];
  for (const nom of readdirSync(dir)) {
    if (nom === 'node_modules' || nom === '__tests__' || nom.startsWith('.')) continue;
    const p = join(dir, nom);
    if (statSync(p).isDirectory()) out.push(...fichiers(p));
    else if (p.endsWith('.tsx') || p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('expo-location chargé prudemment', () => {
  it('la détection attrape un import direct (test du test)', () => {
    expect(NOM.test("import * as Location from 'expo-location';")).toBe(true);
    expect(NOM.test('const L = require("expo-location");')).toBe(true);
    expect(NOM.test('// expo-location est chargé plus bas')).toBe(false);
  });

  it('aucun autre fichier ne nomme le module', () => {
    const fautifs = DIRS.flatMap(d => fichiers(join(ROOT, d)))
      .filter(p => relative(ROOT, p) !== AUTORISE)
      .filter(p => NOM.test(readFileSync(p, 'utf8')))
      .map(p => relative(ROOT, p));
    expect(fautifs).toEqual([]);
  });

  it('lib/location.ts vérifie le module natif AVANT de charger le code', () => {
    const src = readFileSync(join(ROOT, AUTORISE), 'utf8');
    const verification = src.indexOf("requireOptionalNativeModule('ExpoLocation')");
    const chargement = src.indexOf("require('expo-location')");
    expect(verification).toBeGreaterThan(-1);
    expect(chargement).toBeGreaterThan(verification);
  });
});
```

- [ ] **Step 2 : lancer le garde-fou, vérifier l'échec**

Run: `node node_modules/vitest/vitest.mjs run lib/__tests__/noDirectExpoLocation.test.ts`
Expected: FAIL sur le 3e test (`ENOENT` : `lib/location.ts` n'existe pas).

- [ ] **Step 3 : aligner `react-dom` et installer `expo-location`**

Ajouter à `package.json`, au premier niveau (à côté de `"dependencies"`), la surcharge :

```json
  "overrides": {
    "react-dom": "19.2.3"
  },
```

(si une clé `"overrides"` existe déjà, y ajouter seulement `"react-dom": "19.2.3"`). Puis :

Run: `npm install expo-location@~57.0.18`
Expected: installation sans `ERESOLVE`. Vérifier :

Run: `npm ls react-dom expo-location` → `react-dom@19.2.3` partout, `expo-location@57.0.x`.
Run: `node -e "console.log(require('./node_modules/react/package.json').version)"` → `19.2.3` (inchangé).
Run: `git diff --stat package-lock.json` → quelques dizaines de lignes au plus ; si des centaines de paquets changent, **arrêter** et le signaler dans le rapport sans commit.

- [ ] **Step 4 : textes d'autorisation iOS en français**

Dans `app.json`, tableau `expo.plugins`, ajouter après le bloc `"expo-image-picker"` :

```json
      [
        "expo-location",
        {
          "locationWhenInUsePermission": "PAG MATCH utilise ta position pour afficher la distance des parties près de toi. Elle reste sur ton téléphone.",
          "locationAlwaysAndWhenInUsePermission": "PAG MATCH utilise ta position pour afficher la distance des parties près de toi. Elle reste sur ton téléphone.",
          "isAndroidBackgroundLocationEnabled": false
        }
      ],
```

Run: `node -e "JSON.parse(require('fs').readFileSync('app.json','utf8')); console.log('app.json OK')"` → `app.json OK`.
Run: `npx expo config --type public > /dev/null && echo CONFIG_OK` → `CONFIG_OK`.
Run: `npx expo install --check` → aucune version signalée pour `expo-location` (d'éventuels avertissements préexistants sur d'autres paquets sont à recopier dans le rapport, pas à corriger).

- [ ] **Step 5 : écrire `lib/location.ts`**

```ts
// lib/location.ts — la position du téléphone, chargée PRUDEMMENT.
//
// `expo-location` est un module natif. Un APK construit avant son ajout ne le
// contient pas : l'importer normalement ferait planter l'app au démarrage. On
// vérifie donc d'abord que le module natif existe, et on ne charge le code
// JavaScript qu'ensuite. Absent = GPS indisponible : l'app se replie sur la
// zone du joueur.
//
// C'est le SEUL fichier autorisé à nommer ce module
// (garde-fou : lib/__tests__/noDirectExpoLocation.test.ts).
//
// Aucune fonction ici n'écrit en base : la position ne quitte pas le téléphone.
import { requireOptionalNativeModule } from 'expo';
import { GPS_MAX_AGE_MS, GPS_TIMEOUT_MS, type GpsFix } from './geo';

type LocationModule = typeof import('expo-location');

export type GpsPermission = 'granted' | 'denied' | 'undetermined' | 'unavailable';

let charge: LocationModule | null | undefined;

function chargerModule(): LocationModule | null {
  if (charge !== undefined) return charge;
  try {
    charge = requireOptionalNativeModule('ExpoLocation')
      ? (require('expo-location') as LocationModule)
      : null;
  } catch {
    charge = null;
  }
  return charge;
}

export function gpsAvailable(): boolean {
  return chargerModule() !== null;
}

function lireStatut(status: string): GpsPermission {
  return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';
}

/** L'autorisation actuelle, SANS rien demander. */
export async function gpsPermission(): Promise<GpsPermission> {
  const L = chargerModule();
  if (!L) return 'unavailable';
  try {
    return lireStatut((await L.getForegroundPermissionsAsync()).status);
  } catch {
    return 'unavailable';
  }
}

/** Affiche la demande du système. À n'appeler que sur un geste du joueur. */
export async function requestGpsPermission(): Promise<GpsPermission> {
  const L = chargerModule();
  if (!L) return 'unavailable';
  try {
    return lireStatut((await L.requestForegroundPermissionsAsync()).status);
  } catch {
    return 'unavailable';
  }
}

function avecDelai<T>(promesse: Promise<T>, ms: number): Promise<T | null> {
  return new Promise(resolve => {
    const minuteur = setTimeout(() => resolve(null), ms);
    promesse.then(
      v => { clearTimeout(minuteur); resolve(v); },
      () => { clearTimeout(minuteur); resolve(null); },
    );
  });
}

/**
 * La position du téléphone, SANS demander l'autorisation : null si elle est
 * refusée, si le module manque, ou si le téléphone ne répond pas en 8 s. Une
 * position connue de moins de 10 minutes évite d'allumer le GPS.
 */
export async function readGpsPosition(): Promise<GpsFix | null> {
  const L = chargerModule();
  if (!L) return null;
  try {
    const { status } = await L.getForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const connue = await L.getLastKnownPositionAsync({ maxAge: GPS_MAX_AGE_MS });
    const pos = connue
      ?? await avecDelai(L.getCurrentPositionAsync({ accuracy: L.Accuracy.Balanced }), GPS_TIMEOUT_MS);
    if (!pos) return null;
    return { lat: pos.coords.latitude, lng: pos.coords.longitude, at: pos.timestamp || Date.now() };
  } catch {
    return null;
  }
}
```

- [ ] **Step 6 : tests et types**

Run: `node node_modules/vitest/vitest.mjs run lib` puis `npx tsc --noEmit -p tsconfig.json`
Expected: tout passe, garde-fou compris ; types propres.

- [ ] **Step 7 : commit**

```bash
git add package.json package-lock.json app.json lib/location.ts lib/__tests__/noDirectExpoLocation.test.ts
git commit -m "feat(localisation): module GPS chargé prudemment + garde-fou (lot 1)"
```

---

### Task 3 : filtre « Distance max »

**Files:**
- Modify: `lib/exploreFilters.ts`, `lib/__tests__/exploreFilters.test.ts`
- Modify: `lib/savedFilters.ts`, `lib/__tests__/savedFilters.test.ts`
- Modify: `app/(tabs)/lobby.tsx` (fonctions `resetOne` et `exploreCtx` seulement)

**Interfaces:**
- Consumes (Task 1) : `type GameDistance`, `type DistanceOf`, `isZoneRadius` de `lib/geo.ts`.
- Produces :
  - `ExploreFilters.maxKm: number | null` (défaut `null`)
  - `ExploreReason` gagne `'distance'` ; `REASON_LABEL.distance = 'Distance'`
  - `ExploreContext.distanceOf: (g: ExploreGame) => GameDistance | null`
  - dans `lobby.tsx` : `exploreCtx(myElo, villeDuClub, knownPlayers = new Set(), distanceOf: DistanceOf = () => null)` — la Task 7 lui passera la vraie fonction.

**Attention :** `app/(tabs)/lobby.tsx` contient déjà des modifications non enregistrées sans rapport avec ce lot (photos). Voir la décision du contrôleur transmise avec la tâche avant de faire `git add` sur ce fichier.

- [ ] **Step 1 : écrire les tests qui échouent**

Dans `lib/__tests__/exploreFilters.test.ts`, ajouter `distanceOf: () => null,` dans l'objet rendu par le helper `ctx` (après `knownPlayers: new Set<string>(),`). Puis ajouter à la fin du fichier :

```ts
describe('distance max', () => {
  const loin = { km: 12, approx: false };
  const pres = { km: 8, approx: false };
  const centreVille = { km: 3, approx: true };

  it('compte comme un filtre actif', () => {
    expect(activeExploreFilterCount(f({ maxKm: 10 }))).toBe(1);
    expect(activeExploreFilterCount(f({ maxKm: null }))).toBe(0);
  });

  it('écarte trop loin, inconnu et centre-ville ; garde ce qui est dans le rayon', () => {
    expect(exploreRefusal(partie(), f({ maxKm: 10 }), ctx({ distanceOf: () => loin }))).toBe('distance');
    expect(exploreRefusal(partie(), f({ maxKm: 10 }), ctx({ distanceOf: () => null }))).toBe('distance');
    // Club placé au centre de sa ville : on ne promet pas « à moins de 10 km »
    // sur une position fausse.
    expect(exploreRefusal(partie(), f({ maxKm: 10 }), ctx({ distanceOf: () => centreVille }))).toBe('distance');
    expect(exploreRefusal(partie(), f({ maxKm: 10 }), ctx({ distanceOf: () => pres }))).toBeNull();
    expect(exploreRefusal(partie(), f({ maxKm: 12 }), ctx({ distanceOf: () => loin }))).toBeNull();
  });

  it('sans distance max, la distance n est même pas calculée', () => {
    const jamais = () => { throw new Error('distanceOf ne doit pas être appelée'); };
    expect(exploreRefusal(partie(), f(), ctx({ distanceOf: jamais }))).toBeNull();
  });

  it('proposée comme filtre à retirer quand elle cache tout', () => {
    const best = bestExploreFilterToDrop([partie(), partie()], f({ maxKm: 5 }), ctx({ distanceOf: () => loin }));
    expect(best).toEqual({ reason: 'distance', unlocked: 2 });
  });
});
```

Dans `lib/__tests__/savedFilters.test.ts`, ajouter à la fin :

```ts
describe('distance max et alertes (lot 1)', () => {
  it('la distance est enregistrée avec le filtre mais PAS encore surveillée par l alerte', () => {
    const c = alertCoverage(f({ cities: ['Rabat'], maxKm: 10 }));
    expect(c.watched).toEqual(['Ville']);
    expect(c.ignored).toEqual(['Distance']);
  });

  it('une distance seule ne suffit pas à faire une alerte', () => {
    expect(canAlert(f({ maxKm: 10 }))).toBe(false);
  });

  it('relecture : maxKm absent ou aberrant → null ; valeur permise conservée', () => {
    expect(hydrateFilter({ type: 'friendly' }).maxKm).toBeNull();
    expect(hydrateFilter({ maxKm: 15 }).maxKm).toBeNull();
    expect(hydrateFilter({ maxKm: '10' }).maxKm).toBeNull();
    expect(hydrateFilter({ maxKm: 20 }).maxKm).toBe(20);
  });
});
```

- [ ] **Step 2 : lancer, vérifier l'échec**

Run: `node node_modules/vitest/vitest.mjs run lib/__tests__/exploreFilters.test.ts lib/__tests__/savedFilters.test.ts`
Expected: FAIL (`maxKm` inconnu, raison `distance` absente, `Distance` non listée).

- [ ] **Step 3 : modifier `lib/exploreFilters.ts`**

En tête, après le commentaire d'introduction, ajouter :

```ts
import type { GameDistance } from './geo';
```

Dans `interface ExploreFilters`, après `cities: string[];` :

```ts
  /** Distance maximale en km depuis le point de départ (5 / 10 / 20 / 40). `null` = indifférent. */
  maxKm: number | null;
```

Dans `NO_EXPLORE_FILTERS`, remplacer `date: 'any', slot: 'any', clubs: [], cities: [],` par :

```ts
  date: 'any', slot: 'any', clubs: [], cities: [], maxKm: null,
```

Dans `activeExploreFilterCount`, après `if (f.cities.length > 0) n++;` :

```ts
  if (f.maxKm !== null) n++;
```

Dans le type `ExploreReason`, remplacer `| 'date' | 'slot' | 'club' | 'city' | 'type'` par `| 'date' | 'slot' | 'club' | 'city' | 'distance' | 'type'`.

Dans `interface ExploreContext`, après `knownPlayers: Set<string>;` :

```ts
  /** Distance de la partie depuis le point de départ (hooks/useOrigin) ; null = inconnue. */
  distanceOf: (g: ExploreGame) => GameDistance | null;
```

Dans `exploreRefusal`, juste après le bloc `if (f.cities.length > 0) { … }` :

```ts
  if (f.maxKm !== null) {
    const d = ctx.distanceOf(g);
    // Club placé au centre de sa ville : sa distance est approximative, on ne
    // promet pas « à moins de N km » sur une position fausse.
    if (!d || d.approx || d.km > f.maxKm) return 'distance';
  }
```

Dans `REASON_LABEL`, après `city: 'Ville',` :

```ts
  distance: 'Distance',
```

- [ ] **Step 4 : modifier `lib/savedFilters.ts`**

Ajouter l'import :

```ts
import { isZoneRadius } from './geo';
```

Remplacer `export const VIEW_ONLY_KEYS = ['date', 'spots', 'urgentOnly', 'search'] as const;` par :

```ts
/** Ceux qui n'ont de sens qu'au moment où l'on regarde — et la distance, que
 *  le serveur ne sait pas encore mesurer (lot 4 de la localisation). */
export const VIEW_ONLY_KEYS = ['date', 'spots', 'urgentOnly', 'search', 'maxKm'] as const;
```

Dans `alertCoverage`, après `if (f.search.trim()) ignored.push('Recherche');` :

```ts
  if (f.maxKm !== null) ignored.push('Distance');
```

Dans `hydrateFilter`, après `search: typeof c.search === 'string' ? c.search : '',` :

```ts
    maxKm: isZoneRadius(c.maxKm) ? c.maxKm : null,
```

- [ ] **Step 5 : garder `lobby.tsx` compilable**

Dans `app/(tabs)/lobby.tsx`, fonction `resetOne`, après `case 'city':   return { cities: [] };` :

```ts
    case 'distance': return { maxKm: null };
```

Remplacer la signature et le corps de `exploreCtx` :

```ts
function exploreCtx(
  myElo: number,
  villeDuClub: (n: string) => string | null,
  knownPlayers: Set<string> = new Set(),
  distanceOf: DistanceOf = () => null,
): ExploreContext {
  return {
    now: new Date(),
    cityOfClub: villeDuClub,
```

et, dans l'objet rendu, après `knownPlayers,` :

```ts
    distanceOf: (g: any) => distanceOf(g.location),
```

Ajouter en tête de fichier : `import type { DistanceOf } from '../../lib/geo';`

- [ ] **Step 6 : tests et types**

Run: `node node_modules/vitest/vitest.mjs run lib` puis `npx tsc --noEmit -p tsconfig.json`
Expected: tout passe ; types propres.

- [ ] **Step 7 : commit**

```bash
git add lib/exploreFilters.ts lib/__tests__/exploreFilters.test.ts lib/savedFilters.ts lib/__tests__/savedFilters.test.ts "app/(tabs)/lobby.tsx"
git commit -m "feat(localisation): filtre Distance max dans les règles de l'Explorer (lot 1)"
```

---

### Task 4 : zone du joueur — serveur et accès

**Files:**
- Create: `supabase/migrations/player_zones.sql` (**non versionné** : ne pas l'ajouter à git)
- Create: `lib/playerZone.ts`
- Create: `lib/__tests__/playerZone.test.ts`

**Interfaces:**
- Consumes (Task 1) : `roundZoneCoord`, `isZoneRadius`, `DEFAULT_RADIUS_KM`, `type ZonePoint`.
- Produces :
  - `isMissingTableError(error: { code?: string; message?: string } | null | undefined): boolean`
  - `zoneFromRow(row: unknown): ZonePoint | null`
  - `zoneToRow(playerId: string, zone: ZonePoint): { player_id: string; lat: number; lng: number; radius_km: number }`
  - `fetchMyZone(playerId: string): Promise<{ zone: ZonePoint | null; available: boolean }>` (ne lève jamais ; `available: false` = migration absente)
  - `saveMyZone(playerId: string, zone: ZonePoint): Promise<ZonePoint>` (lève en cas d'échec ; rend la zone arrondie)
  - `deleteMyZone(playerId: string): Promise<void>` (lève en cas d'échec)

- [ ] **Step 1 : écrire la migration**

Créer `supabase/migrations/player_zones.sql` :

```sql
-- Zone de référence du joueur (localisation, lot 1).
--
-- Un point choisi sur la carte, ARRONDI au 0,005° (~500 m), et un rayon. La
-- position GPS du téléphone n'est jamais envoyée ici : les distances se
-- calculent dans le téléphone.
--
-- Lecture et écriture par le joueur uniquement. L'arrondi est refait ici, quoi
-- que l'app envoie.

CREATE TABLE IF NOT EXISTS public.player_zones (
  player_id  uuid PRIMARY KEY,
  lat        numeric(6,3) NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng        numeric(6,3) NOT NULL CHECK (lng BETWEEN -180 AND 180),
  radius_km  smallint NOT NULL CHECK (radius_km IN (5, 10, 20, 40)),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.fn_player_zones_round()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.lat := round(NEW.lat / 0.005) * 0.005;
  NEW.lng := round(NEW.lng / 0.005) * 0.005;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_player_zones_round ON public.player_zones;
CREATE TRIGGER trg_player_zones_round
  BEFORE INSERT OR UPDATE ON public.player_zones
  FOR EACH ROW EXECUTE FUNCTION public.fn_player_zones_round();

ALTER TABLE public.player_zones ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.player_zones TO authenticated;

DROP POLICY IF EXISTS player_zones_select ON public.player_zones;
CREATE POLICY player_zones_select ON public.player_zones
  FOR SELECT TO authenticated
  USING (player_id = public.current_player_id());

DROP POLICY IF EXISTS player_zones_insert ON public.player_zones;
CREATE POLICY player_zones_insert ON public.player_zones
  FOR INSERT TO authenticated
  WITH CHECK (player_id = public.current_player_id());

DROP POLICY IF EXISTS player_zones_update ON public.player_zones;
CREATE POLICY player_zones_update ON public.player_zones
  FOR UPDATE TO authenticated
  USING (player_id = public.current_player_id())
  WITH CHECK (player_id = public.current_player_id());

DROP POLICY IF EXISTS player_zones_delete ON public.player_zones;
CREATE POLICY player_zones_delete ON public.player_zones
  FOR DELETE TO authenticated
  USING (player_id = public.current_player_id());

-- Compte supprimé (anonymisé) : sa zone disparaît avec lui.
CREATE OR REPLACE FUNCTION public.fn_player_zones_clear_on_account_deletion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    DELETE FROM public.player_zones WHERE player_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_player_zones_clear_on_account_deletion ON public.players;
CREATE TRIGGER trg_player_zones_clear_on_account_deletion
  AFTER UPDATE OF deleted_at ON public.players
  FOR EACH ROW EXECUTE FUNCTION public.fn_player_zones_clear_on_account_deletion();
```

- [ ] **Step 2 : écrire les tests qui échouent**

Créer `lib/__tests__/playerZone.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { isMissingTableError, zoneFromRow, zoneToRow } from '../playerZone';

describe('migration absente', () => {
  it('reconnaît une table inexistante (Postgres et PostgREST)', () => {
    expect(isMissingTableError({ code: '42P01', message: 'relation "public.player_zones" does not exist' })).toBe(true);
    expect(isMissingTableError({ code: 'PGRST205', message: "Could not find the table 'public.player_zones' in the schema cache" })).toBe(true);
  });
  it('une autre erreur n est PAS une migration absente', () => {
    expect(isMissingTableError({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(isMissingTableError({ message: 'Network request failed' })).toBe(false);
    expect(isMissingTableError(null)).toBe(false);
  });
});

describe('ligne ↔ zone', () => {
  it('relit une ligne, nombres en texte compris', () => {
    expect(zoneFromRow({ lat: '33.575', lng: -7.59, radius_km: 10 })).toEqual({ lat: 33.575, lng: -7.59, radiusKm: 10 });
  });
  it('rayon aberrant → 20 km ; ligne vide ou illisible → null', () => {
    expect(zoneFromRow({ lat: 33.575, lng: -7.59, radius_km: 15 })!.radiusKm).toBe(20);
    expect(zoneFromRow(null)).toBeNull();
    expect(zoneFromRow({ lat: 'x', lng: -7.59, radius_km: 10 })).toBeNull();
  });
  it('arrondit AVANT d envoyer', () => {
    expect(zoneToRow('p1', { lat: 33.5731, lng: -7.5898, radiusKm: 20 }))
      .toEqual({ player_id: 'p1', lat: 33.575, lng: -7.59, radius_km: 20 });
  });
});
```

- [ ] **Step 3 : lancer, vérifier l'échec**

Run: `node node_modules/vitest/vitest.mjs run lib/__tests__/playerZone.test.ts`
Expected: FAIL — `Failed to resolve import "../playerZone"`.

- [ ] **Step 4 : écrire `lib/playerZone.ts`**

```ts
// lib/playerZone.ts — la zone de référence du joueur (table player_zones).
//
// Un point choisi sur la carte, arrondi (~500 m), et un rayon. La position
// GPS n'est JAMAIS enregistrée ici.
//
// Si la migration n'est pas appliquée, la table n'existe pas : fetchMyZone le
// dit (`available: false`) et l'app masque tout ce qui touche à la zone.
import { roundZoneCoord, isZoneRadius, DEFAULT_RADIUS_KM, type ZonePoint } from './geo';

export function isMissingTableError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  const m = error.message ?? '';
  return /player_zones/.test(m) && /does not exist|could not find/i.test(m);
}

export function zoneFromRow(row: unknown): ZonePoint | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as { lat?: unknown; lng?: unknown; radius_km?: unknown };
  const lat = Number(r.lat);
  const lng = Number(r.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const rayon = Number(r.radius_km);
  return { lat, lng, radiusKm: isZoneRadius(rayon) ? rayon : DEFAULT_RADIUS_KM };
}

export function zoneToRow(playerId: string, zone: ZonePoint) {
  return {
    player_id: playerId,
    lat: roundZoneCoord(zone.lat),
    lng: roundZoneCoord(zone.lng),
    radius_km: zone.radiusKm,
  };
}

// ─── Accès base ───────────────────────────────────────────────────────────
// Import supabase paresseux : tout ce qui précède reste testable sans env.

export async function fetchMyZone(playerId: string): Promise<{ zone: ZonePoint | null; available: boolean }> {
  try {
    const { supabase } = await import('./supabase');
    const { data, error } = await supabase
      .from('player_zones')
      .select('lat, lng, radius_km')
      .eq('player_id', playerId)
      .maybeSingle();
    if (error) return { zone: null, available: !isMissingTableError(error) };
    return { zone: zoneFromRow(data), available: true };
  } catch {
    return { zone: null, available: true };
  }
}

export async function saveMyZone(playerId: string, zone: ZonePoint): Promise<ZonePoint> {
  const { supabase } = await import('./supabase');
  const row = zoneToRow(playerId, zone);
  const { error } = await supabase.from('player_zones').upsert(row, { onConflict: 'player_id' });
  if (error) throw error;
  return { lat: row.lat, lng: row.lng, radiusKm: row.radius_km };
}

export async function deleteMyZone(playerId: string): Promise<void> {
  const { supabase } = await import('./supabase');
  const { error } = await supabase.from('player_zones').delete().eq('player_id', playerId);
  if (error) throw error;
}
```

- [ ] **Step 5 : tests et types**

Run: `node node_modules/vitest/vitest.mjs run lib` puis `npx tsc --noEmit -p tsconfig.json`
Expected: tout passe ; types propres. `git status --short supabase` ne doit rien afficher (dossier ignoré).

- [ ] **Step 6 : commit (sans la migration)**

```bash
git add lib/playerZone.ts lib/__tests__/playerZone.test.ts
git commit -m "feat(localisation): zone de référence du joueur — accès et détection de la migration (lot 1)"
```

---

### Task 5 : point de départ partagé (`hooks/useOrigin.ts`)

**Files:**
- Create: `hooks/useOrigin.ts`

**Interfaces:**
- Consumes : Task 1 (`buildClubIndex`, `makeDistanceOf`, `resolveOrigin`, `DEFAULT_RADIUS_KM`, `GPS_MAX_AGE_MS`, types), Task 2 (`gpsAvailable`, `gpsPermission`, `requestGpsPermission`, `readGpsPosition`, `GpsPermission`), Task 4 (`fetchMyZone`, `saveMyZone`, `deleteMyZone`), `hooks/usePlayer.tsx` (`usePlayer().player?.id`), `lib/supabase` (`supabase`).
- Produces : `useOrigin()` rend

```ts
{
  ready: boolean;                 // zone + clubs chargés
  origin: Origin | null;
  zone: ZonePoint | null;
  zoneAvailable: boolean;         // false = migration player_zones absente
  gps: GpsFix | null;
  gpsAvailable: boolean;          // false = module natif absent (ancien APK)
  gpsPermission: GpsPermission;
  radiusKm: number;               // rayon de la zone, 20 sans zone
  distanceOf: DistanceOf;         // même fonction tant que le point de départ ne change pas
  requestGps: () => Promise<GpsFix | null>;   // demande l'autorisation puis lit la position
  refreshGps: () => Promise<void>;            // relit sans jamais demander
  saveZone: (zone: ZonePoint) => Promise<void>;  // lève si l'enregistrement échoue
  removeZone: () => Promise<void>;               // lève si la suppression échoue
}
```

Aucun test automatique possible (module React Native) : la logique est dans `lib/geo.ts` (déjà testée). Vérification par les types et par les tâches 6 à 8.

- [ ] **Step 1 : écrire `hooks/useOrigin.ts`**

```ts
// hooks/useOrigin.ts — le point de départ des distances, partagé par toute l'app.
//
// Un seul magasin pour tous les écrans : les cartes de partie, le filtre, le
// compteur de l'onglet et le tri lisent LA MÊME fonction `distanceOf`. Deux
// calculs séparés finiraient par ne plus annoncer les mêmes chiffres.
//
// Ordre : GPS de moins de 10 minutes → zone → aucun (lib/geo.resolveOrigin).
// L'autorisation GPS n'est JAMAIS demandée ici au chargement : seulement par
// `requestGps`, appelé sur un geste du joueur.
import { useEffect, useSyncExternalStore } from 'react';
import { usePlayer } from './usePlayer';
import { supabase } from '../lib/supabase';
import {
  buildClubIndex, makeDistanceOf, resolveOrigin, DEFAULT_RADIUS_KM, GPS_MAX_AGE_MS,
  type ClubPoint, type ClubRow, type DistanceOf, type GpsFix, type Origin, type ZonePoint,
} from '../lib/geo';
import {
  gpsAvailable, gpsPermission, requestGpsPermission, readGpsPosition, type GpsPermission,
} from '../lib/location';
import { fetchMyZone, saveMyZone, deleteMyZone } from '../lib/playerZone';

interface OriginState {
  playerId: string | null;
  ready: boolean;
  zone: ZonePoint | null;
  zoneAvailable: boolean;
  gps: GpsFix | null;
  gpsPermission: GpsPermission;
  index: Map<string, ClubPoint>;
  origin: Origin | null;
  distanceOf: DistanceOf;
}

const VIDE: OriginState = {
  playerId: null, ready: false, zone: null, zoneAvailable: true, gps: null,
  gpsPermission: 'undetermined', index: new Map(), origin: null,
  distanceOf: makeDistanceOf(null, new Map()),
};

let state: OriginState = VIDE;
let chargement: Promise<void> | null = null;
const abonnes = new Set<() => void>();

const memeOrigine = (a: Origin | null, b: Origin | null) =>
  a === b || (!!a && !!b && a.lat === b.lat && a.lng === b.lng && a.source === b.source);

function publier(patch: Partial<OriginState>): void {
  const next = { ...state, ...patch };
  const origin = resolveOrigin(next.gps, next.zone, Date.now());
  const inchange = memeOrigine(origin, state.origin) && next.index === state.index;
  next.origin = inchange ? state.origin : origin;
  // Nouvelle fonction SEULEMENT si le point de départ ou les clubs changent :
  // les distances déjà calculées restent en mémoire sinon.
  next.distanceOf = inchange ? state.distanceOf : makeDistanceOf(origin, next.index);
  state = next;
  abonnes.forEach(f => f());
}

async function chargerClubs(): Promise<Map<string, ClubPoint>> {
  try {
    const { data, error } = await supabase
      .from('clubs')
      .select('name, latitude, longitude, geo_confidence')
      .not('latitude', 'is', null);
    if (error) return new Map();
    return buildClubIndex((data ?? []) as ClubRow[]);
  } catch {
    return new Map();
  }
}

function charger(playerId: string): Promise<void> {
  if (state.playerId === playerId && chargement) return chargement;
  // Changement de compte : on repart de zéro.
  state = { ...VIDE, playerId };
  chargement = (async () => {
    const [zone, index, permission] = await Promise.all([
      fetchMyZone(playerId), chargerClubs(), gpsPermission(),
    ]);
    if (state.playerId !== playerId) return;
    publier({ zone: zone.zone, zoneAvailable: zone.available, index, gpsPermission: permission, ready: true });
    // Autorisation DÉJÀ donnée : on lit la position sans rien demander.
    if (permission === 'granted') {
      const gps = await readGpsPosition();
      if (state.playerId === playerId && gps) publier({ gps });
    }
  })();
  return chargement;
}

async function requestGps(): Promise<GpsFix | null> {
  const permission = await requestGpsPermission();
  publier({ gpsPermission: permission });
  if (permission !== 'granted') return null;
  const gps = await readGpsPosition();
  if (gps) publier({ gps });
  return gps;
}

async function refreshGps(): Promise<void> {
  if (state.gpsPermission !== 'granted') return;
  // Position encore fraîche : inutile d'interroger le téléphone.
  if (state.gps && Date.now() - state.gps.at < GPS_MAX_AGE_MS / 2) return;
  const gps = await readGpsPosition();
  // Même sans nouvelle position, republier recalcule l'origine : un GPS devenu
  // trop ancien cède la place à la zone.
  publier(gps ? { gps } : {});
}

async function saveZone(zone: ZonePoint): Promise<void> {
  if (!state.playerId) throw new Error('Joueur inconnu');
  const enregistree = await saveMyZone(state.playerId, zone);
  publier({ zone: enregistree });
}

async function removeZone(): Promise<void> {
  if (!state.playerId) throw new Error('Joueur inconnu');
  await deleteMyZone(state.playerId);
  publier({ zone: null });
}

function abonner(f: () => void): () => void {
  abonnes.add(f);
  return () => { abonnes.delete(f); };
}

export function useOrigin() {
  const { player } = usePlayer();
  const s = useSyncExternalStore(abonner, () => state);
  const playerId = player?.id ?? null;
  useEffect(() => { if (playerId) void charger(playerId); }, [playerId]);
  return {
    ready: s.ready,
    origin: s.origin,
    zone: s.zone,
    zoneAvailable: s.zoneAvailable,
    gps: s.gps,
    gpsAvailable: gpsAvailable(),
    gpsPermission: s.gpsPermission,
    radiusKm: s.zone?.radiusKm ?? DEFAULT_RADIUS_KM,
    distanceOf: s.distanceOf,
    requestGps,
    refreshGps,
    saveZone,
    removeZone,
  };
}
```

- [ ] **Step 2 : types et tests**

Run: `npx tsc --noEmit -p tsconfig.json` puis `node node_modules/vitest/vitest.mjs run lib`
Expected: types propres ; tests inchangés et verts. Si `usePlayer()` ne fournit pas `player` sous ce nom, lire `hooks/usePlayer.tsx` et adapter la seule ligne `const { player } = usePlayer();`.

- [ ] **Step 3 : commit**

```bash
git add hooks/useOrigin.ts
git commit -m "feat(localisation): point de départ partagé — GPS récent, sinon zone (lot 1)"
```

---

### Task 6 : écran « Ma zone », menu et confidentialité

**Files:**
- Create: `lib/zoneMapHtml.ts`, `lib/__tests__/zoneMapHtml.test.ts`
- Create: `app/zone.tsx`
- Modify: `app/_layout.tsx`, `components/profile/ProfileMenuSheet.tsx`, `app/legal/confidentialite.tsx`, `lib/legal.ts`

**Interfaces:**
- Consumes : Task 1 (`initialZoneCenter`, `ZONE_RADII_KM`, `DEFAULT_RADIUS_KM`, `LatLng`), Task 5 (`useOrigin()`), `assets/leaflet/leaflet.bundle` (`LEAFLET_JS`, `LEAFLET_CSS`, déjà utilisé par `lib/clubsMapHtml.ts`).
- Produces : route `/zone` ; `buildZoneMapHtml(): string` dont la page expose `window.setZone(lat, lng, radiusKm, recentrer)` et envoie `{ type: 'ready' }` puis `{ type: 'moved', lat, lng }`.

**Décision :** « Placer l'épingle sur ma position » lit le GPS pour poser l'épingle ; seul le point **arrondi**, enregistré par le joueur en touchant « Enregistrer ma zone », part au serveur. Ce n'est pas un envoi de la position GPS.

- [ ] **Step 1 : écrire le test qui échoue**

Créer `lib/__tests__/zoneMapHtml.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { buildZoneMapHtml } from '../zoneMapHtml';

// L'écran app/zone.tsx dépend de ces noms : les changer d'un côté sans l'autre
// laisserait une carte muette, sans aucune erreur.
describe('carte de zone : contrat avec l écran', () => {
  const html = buildZoneMapHtml();
  it('expose setZone et annonce ready / moved', () => {
    expect(html).toContain('window.setZone = function(lat, lng, radiusKm, recentrer)');
    expect(html).toContain("post({ type: 'ready' })");
    expect(html).toContain("post({ type: 'moved', lat: p.lat, lng: p.lng })");
  });
  it('épingle déplaçable et cercle du rayon', () => {
    expect(html).toContain('draggable: true');
    expect(html).toContain('L.circle(');
  });
});
```

- [ ] **Step 2 : lancer, vérifier l'échec**

Run: `node node_modules/vitest/vitest.mjs run lib/__tests__/zoneMapHtml.test.ts`
Expected: FAIL — `Failed to resolve import "../zoneMapHtml"`.

- [ ] **Step 3 : écrire `lib/zoneMapHtml.ts`**

```ts
// lib/zoneMapHtml.ts — carte Leaflet (asset local) pour placer sa zone.
//
// Même principe que lib/clubsMapHtml.ts : page statique, l'écran pousse la
// zone par injectJavaScript et reçoit les déplacements par postMessage.
// Contrat vérifié par lib/__tests__/zoneMapHtml.test.ts.
import { LEAFLET_JS, LEAFLET_CSS } from '../assets/leaflet/leaflet.bundle';

export function buildZoneMapHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <style>${LEAFLET_CSS}
    html,body,#map{margin:0;padding:0;height:100%;width:100%;background:#e9eef2}
    .pin{width:26px;height:26px;border-radius:50% 50% 50% 0;background:#0A0A0A;
      transform:rotate(-45deg);border:3px solid #FFC11A;box-shadow:0 1px 4px rgba(0,0,0,.4)}
  </style>
</head>
<body>
  <div id="map"></div>
  <script>${LEAFLET_JS}</script>
  <script>
    function post(o){ if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(o)); }
    var map = L.map('map', { zoomControl: true, attributionControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap'
    }).addTo(map);
    map.setView([33.5731, -7.5898], 11);
    var icon = L.divIcon({ html: '<div class="pin"></div>', className: '', iconSize: [26,26], iconAnchor: [13,26] });
    var pin = null, cercle = null;

    function envoyer(){ var p = pin.getLatLng(); post({ type: 'moved', lat: p.lat, lng: p.lng }); }

    window.setZone = function(lat, lng, radiusKm, recentrer){
      if (!pin) {
        pin = L.marker([lat, lng], { icon: icon, draggable: true }).addTo(map);
        cercle = L.circle([lat, lng], {
          radius: radiusKm * 1000, color: '#0A0A0A', weight: 2, fillColor: '#FFC11A', fillOpacity: 0.15
        }).addTo(map);
        pin.on('drag', function(){ cercle.setLatLng(pin.getLatLng()); });
        pin.on('dragend', envoyer);
      } else {
        pin.setLatLng([lat, lng]);
        cercle.setLatLng([lat, lng]);
        cercle.setRadius(radiusKm * 1000);
      }
      if (recentrer) map.fitBounds(cercle.getBounds(), { padding: [24, 24] });
    };

    // Toucher la carte déplace l'épingle : plus simple que de la faire glisser.
    map.on('click', function(e){
      if (!pin) return;
      pin.setLatLng(e.latlng);
      cercle.setLatLng(e.latlng);
      envoyer();
    });

    post({ type: 'ready' });
  </script>
</body>
</html>`;
}
```

- [ ] **Step 4 : écrire `app/zone.tsx`**

```tsx
// app/zone.tsx — « Ma zone » : un point sur la carte et un rayon.
//
// Sert de point de départ aux distances quand le GPS est refusé, absent ou
// trop lent. Le point est arrondi (~500 m) avant d'être enregistré, et reste
// visible du joueur seul (supabase/migrations/player_zones.sql).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { Colors, Fonts } from '../lib/theme';
import { Icon } from '../components/community/icons';
import { useOrigin } from '../hooks/useOrigin';
import { buildZoneMapHtml } from '../lib/zoneMapHtml';
import { initialZoneCenter, ZONE_RADII_KM, DEFAULT_RADIUS_KM, type LatLng } from '../lib/geo';

export default function ZoneScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { ready, zone, zoneAvailable, gps, gpsAvailable, requestGps, saveZone, removeZone } = useOrigin();

  const webref = useRef<WebView>(null);
  const [webReady, setWebReady] = useState(false);
  const [point, setPoint] = useState<LatLng | null>(null);
  const [radiusKm, setRadiusKm] = useState<number>(zone?.radiusKm ?? DEFAULT_RADIUS_KM);
  const [busy, setBusy] = useState<null | 'gps' | 'save' | 'delete'>(null);
  const source = useMemo(() => ({ html: buildZoneMapHtml(), baseUrl: 'https://localhost' }), []);

  // Première position de l'épingle : la zone enregistrée, sinon la position
  // connue, sinon Casablanca.
  useEffect(() => {
    if (!ready || point) return;
    setPoint(initialZoneCenter(zone, gps));
    if (zone) setRadiusKm(zone.radiusKm);
  }, [ready, zone, gps, point]);

  const pousser = useCallback((p: LatLng, r: number, recentrer: boolean) => {
    webref.current?.injectJavaScript(
      `window.setZone && window.setZone(${p.lat}, ${p.lng}, ${r}, ${recentrer}); true;`,
    );
  }, []);

  const posee = useRef(false);
  useEffect(() => {
    if (webReady && point && !posee.current) {
      posee.current = true;
      pousser(point, radiusKm, true);
    }
  }, [webReady, point, radiusKm, pousser]);

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    const brut = e.nativeEvent.data;
    try {
      const msg = JSON.parse(brut);
      if (msg.type === 'ready') setWebReady(true);
      if (msg.type === 'moved' && Number.isFinite(msg.lat) && Number.isFinite(msg.lng)) {
        setPoint({ lat: msg.lat, lng: msg.lng });
      }
    } catch { /* message illisible : ignoré */ }
  }, []);

  const choisirRayon = (r: number) => {
    setRadiusKm(r);
    if (point) pousser(point, r, true);
  };

  const placerSurMaPosition = async () => {
    setBusy('gps');
    try {
      const fix = await requestGps();
      if (!fix) {
        Alert.alert('Position indisponible', "Autorise la localisation dans les réglages du téléphone, ou place l'épingle à la main.");
        return;
      }
      const p = { lat: fix.lat, lng: fix.lng };
      setPoint(p);
      pousser(p, radiusKm, true);
    } finally {
      setBusy(null);
    }
  };

  const enregistrer = async () => {
    if (!point) return;
    setBusy('save');
    try {
      await saveZone({ lat: point.lat, lng: point.lng, radiusKm });
      router.back();
    } catch {
      Alert.alert('Zone non enregistrée', "Ta zone n'a pas pu être enregistrée. Ton ancienne zone est conservée. Vérifie ta connexion et réessaie.");
    } finally {
      setBusy(null);
    }
  };

  const supprimer = () => {
    Alert.alert('Supprimer ma zone ?', 'Les distances ne seront plus calculées depuis cette zone.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer', style: 'destructive',
        onPress: async () => {
          setBusy('delete');
          try {
            await removeZone();
            router.back();
          } catch {
            Alert.alert('Zone non supprimée', "Ta zone n'a pas pu être supprimée. Vérifie ta connexion et réessaie.");
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: insets.top + 8, paddingHorizontal: 14, paddingBottom: 12 }}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} accessibilityLabel="Retour">
          <Icon name="chevronLeft" size={24} color={Colors.textPrimary} stroke={2.4} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 20, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>Ma zone</Text>
          <Text style={{ fontSize: 12, fontFamily: Fonts.ui, color: Colors.textSecondary, marginTop: 2 }}>
            Place l'épingle là où tu joues d'habitude.
          </Text>
        </View>
      </View>

      {!zoneAvailable ? (
        <Text style={{ margin: 18, fontSize: 13, fontFamily: Fonts.ui, color: Colors.textSecondary, lineHeight: 19 }}>
          Les zones ne sont pas encore disponibles. Réessaie un peu plus tard.
        </Text>
      ) : (
        <>
          <View style={{ flex: 1 }}>
            <WebView
              ref={webref}
              source={source}
              originWhitelist={['*']}
              javaScriptEnabled
              domStorageEnabled
              onMessage={onMessage}
              style={{ flex: 1, backgroundColor: '#e9eef2' }}
            />
            {!webReady && (
              <ActivityIndicator color={Colors.primary} style={{ position: 'absolute', top: 20, alignSelf: 'center' }} />
            )}
          </View>

          <View style={{ padding: 16, paddingBottom: insets.bottom + 16, gap: 12, backgroundColor: Colors.bg }}>
            <Text style={{ fontSize: 12.5, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>Rayon</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {ZONE_RADII_KM.map(r => {
                const on = r === radiusKm;
                return (
                  <TouchableOpacity
                    key={r}
                    onPress={() => choisirRayon(r)}
                    activeOpacity={0.8}
                    style={{
                      flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12,
                      backgroundColor: on ? Colors.primary : Colors.bgCard,
                      borderWidth: 1, borderColor: on ? Colors.primary : Colors.border,
                    }}
                  >
                    <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: on ? Colors.textOnDark : Colors.textSecondary }}>
                      {r} km
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {gpsAvailable && (
              <TouchableOpacity
                onPress={placerSurMaPosition}
                disabled={busy !== null}
                activeOpacity={0.85}
                style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                  paddingVertical: 12, borderRadius: 12, backgroundColor: Colors.bgCard,
                  borderWidth: 1, borderColor: Colors.border, opacity: busy && busy !== 'gps' ? 0.5 : 1,
                }}
              >
                {busy === 'gps'
                  ? <ActivityIndicator color={Colors.textPrimary} />
                  : <>
                      <Icon name="radar" size={15} color={Colors.textPrimary} stroke={2.3} />
                      <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>Placer l'épingle sur ma position</Text>
                    </>}
              </TouchableOpacity>
            )}

            <TouchableOpacity
              onPress={enregistrer}
              disabled={!point || busy !== null}
              activeOpacity={0.85}
              style={{
                alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 12,
                backgroundColor: Colors.brand, opacity: !point || (busy && busy !== 'save') ? 0.5 : 1,
              }}
            >
              {busy === 'save'
                ? <ActivityIndicator color={Colors.textOnBrand} />
                : <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, color: Colors.textOnBrand }}>Enregistrer ma zone</Text>}
            </TouchableOpacity>

            {zone && (
              <TouchableOpacity onPress={supprimer} disabled={busy !== null} activeOpacity={0.7} style={{ alignItems: 'center', paddingVertical: 4 }}>
                <Text style={{ fontSize: 12.5, fontFamily: Fonts.uiExtraBold, color: Colors.danger }}>Supprimer ma zone</Text>
              </TouchableOpacity>
            )}

            <Text style={{ fontSize: 11, fontFamily: Fonts.ui, color: Colors.textMuted, lineHeight: 16 }}>
              Ta zone est arrondie à environ 500 m et reste visible de toi seul.
            </Text>
          </View>
        </>
      )}
    </View>
  );
}
```

- [ ] **Step 5 : déclarer la route**

Dans `app/_layout.tsx`, à l'intérieur de `<Stack.Protected guard={!!player}>`, après la ligne `<Stack.Screen name="notifications" options={{ presentation: 'card' }} />` :

```tsx
        {/* Localisation : zone de référence du joueur (point + rayon). */}
        <Stack.Screen name="zone" options={{ presentation: 'card' }} />
```

- [ ] **Step 6 : entrée « Ma zone » dans le menu du profil**

Dans `components/profile/ProfileMenuSheet.tsx` :
- ajouter l'import `import { useOrigin } from '../../hooks/useOrigin';` ;
- dans le composant, **avant** la ligne `if (!visible) return null;` (les hooks doivent être appelés à chaque rendu), ajouter `const { zoneAvailable } = useOrigin();` ;
- dans le groupe « Compte », après `<Row icon="mail" label="Confidentialité des messages" onPress={() => nav('/dm-settings')} />`, ajouter :

```tsx
          {/* Masquée tant que la migration player_zones n'est pas appliquée. */}
          {zoneAvailable && <Row icon="mapPin" label="Ma zone" onPress={() => nav('/zone')} />}
```

- [ ] **Step 7 : politique de confidentialité**

Dans `app/legal/confidentialite.tsx`, section 2 « Ce que nous collectons » :
- dans le tableau de `<Tags items={[…]} />`, ajouter `'Zone de jeu (facultative)'` après `'Photo de profil'` ;
- après le paragraphe qui commence par `La <B>photo de profil</B> est facultative.`, ajouter :

```tsx
        <P>
          La <B>localisation</B> est facultative. Si vous l'autorisez, la position de votre téléphone
          sert uniquement à calculer, sur votre appareil, la distance des parties : elle n'est jamais
          envoyée à nos serveurs. Si vous choisissez une <B>zone de jeu</B>, nous enregistrons un point
          arrondi à environ 500 m et un rayon, visibles de vous seul. Vous pouvez la supprimer à tout
          moment depuis le menu de votre profil ; elle est aussi effacée si vous supprimez votre compte.
        </P>
```

Dans `lib/legal.ts`, lancer d'abord `grep -rn "lastUpdate" app components lib`. Si `LEGAL.lastUpdate` n'est lu que par `app/legal/confidentialite.tsx`, remplacer `lastUpdate: '10 juin 2026',` par `lastUpdate: '17 septembre 2026',`. S'il est aussi lu par les CGU, **ne pas le modifier** et le signaler dans le rapport.

- [ ] **Step 8 : tests et types**

Run: `node node_modules/vitest/vitest.mjs run lib` puis `npx tsc --noEmit -p tsconfig.json`
Expected: tout passe (garde-fous `nativeEventInUpdater` et `noDirectExpoLocation` compris) ; types propres.

- [ ] **Step 9 : commit**

```bash
git add lib/zoneMapHtml.ts lib/__tests__/zoneMapHtml.test.ts app/zone.tsx app/_layout.tsx components/profile/ProfileMenuSheet.tsx app/legal/confidentialite.tsx lib/legal.ts
git commit -m "feat(localisation): écran Ma zone, entrée de menu et confidentialité (lot 1)"
```

---

### Task 7 : distances sur les cartes, dans les calculs et le tri de l'Explorer

**Files:**
- Modify: `app/(tabs)/lobby.tsx`

**Interfaces:**
- Consumes : Task 1 (`formatGameDistance`, `sortByProximity`, `originLabel`), Task 3 (`exploreCtx(…, distanceOf)`), Task 5 (`useOrigin()`), route `/zone` (Task 6).
- Produces, dans `ExploreTab` (utilisé par la Task 8) : `demanderPointDeDepart(): Promise<boolean>` — demande le GPS ; en cas d'échec, propose « Choisir ma zone » ; rend `true` si un point de départ GPS est obtenu.

**Attention :** voir la décision du contrôleur sur les modifications non enregistrées déjà présentes dans `lobby.tsx`.

- [ ] **Step 1 : imports**

En tête de `app/(tabs)/lobby.tsx`, ajouter :

```ts
import { useOrigin } from '../../hooks/useOrigin';
import { formatGameDistance, sortByProximity, originLabel } from '../../lib/geo';
```

(`import type { DistanceOf }` existe déjà depuis la Task 3.) Vérifier que `Alert` est bien importé de `react-native` en tête du fichier ; sinon l'ajouter à cet import.

- [ ] **Step 2 : distance sur la carte de partie**

Dans `GameCard`, juste après `const { width: winW } = useWindowDimensions();`, ajouter :

```tsx
  // Distance depuis le point de départ (GPS récent ou zone). L'historique n'en
  // a pas besoin. Même fonction que le filtre : la carte et la liste ne
  // peuvent pas se contredire.
  const { distanceOf } = useOrigin();
  const distance = variant === 'history' ? null : distanceOf(game.location);
```

Dans le bloc du lieu, remplacer :

```tsx
              <Text style={{ fontSize: 13.5, fontFamily: Fonts.uiBlack, color: Colors.textPrimary, flex: 1 }} numberOfLines={1}>
                {game.location}
              </Text>
            </TouchableOpacity>
```

par :

```tsx
              <Text style={{ fontSize: 13.5, fontFamily: Fonts.uiBlack, color: Colors.textPrimary, flex: 1 }} numberOfLines={1}>
                {game.location}
              </Text>
              {/* Sur la MÊME ligne que le club : la carte ne grandit pas (l'accueil ne défile pas). */}
              {distance ? (
                <Text style={{ fontSize: 12, fontFamily: Fonts.uiExtraBold, color: Colors.textSecondary }} numberOfLines={1}>
                  {formatGameDistance(distance)}
                </Text>
              ) : null}
            </TouchableOpacity>
```

- [ ] **Step 3 : même `distanceOf` pour la liste de l'Explorer**

Dans `ExploreTab`, juste après `const games = useMemo(() => visibleGames(allGames, myGender), [allGames, myGender]);`, ajouter :

```tsx
  const router = useRouter();
  const { origin, distanceOf, gpsAvailable, zoneAvailable, requestGps, refreshGps } = useOrigin();
  // Tri de la liste : état d'affichage, jamais enregistré dans un filtre.
  const [sort, setSort] = useState<'date' | 'proximity'>('date');
  // Une position de plus de 10 minutes ne compte plus : on la relit en revenant
  // sur l'Explorer, sans jamais redemander l'autorisation.
  useFocusEffect(useCallback(() => { void refreshGps(); }, []));
```

Remplacer :

```tsx
  const ctx = useMemo(
    () => exploreCtx(myElo, villeDuClub, knownPlayers),
    [myElo, villeDuClub, knownPlayers],
  );
```

par :

```tsx
  const ctx = useMemo(
    () => exploreCtx(myElo, villeDuClub, knownPlayers, distanceOf),
    [myElo, villeDuClub, knownPlayers, distanceOf],
  );
```

- [ ] **Step 4 : même `distanceOf` pour le compteur de l'onglet**

Dans le composant principal de l'écran (celui qui déclare `const [exploreFilters, setExploreFilters] = useState<ExploreFilters>(NO_EXPLORE_FILTERS);`), juste après cette ligne, ajouter :

```tsx
  // Le compteur de l'onglet applique la même distance que la liste.
  const { distanceOf: distanceOfBadge } = useOrigin();
```

(Cette ligne doit rester **avant** `if (!player) return null;`.) Puis remplacer :

```tsx
    () => filterExplore(games, exploreFilters, exploreCtx(myElo, n => clubCity.get(n) ?? null)).kept.length,
    [games, exploreFilters, myElo, clubCity],
```

par :

```tsx
    () => filterExplore(games, exploreFilters, exploreCtx(myElo, n => clubCity.get(n) ?? null, new Set(), distanceOfBadge)).kept.length,
    [games, exploreFilters, myElo, clubCity, distanceOfBadge],
```

- [ ] **Step 5 : tri « Proximité »**

Dans `ExploreTab`, juste après la déclaration de `const mainList = useMemo(…);`, ajouter :

```tsx
  // « Proximité » : distances précises d'abord, puis approximatives, puis
  // inconnues (lib/geo.sortByProximity). Sans point de départ, ordre des dates.
  const recommendedShown = useMemo(
    () => (sort === 'proximity' && origin ? sortByProximity(recommended, distanceOf) : recommended),
    [sort, origin, recommended, distanceOf],
  );
  const mainListShown = useMemo(
    () => (sort === 'proximity' && origin ? sortByProximity(mainList, distanceOf) : mainList),
    [sort, origin, mainList, distanceOf],
  );

  // Premier usage d'une fonction de distance sans point de départ : c'est ICI,
  // et seulement ici, qu'on demande l'autorisation GPS.
  const demanderPointDeDepart = async (): Promise<boolean> => {
    if (gpsAvailable && await requestGps()) return true;
    if (zoneAvailable) {
      Alert.alert('Choisis ta zone', 'Sans ta position, les distances se calculent depuis ta zone de jeu.', [
        { text: 'Plus tard', style: 'cancel' },
        { text: 'Choisir ma zone', onPress: () => router.push('/zone' as any) },
      ]);
    } else {
      Alert.alert('Position indisponible', 'Autorise la localisation dans les réglages du téléphone.');
    }
    return false;
  };

  const choisirTri = async (v: 'date' | 'proximity') => {
    if (v === 'proximity' && !origin && !(await demanderPointDeDepart())) return;
    setSort(v);
  };
```

Dans le rendu, remplacer `{recommended.map((g, i) => (` par `{recommendedShown.map((g, i) => (` et `{mainList.map((g, i) => (` par `{mainListShown.map((g, i) => (`. Ne rien changer d'autre à ces deux blocs (les longueurs `recommended.length` et `mainList.length` restent lues sur les listes d'origine).

- [ ] **Step 6 : rangée « Trier »**

Juste avant le bloc `{/* Jamais un cul-de-sac : on nomme le filtre dont le retrait revele le` (c'est-à-dire après la rangée des boutons Filtres / Urgent), ajouter :

```tsx
      {(gpsAvailable || zoneAvailable) && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, marginBottom: 12 }}>
          <Text style={{ fontSize: 11.5, fontFamily: Fonts.uiExtraBold, color: Colors.textSecondary }}>Trier</Text>
          {([['date', 'Date'], ['proximity', 'Proximité']] as const).map(([v, l]) => {
            const on = sort === v;
            return (
              <TouchableOpacity
                key={v}
                onPress={() => { void choisirTri(v); }}
                activeOpacity={0.85}
                style={{
                  paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999,
                  backgroundColor: on ? Colors.primary : Colors.bgCard,
                  borderWidth: 1, borderColor: on ? Colors.primary : Colors.border,
                }}
              >
                <Text style={{ fontSize: 12, fontFamily: Fonts.uiBlack, color: on ? Colors.textOnDark : Colors.textSecondary }}>{l}</Text>
              </TouchableOpacity>
            );
          })}
          <View style={{ flex: 1 }} />
          {origin && (sort === 'proximity' || filters.maxKm !== null) && (
            <Text style={{ fontSize: 11, fontFamily: Fonts.uiBold, color: Colors.textMuted }}>{originLabel(origin)}</Text>
          )}
        </View>
      )}
```

- [ ] **Step 7 : types et tests**

Run: `npx tsc --noEmit -p tsconfig.json` puis `node node_modules/vitest/vitest.mjs run lib`
Expected: types propres ; tous les tests verts (garde-fous compris).

- [ ] **Step 8 : commit**

```bash
git add "app/(tabs)/lobby.tsx"
git commit -m "feat(localisation): distance sur les cartes et tri Proximité dans l'Explorer (lot 1)"
```

---

### Task 8 : volet « Distance max » et encart « près de toi »

**Files:**
- Modify: `components/lobby/ExploreFilterSheet.tsx`
- Modify: `app/(tabs)/lobby.tsx`

**Interfaces:**
- Consumes : Task 1 (`ZONE_RADII_KM`, `originLabel`, `type Origin`), Task 3 (`ExploreFilters.maxKm`), Task 5 (`useOrigin()` : `ready`, `radiusKm`), Task 7 (`demanderPointDeDepart`, `router`, `origin`, `gpsAvailable`, `zoneAvailable`, `requestGps` déjà déclarés dans `ExploreTab`).
- Produces : nouvelles props de `ExploreFilterSheet` : `origin: Origin | null`, `defaultMaxKm: number`, `gpsAvailable: boolean`, `zoneAvailable: boolean`, `onRequestOrigin: () => void`, `onChooseZone: () => void`.

- [ ] **Step 1 : props et imports du volet**

Dans `components/lobby/ExploreFilterSheet.tsx`, ajouter l'import :

```ts
import { ZONE_RADII_KM, originLabel, type Origin } from '../../lib/geo';
```

Dans la déstructuration des props de `ExploreFilterSheet`, remplacer `resultCount, onApply, onClose,` par `resultCount, onApply, onClose, origin, defaultMaxKm, gpsAvailable, zoneAvailable, onRequestOrigin, onChooseZone,`. Dans le type des props, après `onClose: () => void;`, ajouter :

```ts
  /** Point de départ des distances (GPS récent ou zone) ; null = aucun. */
  origin: Origin | null;
  /** Valeur prise à la première activation : rayon de la zone, 20 km sans zone. */
  defaultMaxKm: number;
  gpsAvailable: boolean;
  zoneAvailable: boolean;
  /** Demande la position du téléphone (autorisation comprise). */
  onRequestOrigin: () => void;
  /** Ferme le volet et ouvre « Ma zone ». */
  onChooseZone: () => void;
```

- [ ] **Step 2 : section « Distance »**

Juste après la fermeture `</Section>` de la section `title="Lieu"`, ajouter :

```tsx
            <Section title="Distance" icon="radar">
              {origin ? (
                <>
                  <View style={{
                    flexDirection: 'row', alignItems: 'center', gap: 12,
                    backgroundColor: Colors.bgCard, borderRadius: 14, padding: 14,
                    borderWidth: 1, borderColor: Colors.border,
                  }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, fontFamily: Fonts.uiExtraBold, color: Colors.textPrimary }}>
                        Distance max
                      </Text>
                      <Text style={{ fontSize: 11.5, fontFamily: Fonts.ui, color: Colors.textSecondary, marginTop: 2, lineHeight: 16 }}>
                        Mesurée {originLabel(origin)}. Les clubs dont la position exacte est inconnue sont écartés.
                      </Text>
                    </View>
                    <Switch
                      value={draft.maxKm !== null}
                      onValueChange={v => set('maxKm', v ? defaultMaxKm : null)}
                      trackColor={{ false: Colors.border, true: Colors.brand }}
                      thumbColor={Colors.bgCard}
                    />
                  </View>
                  {draft.maxKm !== null && (
                    <Row>
                      {ZONE_RADII_KM.map(r => (
                        <Chip key={r} label={`${r} km`} active={draft.maxKm === r} onPress={() => set('maxKm', r)} />
                      ))}
                    </Row>
                  )}
                </>
              ) : (
                // Sans point de départ, la distance est grisée : on dit comment en avoir un.
                <View style={{
                  backgroundColor: Colors.bgCard, borderRadius: 14, padding: 14, gap: 10,
                  borderWidth: 1, borderColor: Colors.border,
                }}>
                  <Text style={{ fontSize: 13, fontFamily: Fonts.uiExtraBold, color: Colors.textMuted }}>Distance max</Text>
                  <Text style={{ fontSize: 11.5, fontFamily: Fonts.ui, color: Colors.textSecondary, lineHeight: 16 }}>
                    Active ta position ou choisis ta zone pour filtrer par distance.
                  </Text>
                  <Row>
                    {gpsAvailable && <Chip label="Utiliser ma position" active={false} onPress={onRequestOrigin} />}
                    {zoneAvailable && <Chip label="Choisir ma zone" active={false} onPress={onChooseZone} />}
                    {/* Un filtre enregistré peut porter une distance sans point de départ : il doit pouvoir se retirer. */}
                    {draft.maxKm !== null && <Chip label="Retirer la distance" active={false} onPress={() => set('maxKm', null)} />}
                  </Row>
                </View>
              )}
            </Section>
```

- [ ] **Step 3 : brancher le volet dans l'Explorer**

Dans `ExploreTab` (`app/(tabs)/lobby.tsx`), compléter la déstructuration de la Task 7 :

```tsx
  const { origin, distanceOf, gpsAvailable, zoneAvailable, requestGps, refreshGps, ready, radiusKm } = useOrigin();
```

(remplace la ligne `const { origin, distanceOf, gpsAvailable, zoneAvailable, requestGps, refreshGps } = useOrigin();`). Dans `<ExploreFilterSheet … />`, après `onClose={() => setSheetOpen(false)}`, ajouter :

```tsx
        origin={origin}
        defaultMaxKm={radiusKm}
        gpsAvailable={gpsAvailable}
        zoneAvailable={zoneAvailable}
        onRequestOrigin={async () => {
          if (await requestGps()) return;
          Alert.alert('Position indisponible', zoneAvailable
            ? 'Autorise la localisation dans les réglages du téléphone, ou choisis ta zone.'
            : 'Autorise la localisation dans les réglages du téléphone.');
        }}
        // Le volet est une fenêtre native : la fermer AVANT d'ouvrir un écran,
        // sinon l'écran s'ouvre derrière elle.
        onChooseZone={() => { setSheetOpen(false); router.push('/zone' as any); }}
```

- [ ] **Step 4 : encart « Trouve les parties près de toi »**

En tête de `app/(tabs)/lobby.tsx`, ajouter l'import (s'il n'existe pas déjà) :

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
```

et, au niveau du module (hors composant, par exemple juste avant `function exploreCtx(`) :

```ts
/** Encart « près de toi » masqué par le joueur : il ne revient pas. */
const ORIGIN_HINT_KEY = 'explore.originHint.dismissed';
```

Dans `ExploreTab`, après la déclaration de `choisirTri` (Task 7), ajouter :

```tsx
  // Démarre masqué pour ne pas clignoter le temps de relire le réglage.
  const [encartMasque, setEncartMasque] = useState(true);
  useEffect(() => {
    AsyncStorage.getItem(ORIGIN_HINT_KEY)
      .then(v => setEncartMasque(v === '1'))
      .catch(() => setEncartMasque(false));
  }, []);
  const masquerEncart = () => {
    setEncartMasque(true);
    AsyncStorage.setItem(ORIGIN_HINT_KEY, '1').catch(() => {});
  };
  const montrerEncart = ready && !origin && !encartMasque && (gpsAvailable || zoneAvailable);
```

Dans le rendu, juste avant la rangée « Trier » ajoutée en Task 7 (`{(gpsAvailable || zoneAvailable) && (`), ajouter :

```tsx
      {montrerEncart && (
        <View style={{
          marginHorizontal: 14, marginBottom: 12, padding: 14, borderRadius: 14, gap: 10,
          backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
            <Icon name="radar" size={18} color={Colors.textPrimary} stroke={2.2} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13.5, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>
                Trouve les parties près de toi
              </Text>
              <Text style={{ fontSize: 12, fontFamily: Fonts.ui, color: Colors.textSecondary, lineHeight: 17, marginTop: 2 }}>
                Utilise ta position ou choisis ta zone pour voir la distance de chaque partie.
              </Text>
            </View>
            <TouchableOpacity onPress={masquerEncart} hitSlop={10} accessibilityLabel="Masquer">
              <Icon name="x" size={15} color={Colors.textMuted} stroke={2.4} />
            </TouchableOpacity>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {gpsAvailable && (
              <TouchableOpacity
                onPress={() => { void demanderPointDeDepart(); }}
                activeOpacity={0.85}
                style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10, backgroundColor: Colors.primary }}
              >
                <Text style={{ fontSize: 12.5, fontFamily: Fonts.uiBlack, color: Colors.textOnDark }}>Utiliser ma position</Text>
              </TouchableOpacity>
            )}
            {zoneAvailable && (
              <TouchableOpacity
                onPress={() => router.push('/zone' as any)}
                activeOpacity={0.85}
                style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10, backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border }}
              >
                <Text style={{ fontSize: 12.5, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>Choisir ma zone</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}
```

- [ ] **Step 5 : types et tests**

Run: `npx tsc --noEmit -p tsconfig.json` puis `node node_modules/vitest/vitest.mjs run lib`
Expected: types propres ; tous les tests verts.

- [ ] **Step 6 : commit**

```bash
git add components/lobby/ExploreFilterSheet.tsx "app/(tabs)/lobby.tsx"
git commit -m "feat(localisation): volet Distance max et encart près de toi dans l'Explorer (lot 1)"
```

---

### Task 9 : livraison (contrôleur + utilisateur)

Pas de sous-agent : étapes menées par le contrôleur avec l'utilisateur.

- [ ] **Step 1 : faire appliquer la migration**

L'utilisateur applique `supabase/migrations/player_zones.sql` dans l'éditeur SQL de Supabase. (Sans elle, l'app masque « Ma zone » et reste sur le GPS seul.)

- [ ] **Step 2 : publier sur le canal de test**

Run: `EAS_SKIP_AUTO_FINGERPRINT=1 npx eas update --branch preview --environment preview --message "Localisation lot 1 : position, zone, distance dans l'Explorer" --non-interactive`
Puis `npx eas update:list --branch preview --limit 1 --non-interactive` pour vérifier que la publication est bien là.

- [ ] **Step 3 : essais sur téléphone (utilisateur)**

Dans Expo Go (iPhone), qui contient déjà le module GPS :
1. Explorer : l'encart « Trouve les parties près de toi » apparaît ; « Utiliser ma position » affiche la demande du système **à ce moment-là seulement**.
2. Après autorisation : distance à côté du club sur les cartes (« ~12 km » pour un club au centre-ville), « Trier : Proximité » réordonne, « depuis ta position » s'affiche.
3. Menu du profil → « Ma zone » : déplacer l'épingle, changer le rayon, enregistrer ; refuser la localisation dans les réglages du téléphone → les distances se calculent « depuis ta zone ».
4. Filtres → « Distance max » : l'interrupteur prend le rayon de la zone ; seules les parties dans des clubs à position précise restent.

Sur l'APK Android actuel (sans le module GPS) : aucune demande de position, aucun plantage ; « Ma zone » fonctionne et sert de point de départ.

- [ ] **Step 4 : nouvel APK (quand l'utilisateur le décide)**

Ajouter **à la main** dans `android/app/src/main/AndroidManifest.xml` (le dossier n'est pas régénéré) :

```xml
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION"/>
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>
```

puis construire l'APK comme d'habitude (`cd android && JAVA_HOME="C:\Program Files\Android\Android Studio\jbr" ./gradlew.bat assembleRelease --no-daemon`), vérifier que le canal `preview` est toujours déclaré dans le manifeste, et refaire l'essai 1 sur Android.
