# Portage de la cible Onboarding & Centre d'aide en production

**Date :** 2026-06-02
**Statut :** Validé — prêt pour le plan d'implémentation
**Approche :** A (port fidèle, modulaire), livraison **phasée** — Phase 1 = Onboarding (ce document), Phase 2 = Centre d'aide (annexe, différé)

---

## Contexte & objectif

Le dossier `design_handoff_onboarding_aide/` contient la **cible de design** (prototype HTML/React in-browser) pour deux surfaces de l'app **PagMatch** (`react-matchup`, React Native / Expo) :

1. **Onboarding de premier lancement** — carrousel plein écran (8 écrans).
2. **Centre d'aide contextuel** — bouton « ? » ancré qui ouvre une feuille **hub → détail → FAQ**.

Le code de prod actuel ([components/guideDeck.tsx](../../../components/guideDeck.tsx)) est une **version condensée et divergente** : un unique deck linéaire de 7 slides, partagé par l'onboarding ([OnboardingCarousel.tsx](../../../components/OnboardingCarousel.tsx)) et l'aide ([HelpCenter.tsx](../../../components/HelpCenter.tsx)), clair uniquement, sans hub ni les slides recherche/stories/final.

**Objectif :** recréer la cible dans le codebase RN, fidèlement (pixel près), en réutilisant les patterns et tokens existants.

### Écarts cible ↔ prod actuel
| | Cible (prototype) | Prod actuel |
|---|---|---|
| Onboarding | 8 écrans (welcome, lobby, recherche, defis, ranking, social, stories, final) | 7 slides linéaires |
| Centre d'aide | Hub de rubriques → détail → FAQ accordéon, contextuel | Même deck linéaire réutilisé |
| Thème | Clair **et** sombre | Clair uniquement |
| Slides recherche / stories / final notifs | Présents | Absents |

---

## Décisions validées

- **Dark mode :** porter **clair + sombre**. Piloté par `useColorScheme()` (suit l'OS, **pas** de toggle in-app). Isolé dans les composants du guide — aucun impact sur le reste de l'app.
- **Notifications push :** l'écran final câble la **vraie demande de permission** via le pipeline existant ([hooks/usePushNotifications.ts](../../../hooks/usePushNotifications.ts)).
- **Illustrations :** porter les **mini-mockups fidèlement** en composants RN dédiés (pas de branchement sur les vrais écrans).
- **Parcours onboarding :** complet (8 écrans). Le mode « compact 3 écrans » du prototype n'est pas porté (tweak d'exploration).
- **Livraison :** phasée, **onboarding d'abord**. Le centre d'aide (Phase 2) garde l'ancien rendu jusqu'à son portage.

---

## Architecture

Construction d'une **fondation partagée** (réutilisée par les 2 phases), puis l'onboarding en Phase 1.

```
lib/
  guideTheme.ts          NOUVEAU : theme(mode) clair/sombre + RUBRIC (accents/emoji/titres)
                         piloté par useColorScheme() — isolé du reste de l'app
components/
  community/icons.tsx    ÉTENDU : glyphes Lucide manquants
  guide/
    illustrations/       NOUVEAU : mini-mockups RN + _shared
    Onboarding.tsx       NOUVEAU (Phase 1) : carrousel 8 écrans
    HelpCenter.tsx       PHASE 2 : bottom sheet hub↔détail↔FAQ
  OnboardingCarousel.tsx coquille fine → <Onboarding onDone=… /> (signature inchangée)
  HelpCenter.tsx         inchangé en Phase 1 (garde l'ancien guideDeck) ; remplacé en Phase 2
  guideDeck.tsx          conservé tant que HelpCenter l'utilise ; retiré en Phase 2
hooks/
  usePushNotifications.ts REFACTOR : extraire registerForPushAsync() réutilisable
```

**Principes :**
- **Dark mode isolé :** seuls les composants du guide consomment `guideTheme.ts`. Pas de régression possible ailleurs.
- **Phase 1 ne casse rien :** `OnboardingCarousel.tsx` garde sa signature `{ onDone }`, donc [app/(tabs)/_layout.tsx:314](../../../app/(tabs)/_layout.tsx) et `GUIDE_KEY` restent intacts. Le bouton « ? » continue d'afficher l'ancien rendu jusqu'à la Phase 2.
- **Réutilisation :** on étend le composant `Icon` Lucide existant ([components/community/icons.tsx](../../../components/community/icons.tsx)) ; les constantes (brand, ligues, polices) viennent de [lib/theme.ts](../../../lib/theme.ts) existant.

