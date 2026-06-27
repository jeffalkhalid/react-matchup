# Carte interactive des clubs — Design (Phase 2 de la localisation)

Date : 2026-06-22
Projet : PAG MATCH (react-matchup, React Native / Expo + Supabase)
Statut : validé (brainstorming)
Suite de : `2026-06-21-localisation-terrains-design.md` (les coords clubs viennent de cette Phase 1).

## Contexte

- La table `clubs` a maintenant `latitude/longitude/geo_source/geo_confidence` peuplés
  en prod : **108/108 clubs avec coords** (28 `exact`, 80 `city`).
- Les coords s'empilent : 108 clubs → **57 positions distinctes** ; 12 positions
  portent plusieurs clubs (jusqu'à **13 au centroïde de Marrakech**) car les 80 `city`
  partagent les centroïdes de ville.
- `react-native-webview` **13.15.0 est déjà installé** (dépendance transitive).
- Le `CreateWizard` choisit le terrain dans une liste de noms de clubs
  (`app/(tabs)/CreateWizard.tsx`, état `form.location`).
- Helper existant `lib/maps.ts` : `openInMaps(location)`.

## Objectif

Une **carte plein écran** ouverte depuis l'étape « Terrain » du wizard, servant à
**choisir le club** visuellement, avec un **badge « N parties ouvertes »** sur les
clubs concernés. Choisir un club remplit le champ Terrain et revient au wizard.

Décisions de cadrage (validées) :
- **Techno : WebView + Leaflet + tuiles OpenStreetMap** — sans clé API, sans nouveau
  module natif, **sans rebuild** (webview déjà présent). Identique iOS/Android.
- **Leaflet embarqué en asset local** (pas de CDN) pour la fiabilité ; seules les
  tuiles restent en réseau.
- **Empilement → marqueur agrégé + liste** : 1 marqueur par position distincte ;
  badge de compte si N>1 clubs ; tap → liste si N>1, sinon fiche directe.
- **Carte = sélecteur de club + badge parties** (pas de fiche club riche).
- **Retour de sélection** au wizard via un module mémoire partagé (`lib/venuePicker.ts`).

## Composants

### 1. Écran carte — `app/clubs-map.tsx`

Route expo-router plein écran. Rend un `<WebView>` dont le HTML est généré côté RN
avec les marqueurs injectés en JSON. Au montage :
1. charge les clubs (`name, latitude, longitude, city, geo_confidence`) ;
2. charge le **compte de parties ouvertes par club** (cf. §3) ;
3. agrège par position → marqueurs ;
4. construit le HTML (Leaflet local + données) et le passe à la WebView.

État : `loading`, `error` (réseau/chargement), liste de marqueurs.

### 2. Carte WebView — HTML/Leaflet (asset local)

- Assets locaux : `assets/leaflet/leaflet.js` + `assets/leaflet/leaflet.css`
  (embarqués, lus et inlinés dans le HTML — pas de CDN).
- Tuiles : OpenStreetMap (`https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`),
  attribution OSM affichée (politique d'usage respectée ; volume PAG MATCH faible).
- Vue initiale : `fitBounds` sur l'ensemble des marqueurs (tout le Maroc).
- Marqueurs : un `L.marker`/`L.divIcon` par position. Si N>1 clubs → icône avec
  **pastille de compte**. Si le(s) club(s) ont des parties ouvertes → petit **badge
  « parties »** sur l'icône.
- Tap marqueur → `window.ReactNativeWebView.postMessage(JSON.stringify({ type:'marker',
  clubs:[{name, partiesCount, geo_confidence}], lat, lng }))`.

### 3. Données « parties ouvertes par club »

- Source : table `open_games`, champ `location` (= nom du club, texte).
- Définition d'une partie « ouverte » : `match_date` **à venir** ET partie encore
  **joignable** (places libres). Le décompte de places libres dérive des participants,
  PAS de `spots_available` (cf. dette connue `spots_available`) — réutiliser le helper
  de places libres de `lib/games.ts` plutôt que lire la colonne.
- Résultat : `Map<nomClubNormalisé, number>`. Le badge d'un marqueur = somme des
  comptes des clubs de cette position.
- Détail d'implémentation (requête exacte / helper réutilisé) tranché au plan.

### 4. Interaction de sélection

- RN reçoit le message `marker` via `onMessage`.
- **N = 1 club** → ouvre une **fiche compacte** (bottom sheet) : nom, ville,
  « N parties ouvertes » si >0, bouton **« Choisir ce club »** (primaire) et
  **« Ouvrir dans Maps »** (secondaire, réutilise `openInMaps`).
- **N > 1 clubs** → ouvre une **liste** des clubs de cette position (chacun avec son
  badge parties) → tap sur un club → même fiche compacte.
- « Choisir ce club » → écrit le nom dans `venuePicker` puis `router.back()`.

### 5. Retour de sélection — `lib/venuePicker.ts`

Petit module mémoire (singleton) :
```
setPickedVenue(name: string): void
consumePickedVenue(): string | null   // lit puis efface (one-shot)
```
- La carte appelle `setPickedVenue(name)` avant `router.back()`.
- Le `CreateWizard` lit via `useFocusEffect` : `const v = consumePickedVenue();
  if (v) set('location', v);`. Pas de remontage du wizard, son state de formulaire
  est préservé.

### 6. Entrée depuis le wizard

- À l'étape « Terrain » du `CreateWizard`, ajouter un lien
  **« 🗺 Voir les clubs sur la carte »** → `router.push('/clubs-map')`.
- Au retour, le `useFocusEffect` applique la sélection éventuelle.

## Replis & cas limites

- **Pas de réseau** (tuiles inaccessibles) : la WebView affiche peu/pas de fond de
  carte → écran de repli RN « Carte indisponible (vérifie ta connexion) » + bouton
  « Réessayer ». Leaflet local garantit que l'UI carte se charge même sans CDN.
- **Échec de chargement WebView** : `onError` → même écran de repli.
- **Sélection annulée** (retour sans choisir) : `consumePickedVenue()` renvoie `null`,
  le wizard garde son terrain actuel.
- **Clubs sans coords** : aucun aujourd'hui (108/108) — ignorés si jamais.
- **Position identique** des 80 `city` : gérée par l'agrégation (§ marqueur + liste).

## Hors scope

- Tri / filtre « près de moi » (géoloc utilisateur → autre phase, implications légales).
- Entrée carte depuis l'Accueil/Matchmaking (on garde l'entrée wizard seule).
- Fiche club riche / page profil de club (n'existe pas, non requis ici).
- Affinage manuel des 80 clubs `city` en `exact` (tâche data séparée, Phase 1).

## Critères de succès

- Depuis l'étape Terrain du wizard, « Voir sur la carte » ouvre une carte du Maroc
  avec les clubs ; la carte s'affiche **sans clé API** et **sans rebuild**.
- Un point partagé par plusieurs clubs montre un **compte** et ouvre la **liste**.
- Choisir un club **remplit le champ Terrain** et revient au wizard **sans perdre**
  le reste du formulaire.
- Un club avec des parties ouvertes montre un **badge** au bon compte.
- Hors-ligne → message de repli clair, pas de crash.
