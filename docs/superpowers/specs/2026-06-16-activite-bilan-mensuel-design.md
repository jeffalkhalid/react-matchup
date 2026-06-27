# Sous-projet B — Bilan Mensuel (Wrapped)

**Date :** 2026-06-16
**Statut :** Design validé, prêt pour le plan d'implémentation
**Index :** `2026-06-16-activite-refonte-index-design.md`
**Handoff :** `design_handoff_activity_tab/designs/02-Bilan-Mensuel.dc.html` · screenshots `02-bilan-juin-cover.png`, `03-bilan-volume.png`, `04-bilan-share-final.png`

## Contexte

« Spotify Wrapped du padel » : 7 slides verticales 9:16, navigation Stories, sélecteur de mois. Aucune brique de ce type n'existe ; les données sources existent (`matches`, `elo_history`, `player_achievements`, doubles via `winner_id_2`/`loser_id_2`).

## Objectif

Écran plein écran `app/bilan/[month].tsx` (hors `(tabs)`), ouvert depuis le Feed (« Voir bilan complet ») et le deep link notif (`pagmatch://bilan/<mois>`). Reproduire les 7 slides hi-fi avec `react-native-svg` pour les charts et le pipeline Stories local pour le partage.

## Données

- **Vue `monthly_recap`** (migration `monthly_recap.sql`) : par `user_id` + `month` → `matches, wins, losses, win_rate`. Construite sur `matches` (un joueur = winner/winner_2/loser/loser_2).
- **Compléments** via `lib/bilan.ts` `getMonthlyRecap(uid): MonthlyRecap[]` (forme exacte du handoff §Data shape) :
  - `eloDelta` + `eloTimeline` ← `elo_history` du mois.
  - `fromLvl`/`toLvl` ← `eloToLevel()` (lib/theme) sur ELO début/fin de mois.
  - `topPartner` ← agrégat des doubles du mois (partenaire le plus fréquent ; fallback = unique partenaire). Répond à la question ouverte #3.
  - `bestMatch` ← « plus beau score » du mois (heuristique : plus gros écart / victoire la plus nette).
  - `badgesUnlocked` ← `player_achievements` débloqués dans le mois (affichés via `GLYPHS`, pas emoji).
  - `barChart6Months` ← `monthly_recap` 6 derniers mois.
- Récupération : `supabase.from('monthly_recap').select().eq('user_id', uid).order('month', desc).limit(12)` + jointures ELO/duo/best en RPC ou requêtes groupées dans `lib/bilan.ts`.

## Slides (`components/bilan/`)

| # | Nom | Fond | Contenu |
|---|---|---|---|
| 0 | Cover | dégradé jaune `#FFC11A → #7C2D12` | sélecteur de mois + recap 3 chiffres |
| 1 | Volume | vert `#064E3B → #022C22` | nb matchs (Anton géant) + **bar chart 6 mois** (SVG) |
| 2 | Forme | noir | % winrate + grille V/D + « vs moyenne amis » |
| 3 | ELO | noir/gris | +Δ ELO + **line chart** (SVG) + niveau from→to |
| 4 | Duo | noir | avatar 140 partenaire #1 (mono) + stats |
| 5 | Best moment | bleu-vert | score block XL (Anton) + badge débloqué (glyph) |
| 6 | Partage | dégradé jaune | recap card screenshotable + CTAs partage |

## Navigation Stories
- Tap droite (67 %) → suivant ; tap gauche (33 %) → précédent ; X top-right → ferme (retour onglet Activité).
- Progress bars en haut : passées 100 % / courante 50 % / futures 0 %.
- **Long-press pause = hors-scope v1** (noté, non bloquant).

## Sélecteur de mois (slide 0)
- Pills `AVRIL · MAI · JUIN` ; scroll horizontal si historique > 3 mois ; **mois courant bloqué** (pas encore prêt). Tap → recharge toute la séquence avec les données du mois choisi.
- Tracking `bilan_month_switched { from_month, to_month }`.

## Partage (slide 6)
- Réutilise le pipeline **StoryCanvas** local : `react-native-view-shot` capture la recap card en PNG → `expo-sharing` Share Sheet natif (réponse question ouverte #5). Option « enregistrer » via `expo-media-library`.
- Tracking `bilan_shared { channel: 'ig'|'wa'|'save', month }`.

## Charts (SVG maison léger)
- `components/bilan/BarChart6Months.tsx` et `LineChartElo.tsx` en `react-native-svg` (déjà en dépendance). Pas de lib de charts. Axes minimalistes, style handoff.

## États & tracking
- `BilanState = { slide: 0..6, month: 'YYYY-MM' }`.
- `bilan_opened { source, month }`, `bilan_slide_viewed { slide_index, slide_name, month }` (slide visible >1 s), `bilan_completed { month, duration_ms }`.
- **Mois calme (<3 matchs)** → 1 slide unique (sous-projet C, frame C), pas les 7.

## Fichiers touchés

| Fichier | Action |
|---|---|
| `app/bilan/[month].tsx` | **Nouveau** — conteneur plein écran + navigation Stories |
| `app/_layout.tsx` | Enregistrer la route `bilan/[month]` + deep link `pagmatch://bilan/<mois>` |
| `components/bilan/Slide*.tsx` (7) | **Nouveau** |
| `components/bilan/BarChart6Months.tsx`, `LineChartElo.tsx` | **Nouveau** (SVG) |
| `components/bilan/MonthPicker.tsx` | **Nouveau** |
| `components/bilan/ShareCard.tsx` | **Nouveau** (capture view-shot) |
| `lib/bilan.ts` | **Nouveau** — `getMonthlyRecap` + types `MonthlyRecap` |
| `supabase/migrations/monthly_recap.sql` | **Nouveau** — vue + helpers |
| Feed (`activite.tsx`) | Bouton « Voir bilan complet » → route bilan (posé en sous-projet A) |

## Critères de réussite
1. 7 slides naviguables (tap g/d, X, progress bars) reproduisant le handoff.
2. Sélecteur de mois recharge toutes les données ; mois courant bloqué.
3. Charts SVG (volume 6 mois, ELO) rendus à partir de vraies données.
4. Partage = capture PNG locale → Share Sheet natif (zéro média serveur).
5. `topPartner`/`bestMatch`/`badges` dérivés des vraies tables.
6. `tsc` passe.

## Hors-scope (futures)
- Long-press pause / auto-play.
- « vs moyenne amis » avancé (peut démarrer en valeur simple).
- Décoration partage par réseau spécifique (Share Sheet générique d'abord).