---

## Phase 1 — Onboarding

### Composant `components/guide/Onboarding.tsx`
Carrousel plein écran, 8 écrans, monté au 1er lancement via la coquille `OnboardingCarousel`.

#### Les 8 écrans
| # | Type | Contenu | Illustration |
|---|---|---|---|
| 1 | hero | Lockup raquette+wordmark+trails · « Ton terrain de jeu pour défier la ville » | — (PNG existants `assets/auth/`) |
| 2 | feature | **Lobby** — Trouve ta partie en quelques secondes | `IllustLobby` |
| 3 | feature | **Recherche** — Trouve les bons joueurs | `IllustRecherche` |
| 4 | feature | **Défis** — Lance un défi à n'importe qui | `IllustDefi` |
| 5 | feature | **Classement & Ligues** — Grimpe les ligues | `IllustLigues` |
| 6 | feature | **Chats & Palmarès** — Joue, échange, gagne des badges | `IllustBadges` |
| 7 | feature | **Stories & Partage** — Partage tes exploits | `IllustStories` |
| 8 | final | « Prêt à jouer ? » + demande notifs | `IllustNotif` |

Textes (tags, titres, bodies) repris de `design_handoff_onboarding_aide/onboarding.jsx` (fonction `obSlides`).

#### Structure d'un écran
- **Top chrome :** chevron retour (si i>0) · dots de progression (point actif = pill 22px accent) · bouton **« Passer »** (si pas dernier) → `onDone`.
- **Hero :** halo radial jaune, lockup animé (raquette + trails + wordmark selon thème), titre Barlow Condensed italic, sous-titre Inter.
- **Feature :** zone illustration (halo `soft` couleur rubrique + mockup) → tag pill (emoji+nom) → titre 27/800 → body.
- **Final :** `IllustNotif` (stack de toasts), icône cloche, « Prêt à jouer ? », texte notifs.
- **Bottom CTA :** `Découvrir` (écran 1) / `Continuer` (2–7) ; sur le final → **`Activer & jouer`** + **`Plus tard`**.

#### Navigation & animations (patterns RN déjà en place)
- **Swipe :** `PanResponder` (seuil 52px, rubber-band aux bords) + `Animated` translateX du pager — comme l'actuel `guideDeck`.
- **Entrées en cascade :** composant interne `Reveal` (fade + translateY échelonné) rejoué quand l'écran devient actif.
- **Easing :** `cubic-bezier(.32,.72,0,1)` (pager) / `(.22,.8,.3,1)` (entrées). `useNativeDriver: true`.
- **Accessibilité :** si `AccessibilityInfo.isReduceMotionEnabled()` → anims décoratives désactivées.

#### Câblage des notifications
- Refactor de [usePushNotifications.ts](../../../hooks/usePushNotifications.ts) : extraire **`registerForPushAsync(playerId)`** (channel Android + `getPermissionsAsync`/`requestPermissionsAsync` + `getExpoPushTokenAsync` + save DB). Le hook l'appelle au montage comme aujourd'hui (comportement inchangé pour les utilisateurs déjà onboardés).
- **`Activer & jouer`** → `await registerForPushAsync(player.id)` puis `onDone()`.
- **`Plus tard`** → `onDone()` sans demander.
- L'OS ne montre l'invite qu'une fois ; pas de double-prompt gênant (un second appel sur permission déjà accordée/refusée est idempotent).
- `onDone` reste = `finishOnboarding` du layout (persiste `GUIDE_KEY = 'matchup_guide_rn_v1'`).

---

## Fondation partagée

### `lib/guideTheme.ts`
Port de `theme(mode)` + `RUBRIC` du prototype (`kit.jsx`). Hook `useGuideTheme()` lit `useColorScheme()` et renvoie les tokens de surface :

