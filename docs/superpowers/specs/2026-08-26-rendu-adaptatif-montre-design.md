# Rendu adaptatif de l'app montre — conception

**Date** : 2026-08-26
**Statut** : validé section par section avec le user, prêt pour le plan d'implémentation
**Prérequis** : `2026-08-25-app-montre-design.md` (app Connect IQ, en prod sur `epix2`)

---

## 1. Objectif

Faire tourner l'app montre PagMatch **sur les 57 modèles Garmin** connus du SDK, avec un
affichage irréprochable sur chacun — pas seulement « qui ne plante pas ».

Exigence explicite du user (2026-08-26) : *« l'idée est que ça soit possible partout, pas
de compromis, sinon ce n'est pas sérieux pour une feature premium »*. Le mode point par
point étant destiné à devenir payant, un écran tronqué n'est pas un détail cosmétique :
c'est un défaut de produit.

## 2. Le problème, mesuré

L'app actuelle écrit ses positions et ses polices **en dur**, réglées à l'œil sur une seule
montre. Trois défauts du même type ont été trouvés en une seule journée de test réel :

1. des lignes préexistantes poussées vers le bord, perdant 18 % de largeur (revue finale) ;
2. une marge verticale réduite de moitié sous la plus haute police (revue finale) ;
3. des messages **rognés aux deux bouts** par le biseau rond (constaté au poignet).

Aucun n'était détectable autrement qu'en regardant l'appareil. Sur un écran **rond**, la
largeur utile à la hauteur `y` vaut la corde `2·√(r² − (y − r)²)` : elle s'effondre en
haut et en bas. À 84 % de la hauteur d'un écran de 416 px il ne reste que ~305 px, soit
une vingtaine de caractères.

**Le parc réel** (57 modèles du SDK, 15 familles d'écran) :

| Famille | Modèles | Exemples |
|---|---|---|
| `round-240x240` | 13 | fenix5, fenix5plus, fenix5x… |
| `round-260x260` | 8 | fenix6, fenix6pro, fenix7… |
| `round-416x416` | 6 | **epix2**, fenix843mm, fenix943mm… |
| `round-280x280` | 6 | fenix6xpro, fenix7x, fenix8solar51mm… |
| `round-454x454` | 5 | epix2pro51mm, fenix847mm, fenix947mm… |
| `round-390x390` | 4 | epix2pro42mm, venud, vivoactive5, vivoactive6 |
| `round-218x218` | 3 + 2 | fenix5s, vivoactive4s ; fenix3 (4 bits) |
| `rectangle-320x360` | 2 | venusq2, venusq2m |
| `rectangle-240x240` | 2 | venusq, venusqm |
| `rectangle-205x148` | 2 | epix (gen 1), vivoactive |
| autres | 4 | etrextouch, fenix9pro51mm (466), venux1 (448×486), vivoactive_hr |

**Facteur trois** entre le plus petit écran (148 px) et le plus grand (486 px), deux formes,
des profondeurs de couleur de 4 à 16 bits, et des montres **sans boutons haut/bas**.

Aucune valeur écrite en dur ne peut être juste sur cet ensemble. C'est le constat qui
fonde toute cette conception.

## 3. Décisions produit (validées)

1. **Les 57 modèles, sans exception.** Le user a écarté explicitement la proposition d'une
   frontière assumée. Décision notée et appliquée telle quelle.
2. **Priorité au score.** Quand la place manque, le score reste ; le reste s'efface.
3. **Saisie tactile = toucher l'équipe** qui a gagné le point, moitié haute ou basse.
4. **Approche retenue : un moteur de rendu qui mesure**, plutôt que des réglages par
   famille ou les fichiers de mise en page natifs. Ces deux alternatives encodent des
   hypothèses qui casseront sur le prochain modèle Garmin ; seul un rendu qui mesure tient
   sur du matériel qui n'existe pas encore.

Contrepartie acceptée : **l'écran n'aura pas la même allure partout**, et on ne pourra plus
régler un pixel à la main — on corrige la règle, jamais la valeur.

## 4. Le composant de rendu

Un module unique, `Layout`, par lequel passent **toutes** les vues.

**Ce qu'il connaît**, demandé à la montre et non supposé :
- `dc.getWidth()` / `dc.getHeight()` — les dimensions réelles ;
- `System.getDeviceSettings().screenShape` — ronde, semi-ronde ou rectangulaire ;
- `System.getDeviceSettings().isTouchScreen` — la présence du tactile.

**Ce qu'il calcule :**

- `usableWidth(dc, y)` — la largeur réellement disponible à cette hauteur.
  Écran rond : la corde, `2·√(r² − (y − r)²)`, moins une marge de sécurité.
  Rectangle : la largeur pleine moins la marge.
  Semi-rond : traité comme rond, la marge absorbant l'écart.
- `fitFont(dc, texte, largeurMax, échelle)` — essaie les polices de la plus grande à la
  plus petite via `dc.getTextWidthInPixels`, renvoie la première qui tient, ou `null`.
- `drawFit(dc, y, texte, échelle, couleur)` — dessine avec la police retenue, ou ne dessine
  **rien** et le signale. Jamais de texte tronqué.

**Ce qu'il ne fait pas** : décider *quoi* afficher. Les vues déclarent leur contenu et son
importance ; `Layout` décide seulement *comment*.

## 5. La règle de priorité

Le rendu attribue l'espace vertical dans cet ordre et s'arrête quand il est épuisé :

1. **Le score set par set** — toujours présent, dans la plus grande police qui tient.
   C'est le seul élément consulté entre deux points.
2. **Le score du point en cours** (mode points) — c'est ce qui justifie ce mode, et il
   devient une fonction payante.
3. **Les noms d'équipes**, avec dégradation progressive :
   noms complets → prénoms → initiales (`A&K`) → supprimés.
4. **Le message d'état** — raccourci, puis supprimé.

Les messages restent **sous 20 caractères** par construction, même quand la place le
permet : la brièveté sert la lisibilité en plein soleil, un point en main.

## 6. Saisie selon l'appareil

| Appareil | Marquer | Annuler | Valider |
|---|---|---|---|
| Boutons (fenix, epix, forerunner) | HAUT / BAS | START | appui long HAUT |
| Tactile **et** boutons (venu, vivoactive) | toucher la moitié haute / basse **ou** HAUT / BAS | bouton disponible | appui long HAUT |
| Tactile sans bouton haut/bas | toucher la moitié haute / basse | bouton physique (START ou équivalent) | appui long sur l'écran |

⚠️ **Undo et validation ne doivent JAMAIS partager le même geste.** Une première rédaction
attribuait l'appui long à la fois à l'annulation et à la validation sur les montres
tactiles : c'eût été une action destructrice et une action irréversible derrière un geste
identique. Sur ces appareils, l'annulation reste donc sur un **bouton physique**.

Cette répartition suppose que **toute montre Garmin possède au moins un bouton** (ne
serait-ce que BACK). C'est vrai de tous les modèles du SDK, mais à **vérifier
explicitement** pendant l'implémentation : si un modèle sans aucun bouton existait, sa
saisie serait une décision de conception à part entière, pas une valeur par défaut à
improviser.

Le principe est identique partout : **le geste désigne l'équipe telle qu'elle est affichée**,
en haut ou en bas. Rien à mémoriser.

Le texte d'aide s'adapte à l'appareil (« HAUT / BAS » ou « Touche l'equipe »). Aujourd'hui
il est faux sur toutes les montres tactiles.

