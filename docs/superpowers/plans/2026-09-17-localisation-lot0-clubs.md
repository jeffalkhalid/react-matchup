# Localisation — Lot 0 : positions précises des clubs — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer les coordonnées « centre-ville » des 80 clubs imprécis par des positions précises, validées club par club par l'utilisateur à partir de son fichier Excel, puis importées par une migration SQL.

**Architecture:** Deux scripts Node (`.mjs`), lancés à la main et jamais embarqués dans l'app. Le premier lit les clubs de la base (lecture seule, clé publique) et le fichier de l'utilisateur, propose une correspondance par club et produit un fichier Excel de vérification. L'utilisateur y remplit une colonne « Décision ». Le second lit ce fichier rempli, contrôle chaque position et écrit une migration SQL que l'utilisateur applique. Toute la logique de décision vit dans un module pur, testé.

**Tech Stack:** Node 22 (ESM), `exceljs` 4.4.0 (dépendance de développement), vitest 4, API REST Supabase en lecture.

**Spec:** `docs/superpowers/specs/2026-09-17-localisation-design.md` (section « Lot 0 »)

## Global Constraints

- Aucun script n'écrit dans la base : lecture seule via `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` du fichier `.env`. Les mises à jour passent par une migration SQL appliquée par l'utilisateur.
- Une mise à jour ne touche que les clubs encore `geo_confidence = 'city'` (`WHERE ... AND geo_confidence = 'city'`), et les passe en `'exact'` avec `geo_source = 'verification_2026-09'`.
- Rien n'est écrit en base sans décision explicite de l'utilisateur : `oui` ou un lien Google Maps.
- Contrôles obligatoires avant écriture : point dans le Maroc (latitude 20,7 à 35,95 ; longitude −17,2 à −0,95), à 40 km maximum du centre de la ville du club, et pas le même point (5 décimales) que celui d'un autre club retenu.
- Les fichiers Excel (source, vérification) et la migration produite ne sont jamais commités : le dépôt GitHub est public et `supabase/` n'est pas versionné.
- Ne pas commiter sans demande explicite de l'utilisateur (préférence du projet).
- Commentaires et messages en français, dans le style du dépôt : le code dit ce qu'il fait et POURQUOI.

---

## Structure des fichiers

| Fichier | Rôle |
|---|---|
| `scripts/clubs-geo/clubsGeo.mjs` (créé) | Logique pure : normalisation, distance, rapprochement, alertes, lecture des liens Maps, lecture des décisions, contrôles, requête SQL |
| `scripts/clubs-geo/clubsGeo.d.mts` (créé) | Types du module pur, pour que le test TypeScript compile |
| `scripts/clubs-geo/base.mjs` (créé) | Lecture de `.env` et des clubs de la base (REST, lecture seule) |
| `scripts/clubs-geo/fichier-verification.mjs` (créé) | Produit le fichier Excel de vérification |
| `scripts/clubs-geo/migration-clubs.mjs` (créé) | Lit le fichier rempli, contrôle, écrit la migration SQL |
| `lib/__tests__/clubsGeo.test.ts` (créé) | Tests du module pur |
| `package.json` / `package-lock.json` (modifiés) | `exceljs` en dépendance de développement |

---

### Task 1 : module pur de rapprochement et de contrôle

**Files:**
- Create: `scripts/clubs-geo/clubsGeo.mjs`
- Create: `scripts/clubs-geo/clubsGeo.d.mts`
- Test: `lib/__tests__/clubsGeo.test.ts`

**Interfaces:**
- Produces (utilisé par les tâches 2 et 3) :
  - `normaliserVille(s: string | null | undefined): string`
  - `motsSignificatifs(nom: string, motsVille?: Set<string>): Set<string>`
  - `distanceKm(a: Point, b: Point): number` avec `Point = { lat: number; lng: number }`
  - `centresVilles(clubs: ClubBase[]): Map<string, Point>`
  - `proposerCorrespondance(club: ClubBase, fichier: ClubFichier[], centre?: Point): Proposition`
  - `marquerPointsPartages(propositions: Proposition[]): Proposition[]`
  - `lireLienMaps(texte: string): Point | null`, `estLienCourt(texte: string): boolean`
  - `controlerPoint(point: Point, centre: Point | undefined, ville: string): string[]`
  - `lireDecision(cellule: unknown): Decision`
  - `requeteMiseAJour(p: { id: string; lat: number; lng: number }): string`
  - Types : `ClubBase = { id; name; city; latitude; longitude; geo_confidence }`, `ClubFichier = { ville; nom; adresse; lat; lng; statut }`, `Proposition = { fichier: ClubFichier | null; communs: string[]; score: number; alertes: string[] }`, `Decision = { type: 'vide' } | { type: 'oui' } | { type: 'non' } | { type: 'lien'; texte: string } | { type: 'inconnu'; texte: string }`

