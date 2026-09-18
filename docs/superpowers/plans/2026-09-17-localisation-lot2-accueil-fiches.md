# Localisation — Lot 2 (accueil + fiches) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire compter la proximité là où le joueur décide : dans les suggestions de l'accueil, sur la carte « Prochain match », et sur les fiches d'une partie et d'un tournoi.

**Architecture:** Tout part du lot 1, déjà livré : `lib/geo.ts` (pur) et le magasin partagé `hooks/useOrigin.ts` qui rend `distanceOf` et `origin`. Ce lot ajoute deux règles pures — un critère « proche » dans le classement de `lib/homeSlot.ts`, et une phrase d'affichage `distanceSentence` dans `lib/geo.ts` — puis les branche sur quatre écrans. Aucune nouvelle requête, aucune migration.

**Tech Stack:** React Native 0.86 / Expo SDK 57, TypeScript, vitest.

**Spec:** `docs/superpowers/specs/2026-09-17-localisation-design.md` (section 4 « Lot 2 », sections 5 à 7).

## Global Constraints

- `lib/homeSlot.ts` : critère « proche » inséré **après le niveau**. Proche = **distance ≤ rayon de la zone**, que la position du club soit exacte ou approximative (décision utilisateur 2026-09-18 : exiger une position exacte favorisait les 28 clubs vérifiés au détriment de parties réellement plus proches) (20 km par défaut sans zone). Distance fournie **en paramètre**. Sans point de départ, critère **ignoré** (ordre actuel inchangé).
- Ce sont des **priorités, pas des filtres** : une partie lointaine reste proposable s'il n'y a rien de mieux.
- Carte « Prochain match » : distance **à côté du club**.
- Fiche de partie et fiche de tournoi : « 4,2 km depuis ta position / ta zone », **à côté du bouton « Ouvrir dans Maps »**. Club au centre-ville : « ~12 km (position approximative du club) ». **Sans point de départ ou lieu inconnu : pas de ligne.**
- Affichage des distances (lot 1, ne pas réécrire) : « 800 m » sous 1 km, « 4,2 km » sous 10 km, « 23 km » au-delà ; approximatif préfixé « ~ ».
- La position GPS ne quitte jamais le téléphone ; l'autorisation n'est jamais demandée par ces écrans (aucun appel à `requestGps` dans ce lot).
- L'accueil reste sur **une seule page sans défilement** : la distance s'affiche sur une ligne existante, sans ajouter de hauteur.
- Textes en français, tutoiement, sans jargon. Emoji 🎾 interdit partout.
- Ne jamais lire `e.nativeEvent` dans une fonction passée à `setState` (garde-fou `lib/__tests__/nativeEventInUpdater.test.ts`).
- `expo-location` n'est nommé que dans `lib/location.ts` (garde-fou `lib/__tests__/noDirectExpoLocation.test.ts`).
- Règles des hooks : `useOrigin()` s'appelle en haut du composant, **avant tout `return` anticipé**.

### Règles du dépôt (valables pour chaque tâche)

