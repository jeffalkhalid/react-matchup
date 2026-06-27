# Localisation des terrains — Design (Phase 1 : « Ouvrir dans Maps »)

Date : 2026-06-21
Projet : PAG MATCH (react-matchup, React Native / Expo + Supabase)
Statut : validé (brainstorming)

## Contexte

- La table `clubs` (Supabase) est déjà peuplée de vrais clubs marocains avec
  `name`, `city`, `region`, `address`, `phone`, `web`… mais **aucune coordonnée GPS**.
- L'`address` est inégale : parfois précise, souvent juste la ville, parfois `NULL`.
- Une partie (`open_games`) ne stocke que `location` = **une chaîne de texte**
  (nom du club choisi dans `CreateWizard`, ou texte libre).
- Le détail d'une partie affiche déjà une ligne « lieu » avec une icône épingle
  (`app/(tabs)/GameDetailsSheet.tsx` ~ lignes 517-523).

## Objectif

Permettre d'**ouvrir le terrain d'une partie dans une appli de cartes** (itinéraire),
avec un **repère GPS précis**. Les coordonnées GPS posées ici sont la fondation
des phases futures (carte interactive, tri « près de moi »).

Décisions de cadrage (validées) :
- **Phase 1 = uniquement « Ouvrir dans Maps »** ; carte/proximité hors scope.
- **Précision : coordonnées GPS** (pas seulement recherche texte).
- **Source de géocodage : Nominatim / OpenStreetMap** (gratuit, sans clé),
  avec correction manuelle des ratés.

## Composants

### 1. Modèle de données — migration additive

Ajouter à `public.clubs` (toutes nullable, aucune donnée cassée) :

| Colonne          | Type               | Rôle                                            |
|------------------|--------------------|-------------------------------------------------|
| `latitude`       | `double precision` | latitude du club                                |
| `longitude`      | `double precision` | longitude du club                               |
| `geo_source`     | `text`             | `'osm'` \| `'manual'` \| `'city'`               |
| `geo_confidence` | `text`             | `'exact'` \| `'city'` \| `'none'`               |

Migration : `supabase/migrations/clubs_geo_columns.sql` (`ADD COLUMN IF NOT EXISTS`).

### 2. Script de géocodage (one-time, hors app)

Fichier : `scripts/geocode-clubs.mjs` (Node, lancé en local).

Comportement :
1. Lit les clubs sans coordonnées.
2. Interroge **Nominatim** sur `"<name>, <city>, Maroc"`.
   - Respecte la politique d'usage : **≤ 1 requête/seconde** + en-tête
     `User-Agent: PagMatch/1.0 (contact)`.
3. Résolution de confiance :
   - bon résultat sur le club → `geo_confidence = 'exact'`, `geo_source = 'osm'` ;
   - sinon repli sur `"<city>, Maroc"` → `geo_confidence = 'city'`, `geo_source = 'city'` ;
   - rien → `geo_confidence = 'none'`, coords laissées `NULL`.
4. Génère un fichier migration `supabase/migrations/update_clubs_geo.sql`
   composé d'`UPDATE … WHERE ext_id = …`, à appliquer en prod manuellement.

Re-jouable. Les lignes `'city'` / `'none'` sont la liste des coords à corriger
à la main ensuite (clic droit Google Maps → coller lat/lng, `geo_source='manual'`).

### 3. Helper d'ouverture Maps — `lib/maps.ts`

```
openInMaps({ location, lat, lng }): void
```

- Si coords **précises** présentes → URL repère précis, universelle iOS/Android :
  `https://www.google.com/maps/search/?api=1&query=<lat>,<lng>`
- Sinon repli **recherche texte** : `https://www.google.com/maps/search/?api=1&query=<encodeURIComponent(location)>, Maroc`
  (gère les clubs non géocodés ET les `location` en texte libre).
- **Décision (raffinement post-géocodage) :** le cache client ne charge QUE les clubs
  `geo_confidence='exact'`. Les clubs `geo_confidence='city'` (centre-ville approximatif
  via Nominatim) retombent volontairement sur la recherche texte par **nom de club** —
  l'index de lieux de Google les résout mieux qu'un faux repère au centre-ville. Une
  correction manuelle d'un club `city` doit le repasser en `geo_confidence='exact'` pour
  être utilisée par le pin.
- Ouverture via `Linking.openURL(...)` (déjà disponible, **aucune dépendance native ajoutée**).
- `location` vide / pas de coords ET pas de texte → no-op.

Résolution des coordonnées : matcher `game.location` ↔ `clubs.name`.
La partie ne stocke que le nom ; on récupère `latitude`/`longitude` du club
soit via un cache clubs côté client, soit en élargissant la requête qui charge
la partie. **Ce détail d'implémentation est tranché dans le plan**, pas ici.

### 4. UI

- Rendre la ligne « lieu » de `GameDetailsSheet` **tappable** → `openInMaps(...)`.
- Ajouter une affordance discrète (libellé « Itinéraire » ou chevron) pour
  signaler que c'est cliquable.
- **Pas de nouveau bouton.**
- Le helper est réutilisable sur la `MatchCard` plus tard (non requis Phase 1).

## Repli & cas limites

- `location` vide → ligne non cliquable, aucune action.
- Club non géocodé ou `location` en texte libre → recherche texte (toujours utile).
- Aucune appli de cartes installée : `Linking.openURL` ouvre le navigateur
  (Google Maps web), comportement acceptable.

## Hors scope (phases futures, débloquées par les coordonnées)

- Carte interactive des terrains / des parties.
- Tri & filtre « près de moi » par distance (nécessite la géoloc utilisateur).

## Critères de succès

- Depuis le détail d'une partie dont le club est géocodé, taper le lieu ouvre
  Maps centré sur le **bon club**.
- Pour un club non géocodé ou un lieu en texte libre, taper le lieu ouvre une
  **recherche texte** pertinente (au pire la ville).
- Aucune régression d'affichage du lieu ; aucune nouvelle dépendance native.