- [ ] **Step 1 : écrire les tests (ils échouent : le module n'existe pas)**

`lib/__tests__/clubsGeo.test.ts` :

```ts
// Lot 0 de la localisation : rapprocher les clubs de la base de ceux du
// fichier de l'utilisateur, et ne jamais écrire une position douteuse.
// Les cas viennent des mesures du 2026-09-17 sur les vraies données.
import { describe, it, expect } from 'vitest';
import {
  normaliserVille, motsSignificatifs, distanceKm, centresVilles,
  proposerCorrespondance, marquerPointsPartages, lireLienMaps, estLienCourt,
  controlerPoint, lireDecision, requeteMiseAJour,
} from '../../scripts/clubs-geo/clubsGeo.mjs';

const fichier = (ville: string, nom: string, lat: number, lng: number) =>
  ({ ville, nom, adresse: '', lat, lng, statut: 'Confirmé 2026' });
const base = (name: string, city: string) =>
  ({ id: '74f98e48-a088-4505-b2ac-9f6511496819', name, city, latitude: 0, longitude: 0, geo_confidence: 'city' });

describe('normalisation', () => {
  it('ignore accents, casse et espaces dans les villes', () => {
    expect(normaliserVille('Fès')).toBe(normaliserVille('fes'));
    expect(normaliserVille('Dar Bouazza')).toBe('darbouazza');
  });
  it('retire les mots vides et le nom de la ville', () => {
    expect([...motsSignificatifs('Agadir Padel Club', new Set(['agadir']))]).toEqual([]);
    expect([...motsSignificatifs('Oasis Sport City / City Ball')].sort()).toEqual(['ball', 'city', 'oasis']);
  });
});

describe('distance', () => {
  it('Casablanca → Rabat ≈ 87 km', () => {
    const d = distanceKm({ lat: 33.5731, lng: -7.5898 }, { lat: 34.0209, lng: -6.8416 });
    expect(d).toBeGreaterThan(85);
    expect(d).toBeLessThan(90);
  });
  it('centre des villes = point des clubs « city »', () => {
    const c = centresVilles([
      { ...base('A', 'Rabat'), latitude: 34.02, longitude: -6.84 },
      { ...base('B', 'Rabat'), latitude: 34.02, longitude: -6.84, geo_confidence: 'exact' },
    ]);
    expect(c.get('rabat')).toEqual({ lat: 34.02, lng: -6.84 });
  });
});

describe('rapprochement', () => {
  const casa = [fichier('Casablanca', 'City Ball / Oasis Sports City', 33.5485, -7.6372)];

  it('mêmes mots dans un autre ordre : correspondance sans alerte', () => {
    const p = proposerCorrespondance(base('Oasis Sport City / City Ball', 'Casablanca'), casa, { lat: 33.5731, lng: -7.5898 });
    expect(p.fichier?.nom).toBe('City Ball / Oasis Sports City');
    expect(p.alertes).toEqual([]);
  });

  it('seul le nom de la ville en commun : aucune correspondance', () => {
    const p = proposerCorrespondance(base('Agadir Padel Club', 'Agadir'), [fichier('Agadir', 'Royal Tennis Club Agadir', 30.42, -9.6)]);
    expect(p.fichier).toBeNull();
    expect(p.alertes).toEqual(['absent du fichier']);
  });

  it('un seul mot en commun sur plusieurs : alerte', () => {
    const p = proposerCorrespondance(base('Fairmont Royal Palm Marrakech', 'Marrakech'), [fichier('Marrakech', 'Palm Tennis Club & Padel', 31.6, -8.0)]);
    expect(p.alertes).toContain('un seul mot en commun');
  });

  it('jamais d\'une ville à une autre', () => {
    const p = proposerCorrespondance(base('Hercules Park', 'Agadir'), [fichier('Tanger', 'Hercules Park', 35.7, -5.8)]);
    expect(p.fichier).toBeNull();
  });

  it('loin du centre de la ville : alerte', () => {
    const p = proposerCorrespondance(base('Padel Valley', 'Rabat'), [fichier('Rabat', 'Padel Valley', 34.9, -6.84)], { lat: 34.02, lng: -6.84 });
    expect(p.alertes.some(a => a.startsWith('loin de la ville'))).toBe(true);
  });

  it('deux clubs de la base sur le même point du fichier : alerte des deux côtés', () => {
    const f = fichier('Marrakech', 'Palm Tennis Club & Padel', 31.6, -8.0);
    const ps = marquerPointsPartages([
      proposerCorrespondance(base('Palm Tennis Club', 'Marrakech'), [f]),
      proposerCorrespondance(base('Fairmont Royal Palm', 'Marrakech'), [f]),
    ]);
    expect(ps.every(p => p.alertes.includes('point partagé avec un autre club'))).toBe(true);
  });
});

describe('liens Google Maps', () => {
  it('lit ?q=lat,lng', () => {
    expect(lireLienMaps('https://www.google.com/maps?q=33.5025278,-7.6837912')).toEqual({ lat: 33.5025278, lng: -7.6837912 });
  });
  it('préfère l\'épingle (!3d!4d) au centre de la vue (@)', () => {
    const l = 'https://www.google.com/maps/place/X/@33.54,-7.61,17z/data=!3d33.5425125!4d-7.6182031';
    expect(lireLienMaps(l)).toEqual({ lat: 33.5425125, lng: -7.6182031 });
  });
  it('lit une virgule encodée et un couple collé tel quel', () => {
    expect(lireLienMaps('https://maps.google.com/?q=33.5%2C-7.6')).toEqual({ lat: 33.5, lng: -7.6 });
    expect(lireLienMaps('33.5025, -7.6838')).toEqual({ lat: 33.5025, lng: -7.6838 });
  });
  it('rend null sur un texte illisible, et repère les liens courts', () => {
    expect(lireLienMaps('voir avec le club')).toBeNull();
    expect(estLienCourt('https://maps.app.goo.gl/AbCd123')).toBe(true);
    expect(estLienCourt('https://www.google.com/maps?q=1,2')).toBe(false);
  });
});

describe('contrôles', () => {
  const rabat = { lat: 34.02, lng: -6.84 };
  it('accepte un point proche de la ville', () => {
    expect(controlerPoint({ lat: 34.0, lng: -6.8 }, rabat, 'Rabat')).toEqual([]);
  });
  it('refuse un point hors du Maroc', () => {
    expect(controlerPoint({ lat: 48.85, lng: 2.35 }, rabat, 'Rabat')).toEqual(['hors du Maroc']);
  });
  it('refuse un point à plus de 40 km de la ville', () => {
    expect(controlerPoint({ lat: 34.6, lng: -6.84 }, rabat, 'Rabat')[0]).toMatch(/km de Rabat$/);
  });
});

describe('décisions', () => {
  it('oui / non / vide, sans tenir compte de la casse ni des accents', () => {
    expect(lireDecision('Oui')).toEqual({ type: 'oui' });
    expect(lireDecision(' NON ')).toEqual({ type: 'non' });
    expect(lireDecision('')).toEqual({ type: 'vide' });
    expect(lireDecision(null)).toEqual({ type: 'vide' });
  });
  it('un lien, y compris sous forme de cellule lien d\'Excel', () => {
    expect(lireDecision('https://maps.app.goo.gl/x')).toEqual({ type: 'lien', texte: 'https://maps.app.goo.gl/x' });
    expect(lireDecision({ text: 'lien', hyperlink: 'https://www.google.com/maps?q=1.5,2.5' }))
      .toEqual({ type: 'lien', texte: 'https://www.google.com/maps?q=1.5,2.5' });
  });
  it('tout le reste est signalé, jamais deviné', () => {
    expect(lireDecision('peut-être')).toEqual({ type: 'inconnu', texte: 'peut-être' });
  });
});

describe('requête SQL', () => {
  it('ne touche qu\'un club encore imprécis, et note la source', () => {
    const sql = requeteMiseAJour({ id: '74f98e48-a088-4505-b2ac-9f6511496819', lat: 33.5, lng: -7.6 });
    expect(sql).toBe("UPDATE public.clubs SET latitude = 33.5000000, longitude = -7.6000000, geo_confidence = 'exact', geo_source = 'verification_2026-09' WHERE id = '74f98e48-a088-4505-b2ac-9f6511496819' AND geo_confidence = 'city';");
  });
  it('refuse un identifiant qui n\'est pas un uuid', () => {
    expect(() => requeteMiseAJour({ id: "x'; DROP TABLE clubs; --", lat: 1, lng: 1 })).toThrow();
  });
});
```

- [ ] **Step 2 : lancer les tests, vérifier qu'ils échouent**

Run: `node node_modules/vitest/vitest.mjs run lib/__tests__/clubsGeo.test.ts`
Expected: FAIL — « Failed to resolve import "../../scripts/clubs-geo/clubsGeo.mjs" ».

- [ ] **Step 3 : écrire le module pur**

`scripts/clubs-geo/clubsGeo.mjs` :

```js
// scripts/clubs-geo/clubsGeo.mjs — logique PURE du lot 0 de la localisation.
//
// 80 clubs sur 108 sont placés au centre de leur ville : toute distance calculée
// vers eux est fausse. L'utilisateur a fourni un fichier de positions ; ce module
// décide, sans réseau ni fichier, ce qu'on peut en tirer et ce qu'il faut lui
// faire vérifier. Mesures du 2026-09-17 : le fichier est juste quand le club est
// le bon (10 clubs sur 11 à moins de 170 m), mais le rapprochement des NOMS se
// trompe, surtout quand deux noms n'ont en commun que le nom de la ville.
//
// Testé par lib/__tests__/clubsGeo.test.ts.

// Mots qui ne distinguent pas un club d'un autre.
const MOTS_VIDES = new Set((
  'padel club clubs complexe sport sports sportif sportive academy academie ' +
  'the le la les de du des et and at center centre park football foot tennis fc association'
).split(' '));

export function sansAccents(s) {
  return String(s ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function normaliserVille(s) {
  return sansAccents(s).replace(/[^a-z]/g, '');
}

/** Mots qui identifient un club : ni mots vides, ni mots du nom de sa ville. */
export function motsSignificatifs(nom, motsVille = new Set()) {
  return new Set(
    sansAccents(nom).split(/[^a-z0-9]+/)
      .filter(m => m.length > 1 && !MOTS_VIDES.has(m) && !motsVille.has(m)),
  );
}

/** Distance à vol d'oiseau (haversine), en km. */
export function distanceKm(a, b) {
  const R = 6371;
  const rad = d => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Le centre d'une ville = le point partagé par ses clubs placés « city ». */
export function centresVilles(clubs) {
  const centres = new Map();
  for (const c of clubs) {
    if (c.geo_confidence === 'city' && c.latitude != null && c.longitude != null) {
      centres.set(normaliserVille(c.city), { lat: c.latitude, lng: c.longitude });
    }
  }
  return centres;
}

export const LOIN_DE_LA_VILLE_KM = 30;

/**
 * Le club du fichier qui correspond le mieux à un club de la base, dans la MÊME
 * ville uniquement, avec les raisons de douter. Ce n'est qu'une proposition :
 * l'utilisateur tranche.
 */
export function proposerCorrespondance(club, fichier, centre) {
  const ville = normaliserVille(club.city);
  const motsVille = motsSignificatifs(club.city);
  const mb = motsSignificatifs(club.name, motsVille);
  let meilleure = null;
  for (const f of fichier) {
    if (normaliserVille(f.ville) !== ville) continue;
    const mf = motsSignificatifs(f.nom, motsVille);
    const communs = [...mb].filter(m => mf.has(m));
    if (communs.length === 0) continue;
    const score = communs.length / Math.min(mb.size, mf.size);
    if (!meilleure || score > meilleure.score
        || (score === meilleure.score && communs.length > meilleure.communs.length)) {
      meilleure = { fichier: f, communs, score };
    }
  }
  if (!meilleure) return { fichier: null, communs: [], score: 0, alertes: ['absent du fichier'] };

  const alertes = [];
  if (meilleure.communs.length === 1 && mb.size >= 2) alertes.push('un seul mot en commun');
  if (meilleure.score < 1) alertes.push('noms partiellement différents');
  if (centre) {
    const d = distanceKm(centre, meilleure.fichier);
    if (d > LOIN_DE_LA_VILLE_KM) alertes.push(`loin de la ville (${Math.round(d)} km)`);
    if (d < 0.3) alertes.push('au centre-ville');
  }
  return { ...meilleure, alertes };
}

/** Deux clubs de la base proposés sur le même point : au moins un est faux. */
export function marquerPointsPartages(propositions) {
  const cle = p => `${p.fichier.lat.toFixed(5)},${p.fichier.lng.toFixed(5)}`;
  const compte = new Map();
  for (const p of propositions) if (p.fichier) compte.set(cle(p), (compte.get(cle(p)) ?? 0) + 1);
  for (const p of propositions) {
    if (p.fichier && compte.get(cle(p)) > 1) p.alertes.push('point partagé avec un autre club');
  }
  return propositions;
}

const NOMBRE = '(-?\\d{1,3}\\.\\d+)';
const FORMES_LIEN = [
  new RegExp(`!3d${NOMBRE}!4d${NOMBRE}`),                                   // épingle d'un lieu
  new RegExp(`[?&](?:q|ll|query|destination|center)=${NOMBRE},\\s*${NOMBRE}`),
  new RegExp(`@${NOMBRE},${NOMBRE}`),                                        // centre de la vue
  new RegExp(`^${NOMBRE}\\s*,\\s*${NOMBRE}$`),                               // « lat, lng » collé
];

/** Coordonnées lues dans un lien Google Maps ou un couple « lat, lng ». */
export function lireLienMaps(texte) {
  let t = String(texte ?? '').trim();
  if (!t) return null;
  try { t = decodeURIComponent(t); } catch { /* lien mal encodé : on lit tel quel */ }
  for (const re of FORMES_LIEN) {
    const m = t.match(re);
    if (!m) continue;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng };
    }
  }
  return null;
}

/** Lien court de partage (maps.app.goo.gl) : il faut suivre la redirection. */
export function estLienCourt(texte) {
  return /(maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test(String(texte ?? ''));
}

export const MAROC = { latMin: 20.7, latMax: 35.95, lngMin: -17.2, lngMax: -0.95 };
export const MAX_KM_DE_LA_VILLE = 40;

/** Raisons de refuser un point. Vide = acceptable. */
export function controlerPoint(point, centre, ville) {
  if (point.lat < MAROC.latMin || point.lat > MAROC.latMax
      || point.lng < MAROC.lngMin || point.lng > MAROC.lngMax) {
    return ['hors du Maroc'];
  }
  if (centre) {
    const d = distanceKm(point, centre);
    if (d > MAX_KM_DE_LA_VILLE) return [`à ${Math.round(d)} km de ${ville}`];
  }
  return [];
}

/** Ce que l'utilisateur a écrit dans la colonne « Décision ». */
export function lireDecision(cellule) {
  const brut = cellule == null ? ''
    : typeof cellule === 'object' ? String(cellule.hyperlink ?? cellule.text ?? '')
    : String(cellule);
  const t = brut.trim();
  if (!t) return { type: 'vide' };
  const bas = sansAccents(t);
  if (['oui', 'o', 'ok', 'yes', 'y'].includes(bas)) return { type: 'oui' };
  if (['non', 'n', 'no'].includes(bas)) return { type: 'non' };
  if (/https?:\/\//i.test(t) || /-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+/.test(t)) return { type: 'lien', texte: t };
  return { type: 'inconnu', texte: t };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SOURCE_VERIFICATION = 'verification_2026-09';

/** Mise à jour d'UN club, seulement s'il est encore placé au centre-ville. */
export function requeteMiseAJour({ id, lat, lng }) {
  if (!UUID.test(String(id))) throw new Error(`identifiant de club invalide : ${id}`);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error(`coordonnées invalides pour ${id}`);
  return `UPDATE public.clubs SET latitude = ${lat.toFixed(7)}, longitude = ${lng.toFixed(7)}, `
    + `geo_confidence = 'exact', geo_source = '${SOURCE_VERIFICATION}' `
    + `WHERE id = '${id}' AND geo_confidence = 'city';`;
}
```

`scripts/clubs-geo/clubsGeo.d.mts` :

```ts
// Types de scripts/clubs-geo/clubsGeo.mjs (pour les tests TypeScript).
export interface Point { lat: number; lng: number }
export interface ClubBase {
  id: string; name: string; city: string;
  latitude: number | null; longitude: number | null; geo_confidence: string | null;
}
export interface ClubFichier { ville: string; nom: string; adresse: string; lat: number; lng: number; statut: string }
export interface Proposition { fichier: ClubFichier | null; communs: string[]; score: number; alertes: string[] }
export type Decision =
  | { type: 'vide' } | { type: 'oui' } | { type: 'non' }
  | { type: 'lien'; texte: string } | { type: 'inconnu'; texte: string };

export function sansAccents(s: string | null | undefined): string;
export function normaliserVille(s: string | null | undefined): string;
export function motsSignificatifs(nom: string, motsVille?: Set<string>): Set<string>;
export function distanceKm(a: Point, b: Point): number;
export function centresVilles(clubs: ClubBase[]): Map<string, Point>;
export const LOIN_DE_LA_VILLE_KM: number;
export function proposerCorrespondance(club: ClubBase, fichier: ClubFichier[], centre?: Point): Proposition;
export function marquerPointsPartages(propositions: Proposition[]): Proposition[];
export function lireLienMaps(texte: string): Point | null;
export function estLienCourt(texte: string): boolean;
export const MAROC: { latMin: number; latMax: number; lngMin: number; lngMax: number };
export const MAX_KM_DE_LA_VILLE: number;
export function controlerPoint(point: Point, centre: Point | undefined, ville: string): string[];
export function lireDecision(cellule: unknown): Decision;
export const SOURCE_VERIFICATION: string;
export function requeteMiseAJour(p: { id: string; lat: number; lng: number }): string;
```

- [ ] **Step 4 : lancer les tests, vérifier qu'ils passent**

Run: `node node_modules/vitest/vitest.mjs run lib/__tests__/clubsGeo.test.ts`
Expected: PASS (tous les tests du fichier).

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: aucune sortie.

- [ ] **Step 5 : suite complète**

Run: `node node_modules/vitest/vitest.mjs run lib`
Expected: toutes les suites passent (682 tests avant ce lot + les nouveaux).

---

### Task 2 : fichier Excel de vérification

**Files:**
- Modify: `package.json`, `package-lock.json` (via npm)
- Create: `scripts/clubs-geo/base.mjs`
- Create: `scripts/clubs-geo/fichier-verification.mjs`

**Interfaces:**
- Consumes: `centresVilles`, `proposerCorrespondance`, `marquerPointsPartages`, `distanceKm` (Task 1)
- Produces:
  - `lireClubsBase(): Promise<ClubBase[]>` et `lireEnv(): Record<string, string>` (`base.mjs`, utilisés par la tâche 3)
  - Fichier Excel, feuille **« Vérification »**, colonnes dans cet ordre (la tâche 3 les lit par position) : A `Identifiant` (masquée) · B `Ville` · C `Club (base)` · D `Correspondance proposée` · E `Adresse` · F `Latitude` · G `Longitude` · H `Voir sur la carte` · I `Distance au centre-ville (km)` · J `Statut du fichier` · K `Alertes` · L `Décision` · M `Commentaire`

- [ ] **Step 1 : ajouter exceljs en dépendance de développement**

Run: `npm install --save-dev exceljs@4.4.0`
Expected: `package.json` contient `"exceljs": "^4.4.0"` dans `devDependencies`.

- [ ] **Step 2 : écrire la lecture de la base**

`scripts/clubs-geo/base.mjs` :

```js
// scripts/clubs-geo/base.mjs — lecture des clubs de la base, en LECTURE SEULE.
// Clé publique de l'app (.env) : les scripts du lot 0 n'écrivent jamais en base,
// ils produisent une migration que l'utilisateur applique lui-même.
import { readFileSync } from 'node:fs';

export function lireEnv() {
  const texte = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
  const env = {};
  for (const ligne of texte.split(/\r?\n/)) {
    const m = ligne.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

export async function lireClubsBase() {
  const env = lireEnv();
  const url = env.EXPO_PUBLIC_SUPABASE_URL;
  const cle = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !cle) throw new Error('EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY absents de .env');
  const reponse = await fetch(
    `${url}/rest/v1/clubs?select=id,name,city,latitude,longitude,geo_confidence&order=city,name`,
    { headers: { apikey: cle, Authorization: `Bearer ${cle}` } },
  );
  if (!reponse.ok) throw new Error(`lecture des clubs : HTTP ${reponse.status}`);
  return reponse.json();
}
```

- [ ] **Step 3 : écrire le générateur du fichier de vérification**

`scripts/clubs-geo/fichier-verification.mjs` :

```js
// scripts/clubs-geo/fichier-verification.mjs — fichier Excel à vérifier.
//
// Usage : node scripts/clubs-geo/fichier-verification.mjs <fichier-source.xlsx> <sortie.xlsx>
//
// Une ligne par club de la base encore placé au centre-ville, avec la
// correspondance proposée dans le fichier de l'utilisateur, un lien pour la voir
// sur la carte, et les raisons d'en douter. L'utilisateur remplit « Décision » :
// oui, non, ou un lien Google Maps du bon emplacement.
import ExcelJS from 'exceljs';
import { lireClubsBase } from './base.mjs';
import { centresVilles, proposerCorrespondance, marquerPointsPartages, distanceKm, normaliserVille } from './clubsGeo.mjs';

const [source, sortie] = process.argv.slice(2);
if (!source || !sortie) {
  console.error('Usage : node scripts/clubs-geo/fichier-verification.mjs <fichier-source.xlsx> <sortie.xlsx>');
  process.exit(1);
}

async function lireFichierSource(chemin) {
  const classeur = new ExcelJS.Workbook();
  await classeur.xlsx.readFile(chemin);
  const feuille = classeur.worksheets[0];
  const colonnes = {};
  feuille.getRow(1).eachCell((cellule, n) => { colonnes[String(cellule.value).trim()] = n; });
  const col = nom => {
    if (!colonnes[nom]) throw new Error(`colonne « ${nom} » introuvable dans ${chemin}`);
    return colonnes[nom];
  };
  const clubs = [];
  feuille.eachRow((ligne, i) => {
    if (i === 1) return;
    const nom = ligne.getCell(col('Club / terrain')).text.trim();
    const lat = Number(ligne.getCell(col('Latitude')).text);
    const lng = Number(ligne.getCell(col('Longitude')).text);
    if (!nom || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
    clubs.push({
      ville: ligne.getCell(col('Ville')).text.trim(),
      nom,
      adresse: ligne.getCell(col('Adresse')).text.trim(),
      lat, lng,
      statut: ligne.getCell(col('Statut vérification')).text.trim(),
    });
  });
  return clubs;
}

const base = await lireClubsBase();
const fichier = await lireFichierSource(source);
const centres = centresVilles(base);
const aVerifier = base.filter(c => c.geo_confidence === 'city');

const lignes = aVerifier.map(club => {
  const centre = centres.get(normaliserVille(club.city));
  return { club, centre, proposition: proposerCorrespondance(club, fichier, centre) };
});
marquerPointsPartages(lignes.map(l => l.proposition));

const classeur = new ExcelJS.Workbook();
const feuille = classeur.addWorksheet('Vérification', { views: [{ state: 'frozen', ySplit: 1 }] });
feuille.columns = [
  { header: 'Identifiant', key: 'id', width: 38, hidden: true },
  { header: 'Ville', key: 'ville', width: 14 },
  { header: 'Club (base)', key: 'club', width: 34 },
  { header: 'Correspondance proposée', key: 'proposee', width: 34 },
  { header: 'Adresse', key: 'adresse', width: 36 },
  { header: 'Latitude', key: 'lat', width: 12 },
  { header: 'Longitude', key: 'lng', width: 12 },
  { header: 'Voir sur la carte', key: 'carte', width: 16 },
  { header: 'Distance au centre-ville (km)', key: 'distance', width: 14 },
  { header: 'Statut du fichier', key: 'statut', width: 16 },
  { header: 'Alertes', key: 'alertes', width: 40 },
  { header: 'Décision', key: 'decision', width: 30 },
  { header: 'Commentaire', key: 'commentaire', width: 30 },
];
feuille.getRow(1).font = { bold: true };
feuille.autoFilter = 'A1:M1';

for (const { club, centre, proposition: p } of lignes) {
  const f = p.fichier;
  const ligne = feuille.addRow({
    id: club.id,
    ville: club.city,
    club: club.name,
    proposee: f?.nom ?? '',
    adresse: f?.adresse ?? '',
    lat: f?.lat ?? null,
    lng: f?.lng ?? null,
    carte: f ? { text: 'Ouvrir', hyperlink: `https://www.google.com/maps?q=${f.lat},${f.lng}` } : '',
    distance: f && centre ? Math.round(distanceKm(centre, f) * 10) / 10 : null,
    statut: f?.statut ?? '',
    alertes: p.alertes.join(' · '),
    decision: '',
    commentaire: '',
  });
  const fond = !f ? 'FFFDECEC' : p.alertes.length ? 'FFFFF4E5' : null;
  if (fond) ligne.eachCell({ includeEmpty: true }, c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fond } }; });
  ligne.getCell('decision').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF9C4' } };
  if (f) ligne.getCell('carte').font = { color: { argb: 'FF1F6FEB' }, underline: true };
}