- Travail directement sur `main`. Commits locaux par tâche, **jamais poussés**. `git add` uniquement les fichiers précis de la tâche — **jamais** `git add -A` / `git add .`, jamais `git stash`, `git checkout --`, `git restore`.
- Le dossier `supabase/` n'est pas versionné ; ce lot n'y touche pas.
- Tests : `node node_modules/vitest/vitest.mjs run lib` depuis la racine (808 tests avant ce lot). Types : `npx tsc --noEmit -p tsconfig.json`.
- Message de commit terminé par la ligne `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## Carte des fichiers

| Fichier | Rôle |
|---|---|
| `lib/geo.ts` (modifié) | + `distanceSentence` : la phrase des fiches, une seule fois |
| `lib/homeSlot.ts` (modifié) | + critère « proche » dans le classement des suggestions |
| `lib/__tests__/geo.test.ts`, `lib/__tests__/homeSlot.test.ts` (modifiés) | Tests des deux règles |
| `app/(tabs)/index.tsx` (modifié) | Passe `distanceOf` et `radiusKm` aux suggestions |
| `components/home/UpcomingMatchCard.tsx` (modifié) | Distance à côté du club, sur la ligne du club |
| `app/(tabs)/GameDetailsSheet.tsx` (modifié) | Ligne de distance sous le club, dans l'en-tête sombre |
| `components/tournaments/FicheHeros.tsx`, `app/tournaments/[id].tsx` (modifiés) | Ligne de distance sous le club de la fiche de tournoi |

---

### Task 1 : les deux règles pures

**Files:**
- Modify: `lib/geo.ts` (ajout en fin de fichier), `lib/__tests__/geo.test.ts`
- Modify: `lib/homeSlot.ts` (interface `SuggestionViewer`, fonction `suggestibleGames`), `lib/__tests__/homeSlot.test.ts`

**Interfaces:**
- Consumes (lot 1, déjà en place) : `formatGameDistance(d)`, `originLabel(o)`, `DEFAULT_RADIUS_KM`, types `GameDistance`, `Origin`, `DistanceOf` de `lib/geo.ts` ; `freeSpots`, `isUrgentGame`, `eloFitsGame` de `lib/games.ts`.
- Produces :
  - `distanceSentence(d: GameDistance | null | undefined, origin: Origin | null): string | null`
  - `SuggestionViewer` gagne `distanceOf?: DistanceOf` et `radiusKm?: number | null`
  - Ordre de classement de `suggestibleGames` : niveau → **proche** → urgence → club favori → date

- [ ] **Step 1 : écrire les tests qui échouent (phrase des fiches)**

Dans `lib/__tests__/geo.test.ts`, ajouter `distanceSentence` à la liste d'imports en tête du fichier, puis ajouter à la fin :

```ts
describe('la phrase des fiches', () => {
  const gps = { lat: 33.5, lng: -7.6, source: 'gps' as const };
  const zone = { lat: 33.5, lng: -7.6, source: 'zone' as const };

  it('club précis : la distance et sa source', () => {
    expect(distanceSentence({ km: 4.24, approx: false }, gps)).toBe('4,2 km depuis ta position');
    expect(distanceSentence({ km: 4.24, approx: false }, zone)).toBe('4,2 km depuis ta zone');
  });

  it('club au centre-ville : on le DIT, au lieu de faire passer une approximation pour une mesure', () => {
    expect(distanceSentence({ km: 12.2, approx: true }, gps))
      .toBe('~12 km depuis ta position (position approximative du club)');
  });

  it('sans point de départ, ou lieu inconnu : aucune phrase', () => {
    expect(distanceSentence({ km: 4.2, approx: false }, null)).toBeNull();
    expect(distanceSentence(null, gps)).toBeNull();
    expect(distanceSentence(undefined, gps)).toBeNull();
  });
});
```

- [ ] **Step 2 : lancer, vérifier l'échec**

Run: `node node_modules/vitest/vitest.mjs run lib/__tests__/geo.test.ts`
Expected: FAIL — `distanceSentence is not a function` (ou erreur d'import).

- [ ] **Step 3 : écrire `distanceSentence` dans `lib/geo.ts`**

À la fin de `lib/geo.ts`, après `initialZoneCenter` :

```ts
/**
 * La phrase d'une fiche : « 4,2 km depuis ta position », ou
 * « ~12 km depuis ta zone (position approximative du club) » quand le club est
 * placé au centre de sa ville.
 *
 * `null` sans point de départ ou pour un lieu inconnu : mieux vaut ne rien
 * écrire qu'un chiffre que personne ne peut vérifier. Écrite UNE fois, elle
 * sert à la fiche d'une partie et à celle d'un tournoi.
 */
