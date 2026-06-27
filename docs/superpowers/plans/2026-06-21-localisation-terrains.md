# Localisation des terrains — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre d'ouvrir le terrain d'une partie dans une appli de cartes avec un repère GPS précis, depuis le détail de la partie.

**Architecture:** On ajoute des colonnes lat/lng aux `clubs` (Supabase), on les géocode une fois via un script Nominatim, puis un helper `lib/maps.ts` résout les coords d'un club (cache client mémoïsé) et construit une URL Google Maps universelle ouverte avec `Linking`. La ligne « lieu » du `GameDetailsSheet` devient tappable.

**Tech Stack:** React Native / Expo, TypeScript, Supabase (Postgres), `Linking` (react-native), Nominatim/OSM (script Node one-time).

## Global Constraints

- **Pas de harness de test dans ce repo** (ni jest ni vitest). Vérification = `npx tsc --noEmit` (zéro nouvelle erreur) + vérif manuelle. Ne PAS introduire de framework de test pour cette feature.
- **Aucune dépendance native ajoutée** : utiliser `Linking` de `react-native` (déjà utilisé pour le calendrier).
- **Travailler sur `main`, sans commit auto** sauf demande explicite de l'utilisateur. Les étapes « Commit » ci-dessous sont OPTIONNELLES — ne les exécuter que si l'utilisateur le demande. Privilégier des changements additifs/réversibles.
- **Migrations non auto-appliquées** : les fichiers SQL sont écrits dans `supabase/migrations/` ; l'utilisateur les applique lui-même en prod. Ne PAS tenter de les pousser.
- Import supabase dans `lib/` : `import { supabase } from './supabase';`
- Géocodage Nominatim : **≤ 1 req/s** + en-tête `User-Agent: PagMatch/1.0 (jeffalkhalid@gmail.com)`.

---

### Task 1: Migration — colonnes géo sur `clubs`

**Files:**
- Create: `supabase/migrations/clubs_geo_columns.sql`

**Interfaces:**
- Produces: colonnes `clubs.latitude` (double precision), `clubs.longitude` (double precision), `clubs.geo_source` (text), `clubs.geo_confidence` (text). Toutes nullable.

- [ ] **Step 1: Écrire la migration**

```sql
-- Localisation des terrains : coordonnées GPS des clubs (additif, nullable).
ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS latitude       double precision;
ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS longitude      double precision;
ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS geo_source     text;  -- 'osm' | 'manual' | 'city'
ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS geo_confidence text;  -- 'exact' | 'city' | 'none'
```

- [ ] **Step 2: Vérifier la syntaxe**

Relire le fichier : 4 `ADD COLUMN IF NOT EXISTS`, types corrects, idempotent. Pas d'exécution ici (l'utilisateur applique).

- [ ] **Step 3 (optionnel — seulement si demandé): Commit**

```bash
git add supabase/migrations/clubs_geo_columns.sql
git commit -m "feat(clubs): colonnes géo (lat/lng) pour la localisation des terrains"
```

---

### Task 2: Script de géocodage Nominatim (one-time)

**Files:**
- Create: `scripts/geocode-clubs.mjs`