const aide = classeur.addWorksheet("Mode d'emploi");
aide.getColumn(1).width = 110;
[
  'Une ligne par club placé au centre de sa ville. Remplis la colonne « Décision » :',
  '  • oui : la correspondance proposée est le bon club, sa position est juste (vérifie avec « Voir sur la carte ») ;',
  '  • non : la proposition est fausse et tu n\'as pas la bonne position — le club reste au centre-ville ;',
  '  • un lien Google Maps (ou « latitude, longitude ») : la position exacte du club, à utiliser à la place.',
  'Lignes rouges : club absent du fichier — colle un lien Google Maps si tu le trouves, sinon laisse vide.',
  'Lignes orange : proposition douteuse (voir « Alertes ») — vérifie-la avant de répondre oui.',
  'Case vide = aucun changement. Rien n\'est écrit en base sans ton oui ou ton lien.',
].forEach(t => aide.addRow([t]));

await classeur.xlsx.writeFile(sortie);

const sansAlerte = lignes.filter(l => l.proposition.fichier && l.proposition.alertes.length === 0).length;
const douteuses = lignes.filter(l => l.proposition.fichier && l.proposition.alertes.length > 0).length;
const absents = lignes.filter(l => !l.proposition.fichier).length;
console.log(`${lignes.length} clubs à vérifier → sans alerte ${sansAlerte} · douteux ${douteuses} · absents du fichier ${absents}`);
console.log(`Fichier écrit : ${sortie}`);
```

- [ ] **Step 4 : générer le fichier sur les vraies données**

Run: `node scripts/clubs-geo/fichier-verification.mjs "<pièces jointes>/c2d0f210-base_clubs_padel_maroc_PAGMATCH.xlsx" "<Bureau>/clubs_verification.xlsx"`
Expected: `80 clubs à vérifier → sans alerte N · douteux N · absents du fichier N` (total 80) et `Fichier écrit : …`.

- [ ] **Step 5 : relire le fichier produit**

Run (lecture de contrôle — exceljs vit dans `scripts/clubs-geo/node_modules`, jamais à la
racine : ce `require` doit s'exécuter depuis `scripts/clubs-geo`, sinon il ne le trouve plus) :
```bash
cd scripts/clubs-geo && node -e "const E=require('exceljs');(async()=>{const w=new E.Workbook();await w.xlsx.readFile('<Bureau>/clubs_verification.xlsx');const f=w.getWorksheet('Vérification');console.log('lignes',f.rowCount-1);console.log(f.getRow(1).values.slice(1).join(' | '));const r=f.getRow(2);console.log(r.getCell(3).text,'=>',r.getCell(4).text,r.getCell(11).text);})()"
```
Expected: `lignes 80`, l'en-tête des 13 colonnes dans l'ordre de l'interface, une ligne d'exemple lisible.

---

### Task 3 : migration SQL à partir du fichier rempli

**Files:**
- Create: `scripts/clubs-geo/migration-clubs.mjs`

**Interfaces:**
- Consumes: `lireClubsBase` (Task 2), `centresVilles`, `normaliserVille`, `lireDecision`, `lireLienMaps`, `estLienCourt`, `controlerPoint`, `requeteMiseAJour` (Task 1), colonnes A–M de la feuille « Vérification » (Task 2)
- Produces: `supabase/migrations/clubs_geo_precise.sql` (non versionné)

- [ ] **Step 1 : écrire le script**

`scripts/clubs-geo/migration-clubs.mjs` :

```js
// scripts/clubs-geo/migration-clubs.mjs — migration SQL des positions validées.
//
// Usage : node scripts/clubs-geo/migration-clubs.mjs <verification-remplie.xlsx> <sortie.sql>
//
// Ne retient QUE les lignes où l'utilisateur a répondu oui ou collé un lien, puis
// contrôle chaque point (Maroc, proche de la ville, pas partagé). Une ligne
// refusée est listée avec sa raison et n'entre pas dans la migration : on
// corrige le fichier et on relance.
import ExcelJS from 'exceljs';
import { writeFileSync } from 'node:fs';
import { lireClubsBase } from './base.mjs';
import {
  centresVilles, normaliserVille, lireDecision, lireLienMaps, estLienCourt,
  controlerPoint, requeteMiseAJour,
} from './clubsGeo.mjs';

