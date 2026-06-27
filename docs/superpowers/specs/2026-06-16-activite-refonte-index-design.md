# Onglet Activité — Refonte (index & fondations partagées)

**Date :** 2026-06-16
**Statut :** Design validé, prêt pour les plans d'implémentation
**Handoff source :** `C:\Users\jeffa\Bureau\Native\design_handoff_activity_tab\` (README + screenshots + prototypes `.dc.html`)

## Pourquoi un index

Le handoff couvre **4 sous-systèmes quasi-indépendants**. Plutôt qu'un seul spec monolithique, chacun a son propre spec → plan → implémentation. Ce document tient les **décisions transverses** et l'**ordre de livraison**, et sert de point d'entrée.

| # | Sous-projet | Spec | Ordre |
|---|---|---|---|
| A | Feed Activité enrichi | `2026-06-16-activite-feed-enrichi-design.md` | 1ᵉʳ (cœur rétention, débloque le point d'entrée du Bilan) |
| B | Bilan Mensuel (Wrapped) | `2026-06-16-activite-bilan-mensuel-design.md` | 2ᵉ |
| C | États vides (3 frames) | `2026-06-16-activite-etats-vides-design.md` | 3ᵉ (se greffe sur A + B) |
| D | Notification Bilan Mensuel | `2026-06-16-activite-notif-bilan-design.md` | 4ᵉ (dépend de B pour le deep link) |

## Décisions transverses (prises avec l'utilisateur)

1. **Fidélité hi-fi**, au pixel près, en réutilisant la lib UI native existante. Pas de copier-coller des `.dc.html` (ce sont des prototypes, pas du code prod).
2. **Données via vues + RPC Supabase versionnées** (migrations dans `supabase/migrations/`, appliquées **à la main** en prod comme le reste du projet — pas de CLI/push automatique).
3. **Hero « Il manque 1 joueur »** : priorisation **distance × niveau × imminence × amis présents** (réutilise l'esprit du scoring de `app/(tabs)/matchmaking.tsx`).
4. **Tracking** : table réelle `analytics_events` + helper `lib/analytics.ts` `track()` fire-and-forget.
5. **Moments** : tuiles **rendues à la volée depuis `activity_events`**, **aucun média serveur** (respecte la règle Stories 100 % locales + limite Supabase 50 Mo). Le slot « Partager ton match » ouvre le `StoryComposer` local existant.
6. **Partage Bilan** : pipeline **StoryCanvas local** (capture PNG via `react-native-view-shot` → Share Sheet natif `expo-sharing`). Pas d'intégration IG/WhatsApp custom.
7. **Charts** : `react-native-svg` (déjà en dépendance, `^15.12.1`). Pas de lib de charts lourde.

## Tokens & polices (déjà en place — à réutiliser tels quels)

- Couleurs : `lib/colors.js` / `lib/theme.ts`. Noir `#0A0A0A` (`Colors.heroBg`/`primary`), jaune `#FFC11A` (`Colors.brand`), vert `#10B981` (`success`), rouge `#EF4444` (`danger`), fond `#F5F5F4` (`bg`), cartes blanches, bordure `#E7E5E4` (`border`). Le handoff cite `gris-bg #EFEEEC` ; on garde le `Colors.bg` existant (`#F5F5F4`) pour la cohérence app.
- Polices (`Fonts`) : `display` = Anton (gros chiffres), `welcome` = Barlow Condensed Italic 900 (titres/slogans), `ui*` = Inter (reste).
- **Avatars : noir OU jaune uniquement** sur ces écrans (règle visuelle du handoff). L'`<Avatar>` actuel colore par ligue → ajouter une variante **mono** (sans toucher les usages existants ailleurs).

## Migrations SQL nouvelles (récap, appliquées à la main)

| Fichier | Sous-projet | Contenu |
|---|---|---|
| `analytics_events.sql` | Fondations | Table `analytics_events` (user_id, event, props jsonb, created_at) + RLS insert self |
| `activity_week_stats.sql` | A | RPC « Ta semaine » (matchs 7j, forme V/D, Δ ELO) |
| `suggested_open_game.sql` | A | RPC Hero (1 partie ouverte à 1 place, score distance×niveau×imminence×amis) |
| `monthly_recap.sql` | B | Vue `monthly_recap` + helper ELO/duo/best-match |
| `monthly_recap_notify.sql` | D | `pg_cron` 1er du mois + webhook (à créer **à la main** dans le dashboard — aucun webhook n'existe aujourd'hui) |

## Git / réversibilité

- Travail **directement sur `main`** (préférence utilisateur), **sans branche**, **sans commit automatique**. Changements **additifs et réversibles**. Ne pas toucher aux changements non commités existants.
- Les specs ne sont **pas commitées automatiquement** (contrairement au défaut de la skill brainstorming) — sur demande seulement.

## Critères de réussite globaux

1. Les 4 écrans reproduisent le handoff hi-fi avec la lib UI existante.
2. Aucune régression de l'`ActivityFeed` actuel (filtre amis, 🔥, commentaires, `<MatchCard>`).
3. `tsc` passe à chaque sous-projet.
4. Règle no-storage respectée (Moments + partage 100 % locaux).
5. Toutes les nouvelles requêtes serveur passent par des vues/RPC versionnées.