export function distanceSentence(
  d: GameDistance | null | undefined, origin: Origin | null,
): string | null {
  if (!d || !origin) return null;
  const base = `${formatGameDistance(d)} ${originLabel(origin)}`;
  return d.approx ? `${base} (position approximative du club)` : base;
}
```

- [ ] **Step 4 : écrire les tests qui échouent (critère « proche »)**

Dans `lib/__tests__/homeSlot.test.ts`, ajouter à la fin :

```ts
describe('le critere « proche », juste apres le niveau', () => {
  const DEUX = [
    { player_id: 'x', status: 'accepted' },
    { player_id: 'y', status: 'accepted' },
  ];
  // Distances par NOM de club, comme lib/geo.makeDistanceOf les rend.
  const distances: Record<string, { km: number; approx: boolean }> = {
    'Pres': { km: 3, approx: false },
    'Loin': { km: 80, approx: false },
    'CentreVille': { km: 2, approx: true },
  };
  const distanceOf = (l: string | null | undefined) => (l ? distances[l] ?? null : null);
  const ME = { id: 'moi', gender: 'male', elo: 1500, distanceOf, radiusKm: 20 };

  it('une partie PROCHE passe devant une partie urgente mais lointaine', () => {
    const proche = G({ id: 'proche', location: 'Pres', match_date: dans(48) });
    const urgente = G({ id: 'urgente', location: 'Loin', match_date: dans(2), participants: DEUX });
    expect(suggestibleGames([urgente, proche], ME, NOW).map(g => g.id)).toEqual(['proche', 'urgente']);
  });

  it('mais le NIVEAU passe toujours avant la proximite', () => {
    const procheHorsNiveau = G({ id: 'proche', location: 'Pres', min_elo: 1800, max_elo: 2200, match_date: dans(48) });
    const loinDansNiveau = G({ id: 'loin', location: 'Loin', min_elo: 1200, max_elo: 1700, match_date: dans(48) });
    expect(suggestibleGames([procheHorsNiveau, loinDansNiveau], ME, NOW).map(g => g.id)).toEqual(['loin', 'proche']);
  });

  it('un club place au CENTRE DE SA VILLE ne compte pas comme proche', () => {
    // Sa distance est approximative : mettre cette partie en avant serait une
    // promesse fondee sur un point faux.
    const centre = G({ id: 'centre', location: 'CentreVille', match_date: dans(48) });
    const urgente = G({ id: 'urgente', location: 'Loin', match_date: dans(2), participants: DEUX });
    expect(suggestibleGames([centre, urgente], ME, NOW).map(g => g.id)).toEqual(['urgente', 'centre']);
  });

  it('au-dela du rayon de la zone, ce n est plus proche', () => {
    const ME5 = { ...ME, radiusKm: 5 };
    const auBord = G({ id: 'bord', location: 'Pres', match_date: dans(48) });   // 3 km
    const urgente = G({ id: 'urgente', location: 'Loin', match_date: dans(2), participants: DEUX });
    expect(suggestibleGames([urgente, auBord], ME5, NOW).map(g => g.id)).toEqual(['bord', 'urgente']);
    const ME1 = { ...ME, radiusKm: 1 };
    expect(suggestibleGames([urgente, auBord], ME1, NOW).map(g => g.id)).toEqual(['urgente', 'bord']);
  });

  it('SANS position, l ordre est exactement celui d avant', () => {
    const SANS = { id: 'moi', gender: 'male', elo: 1500 };
    const proche = G({ id: 'proche', location: 'Pres', match_date: dans(48) });
    const urgente = G({ id: 'urgente', location: 'Loin', match_date: dans(2), participants: DEUX });
    expect(suggestibleGames([proche, urgente], SANS, NOW).map(g => g.id)).toEqual(['urgente', 'proche']);
  });

  it('sans rayon declare, la zone par defaut est de 20 km', () => {
    const SANS_RAYON = { id: 'moi', gender: 'male', elo: 1500, distanceOf };
    const proche = G({ id: 'proche', location: 'Pres', match_date: dans(48) });
    const urgente = G({ id: 'urgente', location: 'Loin', match_date: dans(2), participants: DEUX });
    expect(suggestibleGames([proche, urgente], SANS_RAYON, NOW).map(g => g.id)).toEqual(['proche', 'urgente']);
  });

  it('proche ou pas, une partie reste PROPOSABLE (priorite, pas filtre)', () => {
    const loin = G({ id: 'loin', location: 'Loin', match_date: dans(48) });
    expect(suggestibleGames([loin], ME, NOW).map(g => g.id)).toEqual(['loin']);
  });
});
```

- [ ] **Step 5 : lancer, vérifier l'échec**

Run: `node node_modules/vitest/vitest.mjs run lib/__tests__/homeSlot.test.ts`
Expected: FAIL — les ordres attendus ne sortent pas (le critère n'existe pas), par exemple `['urgente','proche']` au lieu de `['proche','urgente']`. Les tests « SANS position » et « priorité, pas filtre » passent déjà.

- [ ] **Step 6 : ajouter le critère dans `lib/homeSlot.ts`**

Ajouter l'import, après `import { canPlayerSee } from './exploreFilters';` :

```ts
import { DEFAULT_RADIUS_KM, type DistanceOf } from './geo';
```

Dans `interface SuggestionViewer`, après `favoriteClubs?: string[];` :

```ts
  /** Distance d'un club depuis mon point de départ (hooks/useOrigin.distanceOf).
   *  Absente = aucune position connue : le critère « proche » est ignoré. */
  distanceOf?: DistanceOf;
  /** Le rayon de ma zone, en km. Absent = 20 km (lib/geo.DEFAULT_RADIUS_KM). */
  radiusKm?: number | null;