const [entree, sortie] = process.argv.slice(2);
if (!entree || !sortie) {
  console.error('Usage : node scripts/clubs-geo/migration-clubs.mjs <verification-remplie.xlsx> <sortie.sql>');
  process.exit(1);
}

/** Suit les redirections d'un lien court (maps.app.goo.gl) jusqu'au lien complet. */
async function lienComplet(url) {
  let courant = url;
  for (let i = 0; i < 5; i++) {
    const r = await fetch(courant, { redirect: 'manual' });
    const suivant = r.headers.get('location');
    if (!suivant) return courant;
    courant = new URL(suivant, courant).toString();
    if (lireLienMaps(courant)) return courant;
  }
  return courant;
}

const clubs = new Map((await lireClubsBase()).map(c => [c.id, c]));
const centres = centresVilles([...clubs.values()]);

const classeur = new ExcelJS.Workbook();
await classeur.xlsx.readFile(entree);
const feuille = classeur.getWorksheet('Vérification');
if (!feuille) throw new Error('feuille « Vérification » introuvable');

const retenus = [];
const refus = [];
let ignores = 0;

for (let i = 2; i <= feuille.rowCount; i++) {
  const ligne = feuille.getRow(i);
  const id = ligne.getCell(1).text.trim();
  if (!id) continue;
  const nom = ligne.getCell(3).text.trim();
  const ville = ligne.getCell(2).text.trim();
  const decision = lireDecision(ligne.getCell(12).value);
  const club = clubs.get(id);

  if (decision.type === 'vide' || decision.type === 'non') { ignores++; continue; }
  if (!club) { refus.push({ nom, raison: 'club introuvable dans la base' }); continue; }
  if (club.geo_confidence !== 'city') { refus.push({ nom, raison: 'club déjà placé précisément — ignoré' }); continue; }
  if (decision.type === 'inconnu') { refus.push({ nom, raison: `décision illisible : « ${decision.texte} »` }); continue; }

  let point = null;
  if (decision.type === 'oui') {
    const lat = Number(ligne.getCell(6).text);
    const lng = Number(ligne.getCell(7).text);
    point = Number.isFinite(lat) && Number.isFinite(lng) && ligne.getCell(6).text ? { lat, lng } : null;
    if (!point) { refus.push({ nom, raison: 'oui sans correspondance proposée — coller un lien Google Maps' }); continue; }
  } else {
    const texte = estLienCourt(decision.texte) ? await lienComplet(decision.texte) : decision.texte;
    point = lireLienMaps(texte);
    if (!point) { refus.push({ nom, raison: 'lien illisible — ouvrir le lien et copier l\'adresse complète de la page' }); continue; }
  }

  const erreurs = controlerPoint(point, centres.get(normaliserVille(club.city)), club.city ?? ville);
  if (erreurs.length) { refus.push({ nom, raison: erreurs.join(' · ') }); continue; }
  retenus.push({ id, nom, ...point });
}

