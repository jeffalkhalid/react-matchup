# Handoff : Landing page PAG MATCH

## Overview
Landing page web marketing pour **PAG MATCH** (by PADELACTIVEGAME), application mobile de matchmaking et de classement padel. Objectif : présenter l'app et orienter le visiteur vers le téléchargement (App Store / Google Play). Page one-page responsive, thème sombre, accent jaune, avec aperçus fidèles de l'app mobile.

## About the Design Files
Les fichiers de ce bundle sont des **références de design réalisées en HTML/CSS/JS (React via Babel in-browser)** — des prototypes qui montrent l'apparence et le comportement visés, **pas du code de production à copier tel quel**.

La tâche est de **recréer cette landing page dans l'environnement cible** avec ses patterns établis. Vu que l'app PAG MATCH est en **Expo / React Native + NativeWind (Tailwind)**, le site marketing est probablement à faire séparément (Next.js / React + Tailwind, ou Astro). Choisir le framework adapté au projet web ; réutiliser les **tokens de couleurs et polices déjà définis dans le repo de l'app** (`lib/colors.js`, `tailwind.config.js`) pour rester cohérent avec la charte.

## Fidelity
**High-fidelity (hifi).** Couleurs, typographie, espacements et composants sont définitifs et repris de la charte réelle de l'app. Les **aperçus d'écrans de l'app** (Accueil, Les Défis, Le classement) sont des recréations fidèles HTML/CSS du code source React Native — à terme on peut les remplacer par de vraies captures PNG exportées de l'app, mais la recréation sert de référence pixel.

## Sections (de haut en bas)

### 1. Nav (fixe)
- Hauteur 72px. Transparente en haut ; au scroll (> 30px) : fond `rgba(10,10,10,0.82)`, `backdrop-filter: blur(16px)`, bordure basse `rgba(255,255,255,0.10)`.
- Gauche : logo = **raquette** (`splash-racket.png`, 30px) + **wordmark** (`splash-wordmark.png`, hauteur 19px), collés (`margin-left:-2px`).
- Centre : liens « Fonctionnalités », « Comment ça marche », « Aperçu » (Manrope 700, 13.5px, `rgba(255,255,255,0.85)`, hover blanc).
- Droite : bouton « Télécharger » (pill jaune, voir Boutons).

### 2. Hero
Deux mises en page commutables (tweak `heroLayout`) :
- **split** (défaut) : grille 1.22fr / 0.78fr — copy à gauche, téléphone à droite.
- **centré** : tout centré, téléphone sous le texte.

Contenu :
- Pill « ● LA NOUVELLE ÈRE DU PADEL » (bordure + fond jaune translucides).
- Titre H1 (éditable via tweaks) : « Le Padel. » (blanc) + « Niveau Supérieur. » (jaune). Police **Anton**, `clamp(38px,4.4vw,60px)`, `line-height:1.04`, uppercase.
- Sous-titre : « Trouvez des partenaires à votre niveau, enregistrez vos matchs et grimpez au classement de votre club. » (18.5px, `#CBD5E1`, 500).
- Boutons stores (App Store + Google Play).
- Note : « ★★★★★ Rejoignez la communauté padel de votre club ».
- Visuel : maquette de téléphone (300px) affichant l'écran **Accueil** de l'app, animation `float` (translateY ±14px, 6s), léger tilt 4° en mode split. Halo radial jaune derrière.
- Décor : traînées (« speed trails ») jaunes en diagonale, grain léger.

### 3. Fonctionnalités (`#features`)
- Eyebrow « CE QUE VOUS OBTENEZ », titre « Tout pour mieux jouer » (Barlow Condensed Black Italic), paragraphe.
- Grille 3 colonnes (cartes), certaines en `span 2` :
  1. **Partenaires à votre niveau** (span2) — score de compatibilité (niveau, dispos, distance).
  2. **Classement du club** — chaque match fait évoluer la position.
  3. **Matchmaking instantané** — filtres niveau/créneau/distance.
  4. **Suivez votre progression** — évolution match après match.
  5. **Chat & organisation** (span2) — discuter, confirmer créneau/piste.
  6. **Communauté de club** — amis, alertes, événements.
- Carte : fond dégradé `#131315→#19191C`, bordure `rgba(255,255,255,0.10)`, radius 20px, padding 28px. Hover : `translateY(-5px)` + bordure jaune. Icône SVG dans boîte 50px (fond/bordure jaune translucides).

### 4. Comment ça marche (`#how`)
- Fond `linear-gradient(180deg,#0A0A0A,#0c0c0e)`, bordures haut/bas subtiles.
- 3 étapes (numéro Anton 60px, jaune translucide) :
  1. **Créez votre profil** — niveau + club, calibrage du niveau de départ.
  2. **Trouvez votre match** — suggestions compatibles, réserver créneau/piste.
  3. **Jouez & grimpez** — saisir le score, classement mis à jour automatiquement.

