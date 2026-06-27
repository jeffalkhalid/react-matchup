# Uniformisation des icônes — Design

**Date :** 2026-06-25
**Périmètre validé :** Famille A (icônes UI) + Famille B (badges achievements). Famille C (réactions chat, médailles 🥇🥈🥉) reste volontairement en emoji couleur.

## Problème

L'app mélange trois paradigmes d'icônes de façon incohérente, ce qui donne par
endroits un rendu « amateur » :

1. **Emoji fonctionnels** dispersés dans les écrans (🔍 🔔 💬 📍 📅) et symboles
   texte (✓ ✕ →) affichés à côté d'icônes SVG line-art soignées.
2. **Badges en emoji** (👑 💥 🎯 🔥 🧱…) avec leur table `BADGE_EMOJI`
   **dupliquée dans 4 fichiers** :
   - `app/(tabs)/index.tsx:246`
   - `app/(tabs)/lobby.tsx:825`
   - `app/score-entry.tsx:21`
   - `app/(tabs)/player/[id].tsx:55` (variante enrichie avec alias)
3. **SVG inline redéfinis** dans `index.tsx` (`IconRadar`, `IconTrophy`,
   `IconCalendar`, `IconPen`, `BellFilledIcon`) au lieu d'utiliser le registre
   central.

La navbar (`app/(tabs)/_layout.tsx`) est **déjà** en line-art propre : ce n'est
pas elle le problème. Le style cible existe déjà dans le codebase.

## Style cible

Line-art type Lucide/Feather : `viewBox 0 0 24 24`, `fill="none"`, trait ~2px
(1.7 pour les glyphes badges), `strokeLinecap/Linejoin="round"`, monochrome
piloté par la couleur du thème. C'est exactement le style déjà en place dans
`components/community/icons.tsx` et `components/profile/glyphs.tsx`.

## Architecture — une seule source de vérité

On garde les deux registres line-art existants, on les complète, et on supprime
les définitions dupliquées.

### `components/community/icons.tsx` — icônes UI
Registre `Icon({ name, size, color, ... })`, switch sur `IconName`.
- Couvre déjà : chevrons, bell, users, search, plus, mapPin, check, x,
  arrowRight/Left, message, camera, clock, trophy, zap, swords, radar, bellRing,
  send, qr, sliders, trendingUp, share, lifeBuoy, settings.
- **À ajouter** (~5, pour couvrir tous les emoji fonctionnels visés) :
  `calendar`, `pencil` (edit), `heart`, `eye`, et au besoin `flame` (version UI).

### `components/profile/glyphs.tsx` — glyphes badges
Registre `Glyph({ name, color, strokeWidth })`, trait 1.7.
- Réutilisés pour les badges : `crown`, `star`, `target`, `flame`, `handshake`.
- **À créer (7 nouveaux glyphes)** : `bomb`, `brick` (mur), `net` (filet),
  `runner`, `brain`, `smile`, `beers`. (clock vient du registre UI.)

### `lib/badges.ts` — NOUVEAU, table unique
Remplace les 4 copies de `BADGE_EMOJI`. Map `badge label → { glyph, color }`.
Source unique consommée par tous les écrans.

### `components/profile/BadgePill.tsx` — NOUVEAU composant
Affiche un badge : glyphe line-art **blanc** dans un cercle/écusson de la
**couleur du badge** (pastille pleine). Props : `label` (ou clé badge), `size`.
Lit le mapping depuis `lib/badges.ts`.

```
╭─────╮
│ glyphe│  glyphe blanc, pastille = couleur du badge
╰─────╯
  label
```

### Nettoyage `index.tsx`
Les icônes SVG inline (`IconRadar`, `IconTrophy`, `IconCalendar`, `IconPen`,
`BellFilledIcon`) sont supprimées et remplacées par `<Icon name=…/>` (en
ajoutant au registre celles qui manquent).

## Mapping des badges (Famille B)

13 badges → glyphe + couleur de pastille. Couleurs groupées par famille
sémantique : **or** = leadership, **rouge** = puissance, **bleu ardoise** =
défense, **cyan/violet** = profil technique, **vert/ambre** = social.

| Badge | Glyphe | Couleur pastille | Glyphe à créer ? |
|---|---|---|---|
| MVP | crown | or | existe |
| Le Capitaine | star | or | existe |
| La Bombe | bomb | rouge | **nouveau** |
| Le Smash | target | rouge | existe |
| Le Phénix | flame | orange | existe |
| Le Mur | brick | bleu ardoise | **nouveau** |
| Roi du Filet | net | bleu ardoise | **nouveau** |
| L'Essuie-glace | runner | cyan | **nouveau** |
| Le Cerveau | brain | violet | **nouveau** |
| Fair-Play | handshake | vert | existe |
| Ponctuel | clock | vert | existe (registre UI) |
| Bonne Ambiance | smile | vert | **nouveau** |
| 3e Mi-temps | beers | ambre | **nouveau** |

Note : `player/[id].tsx` utilise des **alias** vers ces badges (codes `MVP`,
`RUNNER`, `NET_KING`, `BRAIN`, `CAPTAIN`, `COMEBACK`, label FR…). `lib/badges.ts`
doit normaliser ces alias vers le label canonique.

## Balayage des icônes UI (Famille A)

Remplacement des emoji/symboles fonctionnels par `<Icon>`, écran par écran
(changements additifs et réversibles) :

| Avant | Après (`Icon name`) |
|---|---|
| 🔍 | `search` |
| 🔔 / 🔕 | `bell` / `bellRing` |
| 💬 | `message` |
| 📍 | `mapPin` |
| 📅 | `calendar` (nouveau) ou `clock` |
| ✓ | `check` |
| ✕ / × | `x` |
| → | `arrowRight` |
| ✏️ / pen | `pencil` (nouveau) |

**Hors périmètre (NE PAS toucher) :** réactions chat (🔥 🎉 💪 👍 😄), médailles
🥇 🥈 🥉, emoji des `guideTheme`/onboarding (décoratifs, famille C). Les
réactions 🔥 sont des **clés en base de données** — toute conversion les
casserait.

## Déroulé (par étapes, sur `main`, réversible)

1. **Fondations** : compléter les registres (icônes UI manquantes + 6 glyphes
   badges), créer `lib/badges.ts` + `<BadgePill>`. Vérif `tsc`.
2. **Migration badges** : remplacer les 4 `BADGE_EMOJI` dupliqués par
   `<BadgePill>` / `lib/badges.ts`. Démo visuelle possible ici.
3. **Balayage UI** : remplacer les emoji fonctionnels écran par écran.
4. **Validation** : `tsc` + vérif device à chaque étape.

L'étape 1 + une démo badges peuvent être livrées avant de balayer tout le reste,
si on veut valider le rendu avant le gros du travail.

## Contraintes

- Travail directement sur `main`, sans branche ni commit automatique (préférence
  utilisateur). Changements additifs et réversibles.
- Pas de nouvelle dépendance (`lucide-react-native` etc.) : on reste sur
  `react-native-svg`, déjà présent.
- Ne pas régresser les clés DB des réactions (famille C intouchée).

## Critères de réussite

- Plus aucune table `BADGE_EMOJI` dupliquée : une seule source `lib/badges.ts`.
- Tous les badges affichés via `<BadgePill>` (glyphe line blanc + pastille).
- Emoji fonctionnels (famille A) remplacés par `<Icon>` sur les écrans
  principaux.
- Aucune icône SVG inline résiduelle dans `index.tsx` (tout via registre).
- `tsc` OK ; réactions chat et médailles inchangées.