```

Dans le commentaire de `suggestibleGames`, remplacer le bloc de classement :

```
 *   1. DANS MA FOURCHETTE DE NIVEAU — `eloFitsGame`, la même règle que le
 *      lobby. Hors fourchette, rejoindre passe par le vote des joueurs déjà
 *      dedans : c'est une partie qu'on n'aura peut-être pas ;
 *   2. URGENTE — `isUrgentGame`, le même prédicat que le filtre « Urgent » de
 *      l'Explorer (il était écrit trois fois avant de vivre à un seul
 *      endroit) : il manque une personne et ça se joue bientôt ;
 *   3. DANS UN DE MES CLUBS FAVORIS — par nom, comme partout ;
 *   4. à égalité, LA PLUS PROCHE dans le temps.
```

par :

```
 *   1. DANS MA FOURCHETTE DE NIVEAU — `eloFitsGame`, la même règle que le
 *      lobby. Hors fourchette, rejoindre passe par le vote des joueurs déjà
 *      dedans : c'est une partie qu'on n'aura peut-être pas ;
 *   2. PRÈS DE MOI — dans le rayon de ma zone, et seulement sur une position
 *      de club SÛRE : un club placé au centre de sa ville donnerait une
 *      distance fausse, et mettrait en avant une partie qui n'est peut-être
 *      pas proche du tout. Sans point de départ, le critère ne départage
 *      personne et l'ordre reste celui d'avant ;
 *   3. URGENTE — `isUrgentGame`, le même prédicat que le filtre « Urgent » de
 *      l'Explorer (il était écrit trois fois avant de vivre à un seul
 *      endroit) : il manque une personne et ça se joue bientôt ;
 *   4. DANS UN DE MES CLUBS FAVORIS — par nom, comme partout ;
 *   5. à égalité, LA PLUS PROCHE dans le temps.
```

Dans le corps de `suggestibleGames`, remplacer :

```ts
  const favoris = new Set(me.favoriteClubs ?? []);
  // 0 = prioritaire, 1 = non. Comparés dans l'ordre, puis la date départage.
  const rang = (g: G): number[] => [
    me.elo != null && eloFitsGame(g, me.elo) ? 0 : 1,
    isUrgentGame(g, now) ? 0 : 1,
    g.location != null && favoris.has(g.location) ? 0 : 1,
  ];