// Deux clubs retenus sur le même point : au moins un est faux, on écarte les deux.
const parPoint = new Map();
for (const r of retenus) {
  const cle = `${r.lat.toFixed(5)},${r.lng.toFixed(5)}`;
  parPoint.set(cle, [...(parPoint.get(cle) ?? []), r]);
}
const valides = [];
for (const groupe of parPoint.values()) {
  if (groupe.length === 1) { valides.push(groupe[0]); continue; }
  for (const r of groupe) refus.push({ nom: r.nom, raison: `même point que ${groupe.filter(x => x !== r).map(x => x.nom).join(', ')}` });
}

const sql = [
  '-- supabase/migrations/clubs_geo_precise.sql',
  '-- ============================================================',
  '-- Lot 0 de la localisation : positions précises des clubs placés au centre',
  '-- de leur ville, validées une à une par l\'utilisateur.',
  `-- Généré le ${new Date().toISOString().slice(0, 10)} depuis ${entree.split(/[\\/]/).pop()} : ${valides.length} club(s).`,
  '-- Ne touche qu\'un club encore geo_confidence = \'city\' : rejouer ne change rien.',
  '-- ============================================================',
  'BEGIN;',
  ...valides.map(v => `-- ${v.nom}\n${requeteMiseAJour(v)}`),
  'COMMIT;',
  '',
  '-- Vérification : nombre de clubs par précision (les « exact » doivent avoir augmenté).',
  '-- SELECT geo_confidence, count(*) FROM public.clubs GROUP BY geo_confidence;',
  '',
].join('\n');
writeFileSync(sortie, sql, 'utf8');