## 7. Couleur et lisibilité

**Règle : la couleur décore, elle n'informe jamais.** Les profondeurs vont de 4 à 16 bits ;
sur une fenix3, le jaune devient une nuance indistincte.

Ce qui distingue les deux équipes est leur **position** — haut et bas — jamais leur teinte.
La règle vaut aussi pour les états : un message d'erreur doit se lire dans son texte, pas
dans sa couleur.

## 8. Ce que deviennent les vues

`SessionView`, `PairingView` et `ConfirmView` perdent toutes leurs positions et polices
écrites en dur. Elles déclarent une liste d'éléments — contenu, importance, rôle — et
délèguent le dessin.

C'est une restructuration, pas un ajustement : c'est le but. Tant qu'une vue écrit
`h * 84 / 100` et `FONT_XTINY`, elle réintroduit le défaut qu'on élimine.

## 9. Vérification

Deux niveaux, tous deux sans matériel.

**Compilation des 57 modèles.** Mécanique, automatisable, elle attrape toute erreur de
cible ou d'API absente sur un modèle. Un modèle qui ne compile pas ne peut pas être livré.

**Vérification visuelle sur un modèle par famille d'écran** (15 captures). Un **mode
démonstration temporaire** affiche un match type — trois sets, noms longs, score de point,
message d'état — sans réseau ni appairage, puisque le simulateur n'a ni jeton ni session.
Chaque famille est lancée dans le simulateur, l'écran est capturé, et **les images sont
regardées une par une**.

Ce mode est **retiré avant livraison** ; sa présence dans le code final serait un défaut.

Sans cette passe visuelle, on ne pourrait affirmer que « ça devrait marcher » — ce qui ne
répond pas à l'exigence posée.

## 10. Hors périmètre

- Publication sur la boutique Connect IQ (chantier distinct, sans lequel l'app reste
  installable par le seul développeur).
- Enregistrement du match comme activité Garmin, fréquence cardiaque (idée séparée).
- Télécommande par notification pour Apple Watch et Wear OS (plan jamais écrit).
- Toute évolution fonctionnelle : cette conception ne change **que** le rendu et la saisie.

## 11. Points de vigilance

- **Vérifier les API avant de s'appuyer dessus** : `screenShape`, `isTouchScreen`,
  `getTextWidthInPixels`, `getFontHeight`, `onTap`, `onHold` sont attendues à ces noms,
  mais le SDK 9.x nous a déjà démenti trois fois (type `watch-app`, callbacks à typer,
  `hidden` interdit sur les fonctions de module). Lire la documentation, ne pas présumer.
- **Les polices numériques ne contiennent pas tous les glyphes.** `FONT_NUMBER_*` est
  conçue pour des chiffres ; le score `« 6 4 1 »` fonctionne aujourd'hui avec ses espaces,
  mais toute évolution du format doit être vérifiée à l'écran, pas seulement compilée.
- **Aucun accent dans les chaînes dessinées** — contrainte déjà en vigueur, elle reste.
- **`Layout` doit rester sans état** : il mesure et dessine, il ne mémorise rien. Un cache
  de polices par appareil serait une optimisation prématurée et une source de bugs.
- La marge de sécurité sur la corde doit être **généreuse** : les métriques de police
  Garmin surestiment l'encre réelle, donc un calcul au pixel près donnerait une fausse
  assurance dans un sens comme dans l'autre.