```

par :

```ts
  const favoris = new Set(me.favoriteClubs ?? []);
  const rayon = me.radiusKm ?? DEFAULT_RADIUS_KM;
  /** Près de moi : position du club SÛRE et distance dans le rayon de ma zone. */
  const proche = (g: G): boolean => {
    const d = me.distanceOf?.(g.location);
    return !!d && !d.approx && d.km <= rayon;
  };
  // 0 = prioritaire, 1 = non. Comparés dans l'ordre, puis la date départage.
  const rang = (g: G): number[] => [
    me.elo != null && eloFitsGame(g, me.elo) ? 0 : 1,
    proche(g) ? 0 : 1,
    isUrgentGame(g, now) ? 0 : 1,
    g.location != null && favoris.has(g.location) ? 0 : 1,
  ];
```

- [ ] **Step 7 : lancer les tests et les types**

Run: `node node_modules/vitest/vitest.mjs run lib` puis `npx tsc --noEmit -p tsconfig.json`
Expected: tout passe (808 tests avant ce lot + les nouveaux) ; types propres.

- [ ] **Step 8 : commit**

```bash
git add lib/geo.ts lib/homeSlot.ts lib/__tests__/geo.test.ts lib/__tests__/homeSlot.test.ts
git commit -m "feat(localisation): critère « proche » dans les suggestions et phrase de distance des fiches (lot 2)"
```

---

### Task 2 : accueil — suggestions et carte « Prochain match »

**Files:**
- Modify: `app/(tabs)/index.tsx` (appel à `suggestibleGames`, ~ligne 321)
- Modify: `components/home/UpcomingMatchCard.tsx` (ligne du club, ~ligne 216)

**Interfaces:**
- Consumes : Task 1 (`SuggestionViewer.distanceOf` / `.radiusKm`), lot 1 (`useOrigin()` → `{ distanceOf, radiusKm }`, `formatGameDistance`).
- Produces : rien pour les tâches suivantes.

- [ ] **Step 1 : passer la distance aux suggestions**

Dans `app/(tabs)/index.tsx`, ajouter l'import après `import { staysInUpcoming } from '../../lib/games';` :

```ts
import { useOrigin } from '../../hooks/useOrigin';
```

Dans le composant de l'écran, juste après la ligne `const [favoris, setFavoris] = useState<string[]>([]);`, ajouter :

```ts
  // Point de départ partagé (GPS récent, sinon ma zone) : sert au critère
  // « proche » des suggestions et à la distance de la carte « Prochain match ».
  const { distanceOf, radiusKm } = useOrigin();
```

Puis remplacer l'appel :

```tsx
  const suggestions = suggestibleGames(
    openGames as any,
    { id: player.id, gender: player.gender, elo: player.elo_score, favoriteClubs: favoris },
    now,
  ) as unknown as OpenGame[];
```

par :

```tsx
  const suggestions = suggestibleGames(
    openGames as any,
    {
      id: player.id, gender: player.gender, elo: player.elo_score, favoriteClubs: favoris,
      distanceOf, radiusKm,
    },
    now,
  ) as unknown as OpenGame[];
```

- [ ] **Step 2 : distance sur la carte « Prochain match »**

Dans `components/home/UpcomingMatchCard.tsx`, ajouter les imports (avec les autres imports en tête) :

```ts
import { useOrigin } from '../../hooks/useOrigin';
import { formatGameDistance } from '../../lib/geo';
```

Dans le composant, juste après la ligne `const [zone, setZone] = useState({ w: 0, h: 0 });`, ajouter :

```tsx
  // Distance du club, même source que les cartes du lobby (hooks/useOrigin).
  const { distanceOf } = useOrigin();
  const distance = distanceOf(game.location);
```

Puis remplacer :

```tsx
              <Text numberOfLines={1} style={{ fontFamily: Fonts.uiExtraBold, fontSize: 14.5, color: Colors.textPrimary }}>
                {game.location || 'Lieu à définir'}
              </Text>
