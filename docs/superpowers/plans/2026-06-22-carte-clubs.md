# Carte interactive des clubs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une carte plein écran (ouverte depuis l'étape « Terrain » du wizard) pour choisir un club visuellement, avec un badge « parties ouvertes », sans clé API ni rebuild natif.

**Architecture:** Écran `app/clubs-map.tsx` rendant un `<WebView>` dont le HTML embarque Leaflet (vendoré en asset local) + tuiles OpenStreetMap ; les clubs (agrégés par position) et leurs comptes de parties sont injectés en JSON dans le HTML. Le tap d'un marqueur `postMessage` vers RN, qui affiche une fiche/liste et renvoie le club choisi au wizard via un module mémoire `lib/venuePicker.ts`.

**Tech Stack:** React Native / Expo, TypeScript, expo-router, `react-native-webview` (déjà installé, 13.15.0), Leaflet 1.9.4 (vendoré local), tuiles OpenStreetMap, Supabase.

## Global Constraints

- **Pas de harness de test** dans ce repo (ni jest ni vitest). Vérification = `npx tsc --noEmit` (zéro NOUVELLE erreur ; le projet a des erreurs préexistantes sans rapport) + `node --check` pour les scripts + vérif device. Ne PAS introduire de framework de test.
- **Aucune nouvelle dépendance native, aucun rebuild** : utiliser `react-native-webview` (déjà présent). Pas de `react-native-maps`, pas de clé Google.
- **Leaflet en LOCAL** (vendoré), pas de CDN. Seules les tuiles OSM sont en réseau.
- **Marqueurs via `L.divIcon`** (HTML/CSS custom), JAMAIS `L.marker` par défaut (ses icônes PNG relatives seraient cassées en HTML inliné).
- **Places libres / « partie ouverte »** : dérivées des participants via `freeSpots()` de `lib/games.ts`, JAMAIS de la colonne `spots_available`.
- **Travailler sur `main`, sans commit auto** sauf demande explicite. Étapes « Commit » OPTIONNELLES (ne les faire que si l'utilisateur le demande). Changements additifs/réversibles ; ne pas toucher au travail non commité existant.
- Pattern WebView de référence (à suivre) : `components/TurnstileCaptcha.tsx` — `<WebView source={{ html, baseUrl: 'https://localhost' }} originWhitelist={['*']} javaScriptEnabled onMessage={...} />` et `window.ReactNativeWebView.postMessage(String(...))`.
- Import supabase : `import { supabase } from './supabase';` (depuis `lib/`).

---

### Task 1: Module mémoire de sélection — `lib/venuePicker.ts`

**Files:**
- Create: `lib/venuePicker.ts`

**Interfaces:**
- Produces :
  - `setPickedVenue(name: string): void`
  - `consumePickedVenue(): string | null` — renvoie la valeur puis l'efface (one-shot).

- [ ] **Step 1: Écrire le module**

```ts
// lib/venuePicker.ts — passe le club choisi sur la carte au CreateWizard,
// sans param de navigation (router.back() ne porte pas de valeur) et sans
// remonter le wizard (son state de formulaire est préservé).
let pendingVenue: string | null = null;

export function setPickedVenue(name: string): void {
  pendingVenue = name;
}

/** Lit la sélection en attente puis l'efface (consommation one-shot). */
export function consumePickedVenue(): string | null {
  const v = pendingVenue;
  pendingVenue = null;
  return v;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -i "venuePicker" || echo "no venuePicker errors"`
Expected: `no venuePicker errors`

- [ ] **Step 3 (optionnel — seulement si demandé): Commit**

```bash
git add lib/venuePicker.ts
git commit -m "feat(maps): module venuePicker (sélection club carte → wizard)"
```

---

### Task 2: Vendorer Leaflet en asset local — `assets/leaflet/leaflet.bundle.ts`

But : produire un module TS exportant le JS et le CSS de Leaflet 1.9.4 comme chaînes (encodées via `JSON.stringify`, donc échappement sûr), pour les inliner dans le HTML de la WebView sans CDN.

**Files:**
- Create: `scripts/vendor-leaflet.mjs` (script de génération, one-time, réutilisable)
- Create: `assets/leaflet/leaflet.bundle.ts` (généré par le script)

**Interfaces:**
- Produces : `export const LEAFLET_JS: string` et `export const LEAFLET_CSS: string` dans `assets/leaflet/leaflet.bundle.ts`.

- [ ] **Step 1: Écrire le script de vendoring**

```js
// scripts/vendor-leaflet.mjs
// Télécharge Leaflet 1.9.4 (JS + CSS) et écrit assets/leaflet/leaflet.bundle.ts
// avec les contenus encodés en chaînes TS sûres (JSON.stringify).
// Usage: node scripts/vendor-leaflet.mjs
import { writeFileSync, mkdirSync } from 'node:fs';

const JS_URL  = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
const CSS_URL = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) { throw new Error(`${url} → HTTP ${res.status}`); }
  return res.text();
}

const js  = await get(JS_URL);
const css = await get(CSS_URL);

mkdirSync('assets/leaflet', { recursive: true });
const out =
  '// Généré par scripts/vendor-leaflet.mjs — Leaflet 1.9.4 (NE PAS éditer à la main).\n' +
  `export const LEAFLET_JS = ${JSON.stringify(js)};\n` +
  `export const LEAFLET_CSS = ${JSON.stringify(css)};\n`;
writeFileSync('assets/leaflet/leaflet.bundle.ts', out);
console.log(`OK — leaflet.bundle.ts écrit (js ${js.length} o, css ${css.length} o)`);
```

- [ ] **Step 2: Vérifier la syntaxe du script**

Run: `node --check scripts/vendor-leaflet.mjs`
Expected: aucune sortie (OK).

- [ ] **Step 3: Lancer le vendoring (réseau requis)**

Run: `node scripts/vendor-leaflet.mjs`
Expected: `OK — leaflet.bundle.ts écrit (js ~147000 o, css ~14000 o)` et le fichier `assets/leaflet/leaflet.bundle.ts` existe.

> Si pas de réseau : s'arrêter après Step 2 (script prêt) et reporter BLOCKED avec la raison. Ne PAS écrire un faux bundle.

- [ ] **Step 4: Vérifier l'export**

Run: `node --input-type=module -e "import('./assets/leaflet/leaflet.bundle.ts').catch(()=>{}); import('node:fs').then(fs=>{const t=fs.readFileSync('assets/leaflet/leaflet.bundle.ts','utf8'); console.log(/export const LEAFLET_JS = \"/.test(t) && /export const LEAFLET_CSS = \"/.test(t) ? 'exports OK' : 'exports MANQUANTS');})"`
Expected: `exports OK`

- [ ] **Step 5 (optionnel — seulement si demandé): Commit**

```bash
git add scripts/vendor-leaflet.mjs assets/leaflet/leaflet.bundle.ts
git commit -m "chore(maps): vendor Leaflet 1.9.4 en asset local"
```

---

### Task 3: Constructeur de HTML carte — `lib/clubsMapHtml.ts`

**Files:**
- Create: `lib/clubsMapHtml.ts`

**Interfaces:**
- Consumes : `LEAFLET_JS`, `LEAFLET_CSS` (Task 2) ; le type `ClubMarker` (défini ici, réutilisé par Task 4).
- Produces :
  - `export type ClubMarker = { lat: number; lng: number; clubs: { name: string; partiesCount: number }[]; partiesCount: number }`
  - `export function buildClubsMapHtml(markers: ClubMarker[]): string`

Détails :
- Inline `LEAFLET_CSS` dans un `<style>` et `LEAFLET_JS` dans un `<script>`.
- Marqueurs en `L.divIcon` : pastille ronde ; si `clubs.length > 1`, afficher le nombre de clubs ; si `partiesCount > 0`, un petit point/badge « parties ».
- Au clic d'un marqueur : `window.ReactNativeWebView.postMessage(JSON.stringify({ type:'marker', index }))` où `index` est l'indice du marqueur dans le tableau (RN retrouve les clubs via son propre tableau — évite de repasser tout le payload).
- `map.fitBounds` sur tous les marqueurs ; si un seul, `setView` zoom 13.
- Données injectées via `JSON.stringify(markers)` (sûr).

- [ ] **Step 1: Écrire le constructeur**

```ts
// lib/clubsMapHtml.ts — génère le HTML Leaflet (asset local) pour la carte des clubs.
import { LEAFLET_JS, LEAFLET_CSS } from '../assets/leaflet/leaflet.bundle';

export type ClubMarker = {
  lat: number;
  lng: number;
  clubs: { name: string; partiesCount: number }[];
  partiesCount: number; // somme des parties ouvertes des clubs de cette position
};

export function buildClubsMapHtml(markers: ClubMarker[]): string {
  const data = JSON.stringify(markers);
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <style>${LEAFLET_CSS}
    html,body,#map{margin:0;padding:0;height:100%;width:100%;background:#e9eef2}
    .pin{display:flex;align-items:center;justify-content:center;width:30px;height:30px;
      border-radius:50% 50% 50% 0;background:#1f6feb;transform:rotate(-45deg);
      border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)}
    .pin b{transform:rotate(45deg);color:#fff;font:700 12px system-ui}
    .pin.multi{background:#0b3d91}
    .games{position:absolute;top:-4px;right:-4px;min-width:14px;height:14px;border-radius:7px;
      background:#22c55e;border:1.5px solid #fff;color:#fff;font:700 9px system-ui;
      display:flex;align-items:center;justify-content:center;padding:0 2px}
  </style>
</head>
<body>
  <div id="map"></div>
  <script>${LEAFLET_JS}</script>
  <script>
    var MARKERS = ${data};
    function post(o){ if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(o)); }
    var map = L.map('map', { zoomControl: true, attributionControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap'
    }).addTo(map);
    var pts = [];
    MARKERS.forEach(function(m, i){
      var multi = m.clubs.length > 1;
      var games = m.partiesCount > 0
        ? '<span class="games">' + m.partiesCount + '</span>' : '';
      var html = '<div style="position:relative">'
        + '<div class="pin' + (multi ? ' multi' : '') + '"><b>' + (multi ? m.clubs.length : '') + '</b></div>'
        + games + '</div>';
      var icon = L.divIcon({ html: html, className: '', iconSize: [30,30], iconAnchor: [15,30] });
      L.marker([m.lat, m.lng], { icon: icon })
        .on('click', function(){ post({ type:'marker', index: i }); })
        .addTo(map);
      pts.push([m.lat, m.lng]);
    });
    if (pts.length === 1) map.setView(pts[0], 13);
    else if (pts.length > 1) map.fitBounds(pts, { padding: [40,40] });
    else map.setView([31.7, -7.1], 5); // Maroc par défaut
  </script>
</body>
</html>`;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -iE "clubsMapHtml|leaflet.bundle" || echo "no html-builder errors"`
Expected: `no html-builder errors`

- [ ] **Step 3 (optionnel — seulement si demandé): Commit**

```bash
git add lib/clubsMapHtml.ts
git commit -m "feat(maps): constructeur HTML Leaflet pour la carte des clubs"
```

---

### Task 4: Chargement + agrégation des données — `lib/clubsMap.ts`

**Files:**
- Create: `lib/clubsMap.ts`

**Interfaces:**
- Consumes : `supabase` ; `freeSpots` de `./games` ; le type `ClubMarker` de `./clubsMapHtml`.
- Produces :
  - `export async function loadClubMarkers(): Promise<ClubMarker[]>` — clubs avec coords, agrégés par position `lat,lng`, chacun portant le compte de parties ouvertes à venir et joignables.

Détails :
- Clubs : `supabase.from('clubs').select('name, latitude, longitude').not('latitude','is',null)`.
- Parties : `supabase.from('open_games').select('location, match_date, status, spots_available, creator_id, participants:game_participants(player_id, status, invite_expires_at)').neq('status','cancelled')`.
  - Garder celles à venir (`match_date` ≥ maintenant) ET `freeSpots(g) > 0`.
  - Compter par `location` normalisé (`trim().toLowerCase()`).
- Agréger les clubs par clé `"lat,lng"` ; `partiesCount` du marqueur = somme des comptes de ses clubs.

- [ ] **Step 1: Écrire le loader**

```ts
// lib/clubsMap.ts — charge les clubs géolocalisés, les agrège par position
// et y attache le nombre de parties ouvertes (à venir + joignables) par club.
import { supabase } from './supabase';
import { freeSpots } from './games';
import type { ClubMarker } from './clubsMapHtml';

const norm = (s: string) => s.trim().toLowerCase();

export async function loadClubMarkers(): Promise<ClubMarker[]> {
  // 1) Parties ouvertes par club (nom normalisé → compte)
  const nowIso = new Date().toISOString();
  const { data: games } = await supabase
    .from('open_games')
    .select('location, match_date, status, spots_available, creator_id, participants:game_participants(player_id, status, invite_expires_at)')
    .neq('status', 'cancelled');

  const partiesByClub = new Map<string, number>();
  for (const g of games ?? []) {
    if (!g.location) continue;
    if (!g.match_date || g.match_date < nowIso) continue;
    if (freeSpots(g as any) <= 0) continue;
    const k = norm(g.location);
    partiesByClub.set(k, (partiesByClub.get(k) ?? 0) + 1);
  }

  // 2) Clubs géolocalisés, agrégés par position
  const { data: clubs } = await supabase
    .from('clubs')
    .select('name, latitude, longitude')
    .not('latitude', 'is', null);

  const byPos = new Map<string, ClubMarker>();
  for (const c of clubs ?? []) {
    if (c.latitude == null || c.longitude == null || !c.name) continue;
    const key = `${c.latitude},${c.longitude}`;
    const parties = partiesByClub.get(norm(c.name)) ?? 0;
    let m = byPos.get(key);
    if (!m) {
      m = { lat: c.latitude as number, lng: c.longitude as number, clubs: [], partiesCount: 0 };
      byPos.set(key, m);
    }
    m.clubs.push({ name: c.name as string, partiesCount: parties });
    m.partiesCount += parties;
  }
  return Array.from(byPos.values());
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -i "clubsMap.ts" || echo "no clubsMap errors"`
Expected: `no clubsMap errors`

- [ ] **Step 3 (optionnel — seulement si demandé): Commit**

```bash
git add lib/clubsMap.ts
git commit -m "feat(maps): loader clubs agrégés + comptes parties ouvertes"
```

---

### Task 5: Écran carte — `app/clubs-map.tsx`

**Files:**
- Create: `app/clubs-map.tsx`

**Interfaces:**
- Consumes : `loadClubMarkers` (Task 4) ; `buildClubsMapHtml`, `ClubMarker` (Task 3) ; `setPickedVenue` (Task 1) ; `openInMaps` de `../lib/maps` ; `useRouter` d'expo-router ; `WebView` de `react-native-webview`.

Détails comportementaux :
- États : `loading`, `error`, `markers: ClubMarker[]`, `sheet: { kind:'club'|'list'; marker: ClubMarker } | null`.
- Au montage : `loadClubMarkers()` → `markers`. Sur erreur ou tableau vide après erreur → `error`.
- `WebView source={{ html: buildClubsMapHtml(markers), baseUrl:'https://localhost' }}` (rendu seulement quand `markers` chargés), `originWhitelist={['*']}`, `javaScriptEnabled`, `onMessage` + `onError` → `error`.
- `onMessage` : parse `{type:'marker', index}` → `m = markers[index]` → si `m.clubs.length === 1` ouvrir sheet `club`, sinon sheet `list`.
- Sheet `list` : liste des `m.clubs` (nom + « N parties » si >0), tap → bascule en sheet `club` sur ce club.
- Sheet `club` : nom, « N parties ouvertes » si >0, bouton **« Choisir ce club »** → `setPickedVenue(name); router.back();` ; bouton **« Ouvrir dans Maps »** → `openInMaps(name)`.
- `error` : message « Carte indisponible — vérifie ta connexion » + bouton « Réessayer » (relance `loadClubMarkers`).
- En-tête simple avec bouton retour (`router.back()`).

- [ ] **Step 1: Écrire l'écran**

```tsx
// app/clubs-map.tsx — carte plein écran des clubs (WebView + Leaflet local).
import { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { loadClubMarkers } from '../lib/clubsMap';
import { buildClubsMapHtml, type ClubMarker } from '../lib/clubsMapHtml';
import { setPickedVenue } from '../lib/venuePicker';
import { openInMaps } from '../lib/maps';

type Sheet = { kind: 'club'; club: { name: string; partiesCount: number } }
           | { kind: 'list'; marker: ClubMarker };

export default function ClubsMapScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [markers, setMarkers] = useState<ClubMarker[]>([]);
  const [sheet, setSheet] = useState<Sheet | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try { setMarkers(await loadClubMarkers()); }
    catch { setError(true); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === 'marker') {
        const m = markers[msg.index];
        if (!m) return;
        if (m.clubs.length === 1) setSheet({ kind: 'club', club: m.clubs[0] });
        else setSheet({ kind: 'list', marker: m });
      }
    } catch { /* ignore */ }
  }, [markers]);

  const choose = (name: string) => { setPickedVenue(name); router.back(); };

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 }}>
        <TouchableOpacity onPress={() => router.back()}><Text style={{ fontSize: 16 }}>‹ Retour</Text></TouchableOpacity>
        <Text style={{ fontSize: 16, fontWeight: '800' }}>Clubs sur la carte</Text>
      </View>

      {loading && <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></View>}

      {!loading && error && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 }}>
          <Text style={{ textAlign: 'center', color: '#444' }}>Carte indisponible — vérifie ta connexion.</Text>
          <TouchableOpacity onPress={load} style={{ paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#1f6feb', borderRadius: 10 }}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>Réessayer</Text>
          </TouchableOpacity>
        </View>
      )}

      {!loading && !error && (
        <WebView
          source={{ html: buildClubsMapHtml(markers), baseUrl: 'https://localhost' }}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          onMessage={onMessage}
          onError={() => setError(true)}
          style={{ flex: 1 }}
        />
      )}

      {sheet && (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#fff',
          borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, gap: 10,
          shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, elevation: 12, maxHeight: '60%' }}>
          <TouchableOpacity onPress={() => setSheet(null)} style={{ alignSelf: 'flex-end' }}><Text>Fermer ✕</Text></TouchableOpacity>

          {sheet.kind === 'list' && (
            <ScrollView>
              <Text style={{ fontWeight: '800', marginBottom: 6 }}>{sheet.marker.clubs.length} clubs ici</Text>
              {sheet.marker.clubs.map((c, i) => (
                <TouchableOpacity key={i} onPress={() => setSheet({ kind: 'club', club: c })}
                  style={{ paddingVertical: 12, borderBottomWidth: 1, borderColor: '#eee', flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontWeight: '600' }}>{c.name}</Text>
                  {c.partiesCount > 0 && <Text style={{ color: '#16a34a', fontWeight: '700' }}>{c.partiesCount} parties</Text>}
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {sheet.kind === 'club' && (
            <>
              <Text style={{ fontSize: 18, fontWeight: '800' }}>{sheet.club.name}</Text>
              {sheet.club.partiesCount > 0 && <Text style={{ color: '#16a34a', fontWeight: '700' }}>{sheet.club.partiesCount} parties ouvertes</Text>}
              <TouchableOpacity onPress={() => choose(sheet.club.name)}
                style={{ backgroundColor: '#1f6feb', borderRadius: 12, padding: 14, alignItems: 'center' }}>
                <Text style={{ color: '#fff', fontWeight: '800' }}>Choisir ce club</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => openInMaps(sheet.club.name)}
                style={{ borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: '#1f6feb' }}>
                <Text style={{ color: '#1f6feb', fontWeight: '700' }}>Ouvrir dans Maps</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}
    </View>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -i "clubs-map" || echo "no clubs-map errors"`
Expected: `no clubs-map errors`

- [ ] **Step 3 (optionnel — seulement si demandé): Commit**

```bash
git add app/clubs-map.tsx
git commit -m "feat(maps): écran carte des clubs (WebView Leaflet + fiche/liste + sélection)"
```

---

### Task 6: Entrée wizard + consommation de la sélection

**Files:**
- Modify: `app/(tabs)/CreateWizard.tsx` (étape « Terrain » ~ lignes 519-595 ; imports)

**Interfaces:**
- Consumes : `consumePickedVenue` (Task 1) ; `useFocusEffect` d'expo-router ; le setter de formulaire existant `set('location', …)` et `router` (déjà présents dans le fichier).

Détails :
- Ajouter un lien **« 🗺 Voir les clubs sur la carte »** sous le sélecteur de terrain (dans le bloc rendu autour de la ligne « Terrain »), qui fait `router.push('/clubs-map')`.
- Au focus de l'écran, consommer la sélection : `useFocusEffect(useCallback(() => { const v = consumePickedVenue(); if (v) set('location', v); }, []))`.

- [ ] **Step 1: Vérifier les imports présents**

Lire le haut de `app/(tabs)/CreateWizard.tsx`. Confirmer la présence de `useRouter`/`router` et de `useFocusEffect`/`useCallback` (depuis `expo-router` et `react`). S'ils manquent :
- ajouter `useFocusEffect` à l'import `expo-router` ;
- ajouter `useCallback` à l'import `react` ;
- si `router` n'existe pas, ajouter `const router = useRouter();` dans le composant.

- [ ] **Step 2: Ajouter l'import du module de sélection**

À côté des autres imports `../../lib/...` :
```ts
import { consumePickedVenue } from '../../lib/venuePicker';
```

- [ ] **Step 3: Consommer la sélection au focus**

Dans le composant du wizard (là où `set` / l'état du formulaire sont définis), ajouter :
```ts
useFocusEffect(
  useCallback(() => {
    const v = consumePickedVenue();
    if (v) set('location', v);
  }, []),
);
```
> `set('location', v)` est le setter de formulaire déjà utilisé partout dans ce fichier (ex. `set('location', club)` à la sélection d'un club). Réutiliser le même.

- [ ] **Step 4: Ajouter le lien vers la carte (étape Terrain)**

Repérer la fin du bloc de sélection de terrain (le composant qui rend « Terrain » / `Choisir un terrain… `, autour des lignes 519-595). Juste après ce bloc, ajouter :
```tsx
<TouchableOpacity onPress={() => router.push('/clubs-map')} style={{ alignSelf: 'flex-start', paddingVertical: 8 }}>
  <Text style={{ fontSize: 13, fontWeight: '700', color: t.selectColor ?? Colors.brandDeep }}>🗺 Voir les clubs sur la carte</Text>
</TouchableOpacity>
```
> `TouchableOpacity`, `Text`, `Colors` et le thème `t` sont déjà utilisés dans ce fichier. Si `t.selectColor` n'existe pas dans le scope du rendu, utiliser `Colors.brandDeep` seul.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -i "CreateWizard" || echo "no CreateWizard errors"`
Expected: `no CreateWizard errors`

- [ ] **Step 6: Vérif manuelle (device/Expo)**

Wizard → étape Terrain → « Voir les clubs sur la carte » → la carte du Maroc s'affiche (fond OSM) → taper un point partagé (ex. Marrakech) ouvre la liste → choisir un club → retour au wizard avec le **Terrain rempli** et le **reste du formulaire intact**. Un club avec parties ouvertes montre le badge. Mode avion → message de repli + « Réessayer ».

- [ ] **Step 7 (optionnel — seulement si demandé): Commit**

```bash
git add "app/(tabs)/CreateWizard.tsx"
git commit -m "feat(maps): entrée carte des clubs depuis le wizard + sélection terrain"
```

---

## Self-Review

**Spec coverage :**
- Écran carte WebView (§1) → Task 5 ✓
- Carte Leaflet local + tuiles OSM (§2) → Task 2 (vendoring) + Task 3 (HTML) ✓
- Données parties ouvertes par club via `freeSpots` (§3) → Task 4 ✓
- Interaction sélection : fiche / liste / « Choisir » / « Ouvrir dans Maps » (§4) → Task 5 ✓
- Retour sélection via `venuePicker` (§5) → Task 1 + Task 6 ✓
- Entrée wizard (§6) → Task 6 ✓
- Replis (réseau/erreur/annulation) (§Replis) → Task 5 (error + Réessayer), Task 6 (consume null = pas d'écrasement) ✓
- Empilement → marqueur agrégé + liste → Task 4 (agrégation par position) + Task 3 (divIcon compte) + Task 5 (sheet liste) ✓
- Hors scope (près de moi, entrée Accueil, fiche riche) → non planifié ✓

**Placeholder scan :** code complet à chaque étape ; pas de TBD. Les ajustements d'imports (Task 6) sont conditionnels mais explicites (quoi ajouter et où).

**Type consistency :** `ClubMarker` défini en Task 3, réutilisé Tasks 4 & 5. `buildClubsMapHtml(markers)` / `loadClubMarkers()` / `setPickedVenue`/`consumePickedVenue` cohérents entre définitions (Tasks 1-4) et usages (Tasks 5-6). `freeSpots` consommé avec la forme `{creator_id, spots_available?, participants?}` — le select de Task 4 fournit `creator_id`, `spots_available`, `participants`.

**Note d'adaptation :** pas de TDD (aucun harness). Vérification = `tsc` ciblé + `node --check` + vérif device, conforme à la pratique du projet.
