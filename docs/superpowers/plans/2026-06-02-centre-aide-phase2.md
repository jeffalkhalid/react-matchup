# Centre d'aide cible → prod (Phase 2) Implementation Plan

> **For agentic workers:** exécution inline (executing-plans). Étapes en cases à cocher.

**Goal:** Remplacer le rendu legacy du bouton « ? » par la cible : bottom sheet hub → détail → FAQ, contextuel, clair+sombre.

**Architecture :** Réutilise la fondation Phase 1 (`useGuideTheme`, `RUBRIC`, `ILLUST`, `Pill`/`miniCard`, icônes). Nouveau `components/guide/HelpCenter.tsx` (sheet hub↔détail) + sous-composants `help/`. La coquille `components/HelpCenter.tsx` (bouton « ? » + Modal) repointe dessus. `guideDeck.tsx` et `FeatureGuide.tsx` supprimés.

**Décisions :** hub en **liste** ; rubrique **Recherche → /(tabs)/ranking**. Routes : lobby→lobby, défis→matchmaking, ranking/recherche→ranking, chats→chats ; welcome/badges/stories sans CTA.

**Tests :** vérification manuelle Expo (clair/sombre, navigation, FAQ, CTA route, contextualisation).

---

## P2-1 : Déplacer GUIDE_KEY

- [ ] `lib/guideTheme.ts` : ajouter `export const GUIDE_KEY = 'matchup_guide_rn_v1';`
- [ ] `app/(tabs)/_layout.tsx` : remplacer `import { GUIDE_KEY } from '../../components/guideDeck';` par `import { GUIDE_KEY } from '../../lib/guideTheme';`

## P2-2 : Icônes lifeBuoy + settings

- [ ] `components/community/icons.tsx` : ajouter `'lifeBuoy' | 'settings'` au type + cas (paths Lucide).

## P2-3 : Illustrations Welcome + Chats

- [ ] Créer `components/guide/illustrations/Welcome.tsx` (port `IllustWelcome`, illustrations.jsx:333-361).
- [ ] Créer `components/guide/illustrations/Chats.tsx` (port `IllustChats`, illustrations.jsx:154-193).
- [ ] `components/guide/illustrations/index.ts` : ajouter `welcome`, `chats` à `ILLUST`.

## P2-4 : Données d'aide

- [ ] Créer `components/guide/help/data.ts` : `HELP` (étapes par rubrique, guide.jsx:6-55), `FAQ` (guide.jsx:57-68), `HUB_RUBRICS` (ordre : lobby, recherche, defis, ranking, chats, badges, stories, welcome), `ROUTE_TO_RUBRIC`, `RUBRIC_ROUTE` (rubrique→route Expo ; null si aucune).

## P2-5 : HelpHub

- [ ] Créer `components/guide/help/HelpHub.tsx` : header (kicker + titre + ✕), bloc « Dépannage & FAQ » (dégradé via `GradientRect`/fond accent), liste de `RubricRow` (emoji + titre + sub + chevron, badge « Tu es ici »), contexte remonté en tête.

## P2-6 : HelpDetail + FaqItem

- [ ] Créer `components/guide/help/FaqItem.tsx` : accordéon (chevron rotatif, ouverture animée via `LayoutAnimation` ou `Animated` height).
- [ ] Créer `components/guide/help/HelpDetail.tsx` : header (‹ retour · titre · ✕), tag+titre, illustration (si dispo), carte « Comment ça marche » (étapes numérotées), CTA route (si `RUBRIC_ROUTE[rkey]`), Précédent/Suivant ; cas `faq` = accordéon + pied « Réglages › Aide ».

## P2-7 : HelpCenter (conteneur)

- [ ] Créer `components/guide/HelpCenter.tsx` : état `active` (null = hub), transition slide hub↔détail (`Animated` translateX), `onClose`/`onRoute`. Props : `{ contextRoute, onClose, onRoute }`.

## P2-8 : Repointer la coquille

- [ ] `components/HelpCenter.tsx` : garder le bouton « ? » + `Modal pageSheet` ; remplacer `GuideDeck` par `<HelpCenterSheet contextRoute={...} onClose={close} onRoute={(r)=>{close(); router.push(r);}} />`. Dériver `contextRoute` depuis `useSegments()`. Retirer l'import `guideDeck`.

## P2-9 : Cleanup + typecheck

- [ ] Supprimer `components/guideDeck.tsx` et `components/FeatureGuide.tsx`.
- [ ] `npx tsc --noEmit` → 0 erreur sur les fichiers touchés.