```

par :

```tsx
              {/* La distance vit sur la LIGNE DU CLUB : l'accueil ne défile
                  pas, la carte ne doit pas grandir d'un pixel. */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text numberOfLines={1} style={{ flex: 1, fontFamily: Fonts.uiExtraBold, fontSize: 14.5, color: Colors.textPrimary }}>
                  {game.location || 'Lieu à définir'}
                </Text>
                {distance && (
                  <Text numberOfLines={1} style={{ fontFamily: Fonts.uiBold, fontWeight: '700', fontSize: 11.5, color: Colors.textMuted }}>
                    {formatGameDistance(distance)}
                  </Text>
                )}
              </View>
```

- [ ] **Step 3 : types et tests**

Run: `npx tsc --noEmit -p tsconfig.json` puis `node node_modules/vitest/vitest.mjs run lib`
Expected: types propres ; tous les tests verts (dont le garde-fou de hauteur `lib/__tests__/homeLayout` s'il existe — le rendu n'ajoute aucune ligne).

- [ ] **Step 4 : commit**

```bash
git add "app/(tabs)/index.tsx" components/home/UpcomingMatchCard.tsx
git commit -m "feat(localisation): accueil — proximité dans les suggestions, distance sur « Prochain match » (lot 2)"
```

---

### Task 3 : fiche d'une partie

**Files:**
- Modify: `app/(tabs)/GameDetailsSheet.tsx` (bloc du club dans l'en-tête sombre, ~ligne 796)

**Interfaces:**
- Consumes : Task 1 (`distanceSentence`), lot 1 (`useOrigin()` → `{ distanceOf, origin }`).
- Produces : rien.

- [ ] **Step 1 : brancher le point de départ**

Dans `app/(tabs)/GameDetailsSheet.tsx`, ajouter les imports (avec les autres) :

```ts
import { useOrigin } from '../../hooks/useOrigin';
import { distanceSentence } from '../../lib/geo';
```

Dans le composant, avec les autres hooks (avant tout `return` anticipé — repérer le premier `if (…) return` du composant et se placer au-dessus) :

```tsx
  // Distance jusqu'au club, même source que les cartes (hooks/useOrigin).
  const { distanceOf, origin } = useOrigin();
  const phraseDistance = distanceSentence(distanceOf(game?.location), origin);
```

Si le composant ne peut pas recevoir `game` à `null`, écrire `distanceOf(game.location)`.

- [ ] **Step 2 : afficher la phrase sous le club**

Juste après la `</TouchableOpacity>` qui ferme le bloc « Club — touchable → Maps » (celui qui contient `Itinéraire`), ajouter :

```tsx
            {/* « 4,2 km depuis ta position », ou « ~12 km … (position
                approximative du club) » quand le club est placé au centre de
                sa ville. Rien sans point de départ : cf. lib/geo. */}
            {phraseDistance && (
              <Text numberOfLines={2} style={{ fontSize: 12.5, fontFamily: Fonts.uiSemi, color: 'rgba(255,255,255,0.7)', marginTop: 2, marginLeft: 26 }}>
                {phraseDistance}
              </Text>
            )}
```

- [ ] **Step 3 : types et tests**

Run: `npx tsc --noEmit -p tsconfig.json` puis `node node_modules/vitest/vitest.mjs run lib`
Expected: types propres ; tests verts, garde-fous compris.

- [ ] **Step 4 : commit**

```bash
git add "app/(tabs)/GameDetailsSheet.tsx"
git commit -m "feat(localisation): distance du club sur la fiche d'une partie (lot 2)"
```

---

### Task 4 : fiche d'un tournoi

**Files:**
- Modify: `components/tournaments/FicheHeros.tsx` (`RegistrationCard`, ~lignes 255-310)
- Modify: `app/tournaments/[id].tsx` (appel à `<RegistrationCard … />`, ~ligne 981)

**Interfaces:**
- Consumes : Task 1 (`distanceSentence`), lot 1 (`useOrigin()`).
- Produces : `RegistrationCard` gagne la prop `distanceLine?: string`.

- [ ] **Step 1 : la prop de la carte**

Dans `components/tournaments/FicheHeros.tsx`, dans la signature de `RegistrationCard`, remplacer :

```tsx
export function RegistrationCard({ dayLabel, timeLabel, clubLine, taken, total, free, waiting, courts, priceLabel: price, onDirections, onShare, onCalendar }: {
```

par :

```tsx
export function RegistrationCard({ dayLabel, timeLabel, clubLine, distanceLine, taken, total, free, waiting, courts, priceLabel: price, onDirections, onShare, onCalendar }: {
```

et, dans le type des props, juste après `clubLine: string;` :

```tsx
  /** « 4,2 km depuis ta position » (lib/geo.distanceSentence). Absente quand
   *  on ne sait pas d'où mesurer, ou que le club n'a pas de position. */
  distanceLine?: string;
```

- [ ] **Step 2 : l'afficher sous le club**

Juste après la `</TouchableOpacity>` du bloc du club (celui qui porte `onDirections` et `clubLine`), ajouter :

```tsx
        {distanceLine && (
          <Text numberOfLines={2} style={{ fontSize: 12.5, fontFamily: Fonts.uiSemi, color: Colors.textSecondary, marginTop: 2, marginLeft: 28 }}>
            {distanceLine}
          </Text>
        )}
```

Si `Fonts.uiSemi` n'existe pas dans ce fichier, utiliser `Fonts.uiBold` (vérifier l'import de `Fonts` en tête).

- [ ] **Step 3 : la calculer dans l'écran du tournoi**

Dans `app/tournaments/[id].tsx`, ajouter les imports (avec les autres) :

```ts
import { useOrigin } from '../../hooks/useOrigin';
import { distanceSentence } from '../../lib/geo';
```

Dans le composant de l'écran, avec les autres hooks (avant tout `return` anticipé) :

```tsx
  // Distance jusqu'au club du tournoi, même source que le reste de l'app.
  const { distanceOf, origin } = useOrigin();
```

Puis, dans le rendu de `<RegistrationCard …>`, après la ligne `clubLine={…}`, ajouter :

```tsx
            distanceLine={distanceSentence(distanceOf(t.club?.name), origin) ?? undefined}
```

- [ ] **Step 4 : types et tests**

Run: `npx tsc --noEmit -p tsconfig.json` puis `node node_modules/vitest/vitest.mjs run lib`
Expected: types propres ; tests verts.

- [ ] **Step 5 : commit**

```bash
git add components/tournaments/FicheHeros.tsx "app/tournaments/[id].tsx"
git commit -m "feat(localisation): distance du club sur la fiche d'un tournoi (lot 2)"
```

---

### Task 5 : livraison (contrôleur + utilisateur)

Pas de sous-agent, pas de migration : ce lot ne touche pas la base.

- [ ] **Step 1 : publier sur le canal de test**

Run: `EAS_SKIP_AUTO_FINGERPRINT=1 npx eas update --branch preview --environment preview --message "Localisation lot 2 : proximité sur l'accueil, distance sur les fiches" --non-interactive`
Puis `npx eas update:list --branch preview --limit 1` pour vérifier la publication.

- [ ] **Step 2 : essais sur téléphone (utilisateur)**

1. Accueil : la carte « Prochain match » affiche la distance à droite du club, et l'accueil ne défile toujours pas.
2. Accueil sans match programmé (« Ça se joue bientôt ») : à niveau égal, une partie proche passe devant une partie urgente lointaine. **Aujourd'hui, tous les clubs des parties de test sont placés au centre de leur ville : le critère « proche » ne départagera donc personne** tant que le fichier du lot 0 n'est pas rempli — l'ordre doit rester celui d'avant, sans régression.
3. Fiche d'une partie : sous le club, « ~12 km depuis ta position (position approximative du club) ».
4. Fiche d'un tournoi : même ligne sous le club.
5. Sans autorisation de position et sans zone : aucune de ces lignes n'apparaît, et rien ne bouge.