**Interfaces:**
- Consumes: variables d'env `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (lecture seule des clubs).
- Produces: fichier `supabase/migrations/update_clubs_geo.sql` (suite d'`UPDATE public.clubs SET latitude=…, longitude=…, geo_source=…, geo_confidence=… WHERE ext_id='…';`). Affiche en fin de run la liste des clubs en `'city'`/`'none'` (à corriger à la main).

**Notes d'implémentation :**
- Node ≥ 18 (fetch global dispo). Lancement : `node scripts/geocode-clubs.mjs`.
- Lit les clubs sans coords : `select id, ext_id, name, city, latitude from clubs`.
- Pour chaque club sans `latitude` : requête Nominatim `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ma&q=<name>, <city>, Maroc`.
  - Si résultat → `geo_confidence='exact'`, `geo_source='osm'`.
  - Sinon repli `q=<city>, Maroc` → `geo_confidence='city'`, `geo_source='city'`.
  - Sinon → ligne loggée, `geo_confidence='none'`, pas d'UPDATE coords (laisse NULL).
- **Throttle 1100 ms entre requêtes** + header User-Agent obligatoire.
- N'exécute AUCUN write Supabase : génère seulement le `.sql`.

- [ ] **Step 1: Écrire le script**

```js
// scripts/geocode-clubs.mjs
// Géocode les clubs (name + city) via Nominatim/OSM et génère un .sql d'UPDATE.
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/geocode-clubs.mjs
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY requis'); process.exit(1); }

const supabase = createClient(URL, KEY);
const UA = 'PagMatch/1.0 (jeffalkhalid@gmail.com)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/'/g, "''");

async function geocode(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ma&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  const arr = await res.json();
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return { lat: parseFloat(arr[0].lat), lng: parseFloat(arr[0].lon) };
}

const { data: clubs, error } = await supabase
  .from('clubs')
  .select('id, ext_id, name, city, latitude')
  .is('latitude', null);
if (error) { console.error(error); process.exit(1); }

const lines = [];
const lowConfidence = [];
for (const c of clubs) {
  let hit = null, source = null, confidence = null;
  if (c.name) { hit = await geocode(`${c.name}, ${c.city ?? ''}, Maroc`); await sleep(1100); }
  if (hit) { source = 'osm'; confidence = 'exact'; }
  else if (c.city) {
    hit = await geocode(`${c.city}, Maroc`); await sleep(1100);
    if (hit) { source = 'city'; confidence = 'city'; }
  }
  if (hit) {
    lines.push(
      `UPDATE public.clubs SET latitude=${hit.lat}, longitude=${hit.lng}, ` +
      `geo_source='${source}', geo_confidence='${confidence}' WHERE ext_id='${esc(c.ext_id)}';`
    );
    if (confidence !== 'exact') lowConfidence.push(`${c.ext_id} — ${c.name} (${confidence})`);
  } else {
    lines.push(`-- AUCUN résultat: ${esc(c.ext_id)} — ${esc(c.name)} (geo_confidence='none')`);
    lowConfidence.push(`${c.ext_id} — ${c.name} (none)`);
  }
  console.log(`${c.ext_id} ${c.name} → ${confidence ?? 'none'}`);
}

const header = '-- Généré par scripts/geocode-clubs.mjs (Nominatim/OSM). Vérifier les lignes city/none.\n';
writeFileSync('supabase/migrations/update_clubs_geo.sql', header + lines.join('\n') + '\n');
console.log(`\n${lines.length} clubs traités. À corriger à la main:\n` + lowConfidence.join('\n'));
```

- [ ] **Step 2: Lancer le script (réseau requis)**

Run: `SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/geocode-clubs.mjs`
Expected: log par club + fichier `supabase/migrations/update_clubs_geo.sql` créé + liste finale des clubs `city`/`none`.

> Si pas d'accès réseau/clé au moment de l'implémentation : s'arrêter après Step 1 (script écrit, prêt à lancer) et le signaler. Ne pas inventer de coords.

- [ ] **Step 3: Inspecter le `.sql` généré**

Vérifier quelques `UPDATE` à la main (lat ∈ ~[21,36], lng ∈ ~[-17,-1] pour le Maroc). Corriger/compléter les lignes `city`/`none` depuis Google Maps si souhaité (`geo_source='manual'`).

- [ ] **Step 4 (optionnel — seulement si demandé): Commit**

```bash
git add scripts/geocode-clubs.mjs supabase/migrations/update_clubs_geo.sql
git commit -m "feat(clubs): script de géocodage Nominatim + coords générées"
```

---

### Task 3: Helper `lib/maps.ts` (résolution coords + ouverture Maps)

**Files:**
- Create: `lib/maps.ts`

**Interfaces:**
- Consumes: `supabase` (`./supabase`), `Linking` (`react-native`), colonnes `clubs.name/latitude/longitude` (Task 1).
- Produces:
  - `openInMaps(location: string | null | undefined): Promise<void>` — ouvre Maps sur le club (repère GPS si connu, sinon recherche texte). No-op si `location` vide.
  - `hasMapTarget(location: string | null | undefined): boolean` — vrai si une ouverture est possible (location non vide) ; sert à l'UI pour décider si la ligne est cliquable.

**Notes d'implémentation :**
- Cache mémoïsé `Map<nomNormalisé, {lat,lng}>` chargé une seule fois (`select name, latitude, longitude from clubs where latitude is not null`). Normalisation = `trim().toLowerCase()`.
- URL : `https://www.google.com/maps/search/?api=1&query=<lat>,<lng>` si coords ; sinon `…&query=<encodeURIComponent(location + ', Maroc')>`.

- [ ] **Step 1: Écrire le helper**

```ts
// lib/maps.ts — ouverture du terrain d'une partie dans une appli de cartes.
import { Linking } from 'react-native';
import { supabase } from './supabase';

type Coords = { lat: number; lng: number };
let clubCache: Map<string, Coords> | null = null;
let loading: Promise<Map<string, Coords>> | null = null;

const norm = (s: string) => s.trim().toLowerCase();

async function loadClubCoords(): Promise<Map<string, Coords>> {
  if (clubCache) return clubCache;
  if (!loading) {
    loading = (async () => {
      const map = new Map<string, Coords>();
      const { data } = await supabase
        .from('clubs')
        .select('name, latitude, longitude')
        .not('latitude', 'is', null);
      for (const c of data ?? []) {
        if (c.name && c.latitude != null && c.longitude != null) {
          map.set(norm(c.name), { lat: c.latitude as number, lng: c.longitude as number });
        }
      }
      clubCache = map;
      return map;
    })();
  }
  return loading;
}

export function hasMapTarget(location: string | null | undefined): boolean {
  return !!location && location.trim().length > 0;
}

export async function openInMaps(location: string | null | undefined): Promise<void> {
  if (!hasMapTarget(location)) return;
  const loc = (location as string).trim();
  const cache = await loadClubCoords();
  const coords = cache.get(norm(loc));
  const query = coords ? `${coords.lat},${coords.lng}` : `${loc}, Maroc`;
  const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  await Linking.openURL(url).catch(() => {});
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: aucune nouvelle erreur liée à `lib/maps.ts`.

- [ ] **Step 3 (optionnel — seulement si demandé): Commit**

```bash
git add lib/maps.ts
git commit -m "feat(maps): helper openInMaps (coords club + repli recherche texte)"
```

---

### Task 4: Rendre la ligne « lieu » du détail tappable

**Files:**
- Modify: `app/(tabs)/GameDetailsSheet.tsx` (ligne lieu ~517-531, + imports)

**Interfaces:**
- Consumes: `openInMaps`, `hasMapTarget` (Task 3) ; `game.location`.

**Notes d'implémentation :**
- Importer `openInMaps, hasMapTarget` depuis `../../lib/maps` (vérifier la profondeur relative depuis `app/(tabs)/`).
- Envelopper le bloc « Location + gender » existant (le `<View>` ligne ~518) dans un `TouchableOpacity` qui appelle `openInMaps(game.location)` quand `hasMapTarget(game.location)`, sinon rendu non cliquable (`disabled`).
- Ajouter une affordance discrète à droite du nom : libellé « Itinéraire » en petit (réutiliser `Colors.textMuted`, `Fonts.uiBold`), visible uniquement si `hasMapTarget`.
- Ne PAS déplacer le badge genre existant ; il reste dans la ligne.

- [ ] **Step 1: Ajouter l'import**

En haut de `GameDetailsSheet.tsx`, à côté des autres imports `../../lib/...` :

```ts
import { openInMaps, hasMapTarget } from '../../lib/maps';
```

- [ ] **Step 2: Rendre la ligne lieu cliquable**

Remplacer le `<View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>` ouvrant le bloc « Location + gender » (~ligne 518) et sa fermeture `</View>` correspondante par un `TouchableOpacity` :

```tsx
{/* Location + gender — tappable → Maps */}
<TouchableOpacity
  activeOpacity={0.7}
  disabled={!hasMapTarget(game.location)}
  onPress={() => openInMaps(game.location)}
  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}