### 5. Aperçu de l'app (`#preview`)
- Eyebrow « APERÇU DE L'APP », titre « Pensée pour les joueurs ».
- Rail de 3 téléphones : gauche = **Le classement** (288px), centre = **Les Défis** (312px, surélevé), droite = **Accueil** (288px).

### 6. Bande de téléchargement (`#download`)
- Fond avec halo radial jaune bas. Pill « ● GRATUIT · iOS & ANDROID », titre « Prêt à passer au niveau supérieur ? », paragraphe, boutons stores.

### 7. Footer
- Fond `#08080A`. Grille 4 colonnes : marque (logo badge + texte), Produit, Légal (CGU, Confidentialité, Mentions légales, Cookies), Contact (contact@pagmatch.app, Support, Devenir club partenaire).
- Bas : « © 2026 PAG MATCH — by PADELACTIVEGAME. » + icônes sociales (Instagram, TikTok, Facebook).

## Aperçus d'écran de l'app (recréations fidèles)
Reprises 1:1 du code RN (`app/(tabs)/index.tsx`, `matchmaking.tsx`, `ranking.tsx`). À remplacer idéalement par de vraies captures PNG de l'app.

- **Accueil** : fond `#F8FAFC`. Pill logo sombre centrée (raquette+wordmark). Bannière profil sombre `#0A0A0A` radius 20 : avatar dégradé `#6366f1→#34d399` (radius 14), pastille + « LIGUE OR » (`#FBBF24`), nom en Barlow Condensed Black Italic, « Niveau 4.20 » jaune, cloche notif (badge rouge `#E5484D`), bande de stats 4 colonnes (Matchs/Victoires/Win%/Badges, valeurs Anton). Grille 2×2 de cartes blanches (radius 18, bordure `#B8C8D8`) : Matchmaking (icône radar, fond `#e0e7ff`), Saisir un score (stylo, `#d1fae5`), Classement (trophée, `#fef3c7`), À Venir (calendrier, `#ede9fe`, badge). Carte communauté sombre (avatars empilés, « Tes amis sur PagMatch », chevron jaune).
- **Les Défis** (matchmaking) : fond `#F5F5F4`. Header sombre arrondi bas (radius 26) : logo, titre « Les Défis » (Défis jaune), sous-titre, onglets Suggestions / Défis reçus. Toggle « ⚡ Compatibilité / 📊 Niveau ». Cartes suggestion blanches (radius 18, barre couleur tier en haut 3px) : **anneau de compatibilité** SVG (cercle de fond `#E7E5E4` + arc couleur tier, score au centre), avatar carré, nom, « Niv. X.X », pills (ligue, % W, ↔ Comp.), bouton « ⚡ Défier » noir. Tiers : ≥80 vert `#047857` « Match parfait », ≥60 `#E8A906` « Très compatible », ≥40 `#B45309`.
- **Le classement** : fond `#F5F5F4`. Header sombre : titre « Le classement » (classement jaune), « 128 joueurs classés », pill « Votre rang #7 », onglets Global/Amis. Barre de recherche + chips de filtre ligues (Toutes ligues actif noir, Diamant `#67E8F9`, Or `#FBBF24`, Argent `#A1A1AA`). **Podium top-3** sur fond sombre (ordre DOM 2-1-3, hauteurs/ tailles différentes, médaille or `#f59e0b`/argent `#94a3b8`/bronze `#b45309`, blocs teintés, emojis 🏆🥈🥉). Lignes joueurs : rang #N, avatar carré coloré, nom, pill ligue + « N matchs », niveau à droite. Ligne « Vous » surlignée jaune.

## Interactions & Behavior
- **Nav** : passe en état `scrolled` au scroll > 30px (listener `scroll`).
- **Reveal au scroll** : éléments `.reveal` passent de `opacity:0 / translateY(26px)` à visible via `IntersectionObserver` (seuil 0.12), transition 0.7s `cubic-bezier(.2,.7,.2,1)`, délais échelonnés.
- **Hover** : cartes fonctionnalités/ligues `translateY(-5px)` ; boutons `translateY(-2px)` + ombre accrue ; stores idem.
- **Hero phone** : flottement infini (désactivé sous `prefers-reduced-motion`).
- **Ancres** : nav et footer scrollent vers `#features`, `#how`, `#preview`, `#download` (`scroll-behavior:smooth`).
- **Tweaks** (panneau optionnel, à NE PAS porter en prod sauf besoin) : `heroLayout` (split/centré), `heroLine1`/`heroLine2` (textes), `accent` (couleur de marque, applique `--brand`).

## State Management
Page essentiellement statique. Seuls états runtime :
- `scrolled` (booléen nav).
- IntersectionObserver pour les reveals.
- (Tweaks : objet de préférences persistées — non nécessaire en prod.)
Aucune donnée distante. Les boutons stores pointent vers `#` (placeholders) — **à remplacer par les vraies URLs App Store / Google Play**. Liens légaux du footer = `#` placeholders.