console.log(`Retenus : ${valides.length} · sans décision ou « non » : ${ignores} · refusés : ${refus.length}`);
for (const r of refus) console.log(`  ✗ ${r.nom} — ${r.raison}`);
console.log(`Migration écrite : ${sortie}`);
```

- [ ] **Step 2 : essai sur une copie remplie artificiellement**

Préparer une copie de contrôle avec trois décisions (un `oui` sur la première ligne proposée sans alerte, un lien sur une ligne absente, un `peut-être`) :

```bash
node -e "const E=require('exceljs');(async()=>{const w=new E.Workbook();await w.xlsx.readFile('<Bureau>/clubs_verification.xlsx');const f=w.getWorksheet('Vérification');let oui=0,lien=0,autre=0;for(let i=2;i<=f.rowCount;i++){const r=f.getRow(i);const propose=r.getCell(4).text,alertes=r.getCell(11).text;if(!oui&&propose&&!alertes){r.getCell(12).value='oui';oui=1}else if(!lien&&!propose&&r.getCell(2).text==='Casablanca'){r.getCell(12).value='https://www.google.com/maps?q=33.5896,-7.6326';lien=1}else if(!autre&&propose){r.getCell(12).value='peut-être';autre=1}}await w.xlsx.writeFile('<dossier temporaire>/clubs_essai.xlsx');console.log('copie prête',oui,lien,autre)})()"
```
Expected: `copie prête 1 1 1`.

Run: `node scripts/clubs-geo/migration-clubs.mjs "<dossier temporaire>/clubs_essai.xlsx" "<dossier temporaire>/clubs_essai.sql"`
Expected: `Retenus : 2 · sans décision ou « non » : 77 · refusés : 1`, la ligne `✗ … — décision illisible : « peut-être »`, et un fichier SQL contenant exactement deux `UPDATE public.clubs … AND geo_confidence = 'city';` entre `BEGIN;` et `COMMIT;`.

- [ ] **Step 3 : supprimer les fichiers d'essai**

Run: `rm "<dossier temporaire>/clubs_essai.xlsx" "<dossier temporaire>/clubs_essai.sql"`

---

### Task 4 : validation par l'utilisateur et import

**Files:**
- Produit : `supabase/migrations/clubs_geo_precise.sql` (non versionné)

- [ ] **Step 1 : remettre le fichier de vérification à l'utilisateur**

Lui indiquer le chemin `<Bureau>\clubs_verification.xlsx`, le résumé des comptes (tâche 2, étape 4) et la feuille « Mode d'emploi ». Attendre qu'il ait rempli la colonne « Décision ».

- [ ] **Step 2 : produire la migration**

Run: `node scripts/clubs-geo/migration-clubs.mjs "<Bureau>/clubs_verification.xlsx" "supabase/migrations/clubs_geo_precise.sql"`
Expected: le résumé `Retenus / sans décision / refusés`. S'il y a des refus, les montrer à l'utilisateur, le laisser corriger le fichier, relancer.

- [ ] **Step 3 : faire appliquer la migration, puis vérifier**

L'utilisateur applique `supabase/migrations/clubs_geo_precise.sql`. Vérification en lecture :

```bash
node --input-type=module -e "const {lireClubsBase}=await import('./scripts/clubs-geo/base.mjs');const c=await lireClubsBase();const n={};for(const x of c)n[x.geo_confidence]=(n[x.geo_confidence]??0)+1;console.log(n)"
```
Expected: `exact` = 28 + le nombre de clubs retenus ; `city` = 80 − ce nombre.

- [ ] **Step 4 : contrôle visuel sur un club**

Dans l'app, ouvrir la fiche d'une partie dans un club corrigé et toucher « Ouvrir dans Maps » : l'épingle doit être sur le club, et non plus au centre de la ville (`lib/maps.ts` n'utilise que les coordonnées `exact`).

---

## Auto-relecture (faite)

- **Couverture de la spec, lot 0** : génération du fichier de vérification (tâche 2), décision `oui` / `non` / lien (tâches 1 et 3), extraction et contrôle des liens (tâches 1 et 3), migration des seules lignes validées avec source notée (tâches 1 et 3), clubs non validés laissés en `city` (clause `WHERE` + lignes vides ignorées). « Hors lot : ajouter les clubs absents de la base » : non traité, conforme.
- **Espaces réservés** : aucun ; chaque étape de code contient le code complet.
- **Cohérence des noms** : `normaliserVille`, `proposerCorrespondance`, `lireDecision`, `requeteMiseAJour`, `lireClubsBase` sont identiques dans les interfaces, le code et les tests. La tâche 2 utilise `normaliserVille` de la tâche 1 plutôt que de recopier la normalisation.