>
  <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
    <Path stroke={Colors.textMuted} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" d="M20 10c0 7-8 13-8 13S4 17 4 10a8 8 0 0 1 16 0Z" />
    <Circle cx={12} cy={10} r={3} stroke={Colors.textMuted} strokeWidth={2.2} />
  </Svg>
  <Text style={{ fontSize: 13, fontFamily: Fonts.uiBold, fontWeight: '700', color: Colors.border, flex: 1 }} numberOfLines={1}>{game.location}</Text>
  {hasMapTarget(game.location) && (
    <Text style={{ fontSize: 11, fontFamily: Fonts.uiBold, fontWeight: '700', color: Colors.textMuted }}>Itinéraire ›</Text>
  )}
  {(game as any).gender_pref && (
    <View style={{ backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
      <Text style={{ color: 'rgba(255,255,255,0.8)', fontFamily: Fonts.uiBlack, fontSize: 10, fontWeight: '900' }}>
        {(game as any).gender_pref === 'men' ? '♂ Hommes' : (game as any).gender_pref === 'women' ? '♀ Femmes' : '⚧ Mixte'}
      </Text>
    </View>
  )}
</TouchableOpacity>
```

> Vérifier que `TouchableOpacity` est déjà importé depuis `react-native` dans ce fichier (c'est le cas pour les autres actions). Sinon l'ajouter à l'import existant.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: aucune nouvelle erreur.

- [ ] **Step 4: Vérif manuelle (device/Expo)**

Ouvrir le détail d'une partie dont le club est géocodé → taper le lieu → Google Maps s'ouvre centré sur le club. Tester aussi un `location` en texte libre → recherche texte « <texte>, Maroc ». Lieu vide → ligne non cliquable, pas de « Itinéraire ».

- [ ] **Step 5 (optionnel — seulement si demandé): Commit**

```bash
git add "app/(tabs)/GameDetailsSheet.tsx"
git commit -m "feat(game): lieu tappable → ouvre l'itinéraire dans Maps"
```

---

## Self-Review

**Spec coverage :**
- Modèle de données (lat/lng + geo_source/confidence) → Task 1 ✓
- Script de géocodage Nominatim → Task 2 ✓
- Helper `openInMaps` + repli texte → Task 3 ✓
- UI ligne lieu tappable + affordance → Task 4 ✓
- Repli/cas limites (location vide, non géocodé, texte libre) → Task 3 (`hasMapTarget`, repli texte) + Task 4 (disabled) ✓
- Hors scope (carte, près de moi) → non planifié, correct ✓

**Placeholder scan :** aucun TBD/TODO ; code complet à chaque étape. La résolution coords laissée « au plan » dans la spec est tranchée ici (cache client mémoïsé, Task 3).

**Type consistency :** `openInMaps(location)` / `hasMapTarget(location)` mêmes signatures en Task 3 (définition) et Task 4 (usage). Colonnes `latitude/longitude/geo_source/geo_confidence` cohérentes Task 1 → 2 → 3.

**Note d'adaptation :** pas de TDD (aucun harness de test dans le repo). Vérification = `npx tsc --noEmit` + vérif device, conforme à la pratique du projet.