```
light → { bg:'#F5F5F4', card:'#FFFFFF', border:'#E7E5E4', chip:'#F6F5F3',
          text:'#0A0A0A', sub:'#52525B', muted:'#A1A1AA',
          ctaBg:'#0A0A0A', ctaFg:'#FFFFFF' }   // CTA noir en clair
dark  → { bg:'#0A0A0A', card:'#151518', border:'#28282E', chip:'#202026',
          text:'#FFFFFF', sub:'#8A8A92', muted:'#5D5D66',
          ctaBg:'#FFC11A', ctaFg:'#0A0A0A' }   // CTA jaune en sombre
```

- `RUBRIC` : pour chaque rubrique `{ accent, soft, emoji, title, sub }` (lobby bleu `#2563EB`, défis orange `#D97706`, recherche indigo `#4F46E5`, ranking vert `#059669`, chats cyan `#0891B2`, badges ambre `#B45309`, stories magenta `#DB2777`, faq violet `#7C3AED`, welcome doré `#E8A906`).
- Constantes communes (brand `#FFC11A`, ligues, polices) **réutilisées depuis [lib/theme.ts](../../../lib/theme.ts)** — pas de duplication. `guideTheme.ts` n'ajoute que les surfaces clair/sombre + accents rubrique.

### `components/guide/illustrations/`
Port RN des **7 mockups Phase 1** (lobby, recherche, defis, ranking, badges, stories, notif), un fichier chacun, + module partagé :
- `_shared.tsx` : `MiniAvatar` (initiales sur dégradé de ligue), `miniCard` (carte blanche flottante + ombre), `miniLabel`, mini-`Pill`.
- Les mockups restent en **carte claire flottante quel que soit le thème** (choix « product feel » du prototype : `#FFFFFF` + ombre) → visuellement stables en dark mode.
- Fidélité pixel : dimensions/rayons/couleurs repris de `illustrations.jsx`. Émojis et dégradés de ligue identiques (réutiliser `LeagueGradients` de [lib/colors.js](../../../lib/colors.js)).

> `IllustWelcome` et `IllustChats` ne sont **pas** portés en Phase 1 (utilisés uniquement par le centre d'aide, Phase 2).

### Icônes — extension de [components/community/icons.tsx](../../../components/community/icons.tsx)
Ajouter à l'`IconName` existant les glyphes Lucide utilisés par l'onboarding : `swords`, `radar`, `zap`, `bellRing`, `trophy`, `send`, `qr`, `sliders`, `trendingUp`, `chevronDown`, `arrowLeft` (paths Lucide officiels). `lifeBuoy` / `settings` réservés à la Phase 2.

---

## Tests & vérification

Le projet n'a pas de setup de tests RN. **Vérification manuelle via Expo** :
- Rendu des 8 écrans en clair **et** sombre.
- Swipe (seuil, rubber-band aux bords), dots, chevron retour, « Passer ».
- Animations d'entrée + comportement avec « réduire les animations » activé.
- Sur build natif : « Activer & jouer » déclenche l'invite système et enregistre le token ; « Plus tard » ne demande rien.
- Premier lancement : onboarding affiché une fois, puis `GUIDE_KEY` persiste → non réaffiché.

Les composants restent purs/isolés pour rester testables si un framework est ajouté plus tard.

---

## Annexe — Phase 2 (centre d'aide, différé)

Documenté pour mémoire ; **non implémenté** dans ce cycle.

- **`components/guide/HelpCenter.tsx`** remplace l'actuel : bottom sheet avec navigation **hub → détail → FAQ** (slide horizontale, easing signature).
- **Hub** (`HelpHub`) : bloc proéminent « Dépannage & FAQ » (dégradé violet→rouge) + liste/grille de rubriques. Contextualisation « Tu es ici » via mapping `ROUTE_TO_RUBRIC` (route courante → rubrique mise en avant et remontée en tête).
- **Détail** (`HelpDetail`) : tag + titre + illustration + carte « Comment ça marche » (étapes numérotées) + CTA route (ferme la feuille, `router.push`) + Précédent/Suivant entre rubriques.
- **FAQ** : accordéon (une entrée ouverte à la fois), 5 entrées, pied « Réglages › Aide ».
- Illustrations additionnelles à porter : `IllustWelcome`, `IllustChats`.
- Icônes additionnelles : `lifeBuoy`, `settings`.
- Au terme de la Phase 2 : `guideDeck.tsx` supprimé, `slideForSegment` remplacé par le mapping route→rubrique, alias `FeatureGuide.tsx` mis à jour ou retiré.