## Design Tokens
Repris de `lib/colors.js` du repo app.
**Couleurs**
- Fonds sombres : `--ink #0A0A0A`, `--ink-alt #1A1A1C`, cartes `#131315` / `#19191C`, footer `#08080A`.
- Marque jaune : `--brand #FFC11A`, `--brand-bright #FFD23F`, `--brand-deep #E8A906`.
- Texte : blanc `#FFFFFF`, dim `#CBD5E1`, muted `#8A8A93`, faint `#5A5A62`.
- Bordures : `rgba(255,255,255,0.10)`, `rgba(255,255,255,0.06)` ; jaune `rgba(255,193,26,0.35)` / fill `rgba(255,193,26,0.10)`.
- Ligues : Diamant `#67E8F9`, Or `#FBBF24`, Argent `#A1A1AA`, Bronze `#E8A906`, Découverte `#71717A`.
- Écrans app (clairs) : bg `#F8FAFC` / `#F5F5F4`, cartes blanches, bordure `#E7E5E4` / `#B8C8D8`, texte `#0A0A0A` / `#52525B` / `#A1A1AA`.

**Typographie** (Google Fonts)
- **Anton** (display) — titres hero, chiffres/stats.
- **Barlow Condensed** 900 *italic* (`welcome`) — titres de section, noms, titres d'écrans.
- **Inter** 400–900 (UI générale).
- **Manrope** 600–800 (uppercase : eyebrows, nav, boutons).

**Échelles**
- Spacing : 4 / 8 / 16 / 24 / 32 / 48.
- Radius : 8 / 12 / 16 / 20 / 24 / 999 (pill).
- Ombres : boutons jaune `0 8px 28px rgba(255,193,26,.30)` (hover `0 14px 38px …,.42`) ; cartes app `0 8px 18px rgba(0,0,0,.25)`.

**Boutons**
- `.btn-brand` : fond `--brand`, texte `#0A0A0A`, pill, Manrope 800, ombre jaune.
- `.btn-ghost` : fond `rgba(255,255,255,0.06)`, bordure `rgba(255,255,255,0.18)`.
- Store badge : fond blanc, radius 13, logo SVG + « Télécharger sur / App Store » (resp. « Disponible sur / Google Play »).

## Assets
Dans `assets/` (importés du repo `jeffalkhalid/react-matchup`) :
- `auth/splash-racket.png` — icône raquette jaune (logo nav + écrans app).
- `auth/splash-wordmark.png` — wordmark « PAGMATCH » blanc/jaune.
- `pagmatch-logo.png` — badge circulaire complet (footer).
- `favicon.png` — favicon.
- Icônes (radar, stylo, trophée, calendrier, cloche, étoile, recherche, sociales) : **SVG inline** — pas de fichiers.
Logos d'écran et badges stores : SVG inline dans le code.

## Files
- `PAG MATCH Landing.html` — point d'entrée (fonts, scripts, montage React).
- `styles.css` — tokens + styles de la page (nav, hero, sections, footer, maquettes de téléphone).
- `appscreens.css` — styles des 3 écrans d'app recréés.
- `app.jsx` — composants de page (Nav, Hero, Features, How, Preview, CtaBand, Footer) + intégration Tweaks.
- `mockups.jsx` — composants des écrans app (HomeScreen, MatchScreen, RankScreen, CompatRing, StatusBar).
- `tweaks-panel.jsx` — panneau de réglages (optionnel, dev/preview uniquement).
- `assets/` — images listées ci-dessus.

## Avatars (traitement de marque)
Les avatars des écrans d'app utilisent volontairement un **mix noir / jaune** (au lieu d'une palette multicolore), pour rester dans la charte :
- **Jaune** : fond `#FFC11A`, lettre `#0A0A0A` (utilisé sur fonds sombres : bannière accueil, podium, et en alternance).
- **Noir** : fond `#0A0A0A`, lettre `#FFFFFF` (sur cartes/lignes claires, en alternance avec le jaune).
- Variante « gris foncé » `#27272A` (lettre blanche) pour différencier des avatars empilés sur fond noir (carte communauté).
Alterner noir/jaune d'un avatar à l'autre dans les listes.

## Captures d'écran
Voir le dossier `screenshots/` (hero + section Aperçu) — à régénérer si absent (service de capture momentanément indisponible au moment du bundle).

## Notes
- Le **copy marketing** ne mentionne volontairement pas « ELO », « ligue » ni « 1 tap » (choix produit). Ces termes n'apparaissent que dans les **captures de l'app** (UI réelle).
- Réutiliser les tokens existants du repo app (`lib/colors.js`, `tailwind.config.js`) pour garantir la cohérence de marque.
- React + Babel in-browser est un choix de prototypage ; en prod, compiler/bundler normalement.
