# Sous-projet C — États vides (3 frames)

**Date :** 2026-06-16
**Statut :** Design validé, prêt pour le plan d'implémentation
**Index :** `2026-06-16-activite-refonte-index-design.md`
**Handoff :** `design_handoff_activity_tab/designs/03-Etats-Vides.dc.html` · screenshot `screenshots/05-etats-vides.png`

## Contexte

Les états vides ne sont **pas un écran séparé** : ce sont des **branches conditionnelles** du Feed (sous-projet A) et du Bilan (sous-projet B). Ils dépendent donc de A et B et se livrent après.

## Objectif

Trois variantes, jamais culpabilisantes, toujours **1 seul CTA principal**, header premium maintenu.

## Frame A — Nouvel utilisateur (`activity_empty_onboarding`)
**Trigger** : compte créé, 0 match enregistré.
- Hero « Crée ton 1ᵉʳ match » **remplace** `JoinHeroCard`.
- Card onboarding 3 étapes (checklist non cochée) : Créer 1ᵉʳ match (+50 pts) · Inviter 3 amis · Évaluer ton niveau (5 questions).
- Section « Rejoins un match » : 1 card match ouvert < 5 km (réutilise `getSuggestedGame`/`getWeekendGames`).
- Footer dashed : « Ton fil se remplit après ton 1ᵉʳ match ».
- **Pas de Moments, pas de Top duo, pas de Bilan.**

## Frame B — Fil calme (`activity_empty_friends_inactive`)
**Trigger** : ≥1 ami, 0 activité d'eux sur 7 jours.
- `WeekStatsCard` honnête : 1 V + 3 cases dashed.
- Hero « Élargis ton cercle » — « 8 joueurs de ton niveau jouent à < 5 km ».
- Avatars amis **grisés `opacity: 0.4`** (signal « endormi »).
- Empty card « Personne n'a joué cette semaine » + 2 boutons « Pinger {prénom} » (notif douce via `notifyPlayers`).
- Section découverte « Joueurs autour de toi » (3+ cards horizontal scroll) → réutilise `getSuggestions` (`lib/community.ts`).

## Frame C — Bilan mois calme (`bilan_empty_low_activity`)
**Trigger** : ouverture du Bilan avec < 3 matchs sur le mois sélectionné.
- **1 slide unique** (pas 7).
- Fond `linear-gradient(160deg, #1F2937 → #0A0A0A)`.
- Header « Mois en sommeil 🌱 » (ton non-culpabilisant).
- Highlight de la **métrique flatteuse** (ex : 100 % winrate sur 1 match).
- Stats card : matchs · V/winrate · ELO (ELO en gris atténué).
- Card « 🌱 Pas de quoi rougir » + CTA principal « Recommencer {mois} sur les chapeaux → ».
- CTAs secondaires « Voir {mois précédent} » / « Pinger un ami ».
- **Pas de bouton Partager.**

## Règles transversales
1. Toujours 1 CTA principal (pas de chemins concurrents).
2. Garder la promesse visible (header premium maintenu).
3. Jamais culpabilisant (« calme », pas « mauvais »).

## Composants & détection
- `components/activity/EmptyHero.tsx` paramétrable (variante onboarding / élargis-cercle).
- Détection d'état dans `lib/activityFeed.ts` : `getActivityState(uid)` → `'onboarding' | 'friends_inactive' | 'nominal'` (à partir du nb de matchs et de l'activité amis 7 j déjà chargée).
- Bilan : `lib/bilan.ts` marque `recap.lowActivity = matches < 3` → `app/bilan/[month].tsx` rend la slide unique au lieu des 7.

## Fichiers touchés
| Fichier | Action |
|---|---|
| `app/(tabs)/activite.tsx` | Brancher l'état (A/B) selon `getActivityState` |
| `components/activity/EmptyHero.tsx` | **Nouveau** |
| `components/activity/OnboardingChecklist.tsx` | **Nouveau** (frame A) |
| `components/activity/QuietFeedCard.tsx` | **Nouveau** (frame B : empty + Pinger) |
| `components/bilan/SlideLowActivity.tsx` | **Nouveau** (frame C) |
| `lib/activityFeed.ts` | `getActivityState` |
| `lib/bilan.ts` | flag `lowActivity` |

## Critères de réussite
1. 0 match → frame A (sans Moments/Duo/Bilan).
2. Amis silencieux 7 j → frame B (avatars grisés, Pinger, découverte).
3. Bilan < 3 matchs → 1 slide non-culpabilisante, sans Partager.
4. Toujours exactement 1 CTA principal par frame.
5. `tsc` passe.

## Hors-scope
- Personnalisation fine du copy par segment au-delà des 3 frames.
- Récompenses réelles des étapes onboarding (« +50 pts ») si pas déjà câblées.
