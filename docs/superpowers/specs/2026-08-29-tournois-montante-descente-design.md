# Tournois montante / descente — conception

**Date** : 2026-08-29
**Statut** : **réécrite** sur le règlement de référence fourni par le user, qui remplace la
version précédente issue des seules maquettes.
**Source** : le règlement PAGMATCH « Montante / Descente » et les règles de gestion écrites
par le user (2026-08-29). En cas de doute, ce texte fait foi.

> **Pourquoi une réécriture.** Une première conception avait été tirée des maquettes seules,
> et l'implémentation en était à trois tâches sur neuf. Le règlement du user diffère sur
> quatre règles porteuses — le sens des paliers est inversé, la hiérarchie de classement
> change, une rotation finale de classement apparaît, et l'égalité devient licite. Rustiner
> aurait coûté plus cher qu'une réécriture et laissé des traces de l'ancien format là où
> personne ne les cherche. Ce qui survit est listé au §13.

---

## 1. Objectif

Faire de la **montante / descente** un format standard de PAG MATCH : huit binômes, seize
joueurs, quatre terrains, deux heures, tout le monde joue à chaque rotation.

**Le nombre de terrains est le paramètre, et tout le reste en découle : binômes = terrains ×
2, et donc places = terrains × 4, puisqu'elles se comptent en joueurs** (cf. §3). Quatre
terrains donnent ainsi huit binômes et seize places. C'est le sens de la vraie vie — on
réserve d'abord des terrains au club, et le nombre de joueurs s'y ajuste. Le règlement les listait comme deux paramètres séparés, ce
qui pouvait produire des combinaisons impossibles (dix binômes sur quatre terrains) ; cette
inversion supprime la contradiction.

Le moteur reste **général** : quatre terrains est la valeur par défaut de la V1, pas une
limite. Le règlement l'exige explicitement — pouvoir passer à six ou huit terrains sans
reconstruire le moteur.

**Si le tournoi ne fait pas le plein**, un terrain n'a qu'un binôme, qui prend un bye.
L'organisateur peut alors **réduire le nombre de terrains au lancement** pour que tout le
monde joue : sept binômes sur trois terrains valent mieux que sept sur quatre.

## 2. Le format de référence

| Paramètre | Valeur |
|---|---|
| Terrains | 4 |
| Binômes | 8 (16 joueurs) |
| Binômes par terrain | 2 |
| Rotations | 6 — dont **5 de montante/descente** et **1 de classement** |
| Durée d'une rotation | 15 min |
| Durée totale | ~2 h |
| Comptage | aux jeux gagnés |
| Égalité en fin de match | point décisif |

**Le Terrain 1 est le palier le plus élevé**, le Terrain 4 le plus bas. **On monte vers le
Terrain 1.** *(C'est l'inverse de la convention retenue dans la version précédente ; le
règlement du user fait foi.)*

L'organisateur peut définir : nom, club, date et heure, terrains, niveau minimum et maximum,
nombre de rotations, durée des rotations, et le mode de placement initial.

## 3. Inscriptions et check-in

**Les places se comptent en joueurs, pas en binômes** : terrains × 4, soit **16 places** pour
le format de référence. C'est la seule façon d'afficher honnêtement « 13/16 » quand trois
joueurs cherchent encore un partenaire.

**Un joueur n'a qu'une inscription par tournoi**, seul ou en binôme — garanti par la base,
pas par le code applicatif.

**On s'inscrit de deux façons.**

- **À deux** : on désigne son partenaire, le binôme existe aussitôt, les deux places sont
  prises, et le partenaire est notifié — il peut défaire le binôme.
- **Seul** : on prend une place et on apparaît comme cherchant un partenaire. En s'inscrivant
  seul, le joueur choisit entre **ouvert** — n'importe qui peut le rejoindre d'un geste — et
  **sur accord** : une demande lui est envoyée, qu'il accepte ou refuse.

**Chaque joueur déclare le côté qu'il jouera ce soir-là** — gauche, droit, ou les deux — **au
moment de s'inscrire**, et ce choix appartient au tournoi, pas au profil (décision du user) :
on s'adapte souvent à son partenaire d'un soir. Le côté renseigné sur le profil sert
simplement de valeur proposée par défaut, jamais de contrainte.

Le côté est **affiché dans la liste des joueurs seuls**, pour qu'on puisse chercher un
complément plutôt qu'un doublon. **Un binôme de deux joueurs du même côté reste autorisé** —
deux droitiers peuvent très bien s'arranger entre eux — mais il est signalé comme tel.

**Aucune demande ne retient de place**, quel que soit le mode : les deux joueurs concernés
occupent déjà chacun la leur. Une demande ignorée n'immobilise donc rien, contrairement à
l'état `EN_ATTENTE → CONFIRMÉ` du règlement, dont cette section s'écarte sciemment — une
place retenue par un binôme non confirmé est exactement la dérive déjà connue du projet avec
`spots_available`. Accepter une demande **refuse automatiquement les autres** reçues par le
même joueur.

**Un binôme se défait à tout moment avant le lancement**, par l'un ou l'autre de ses membres :
les deux redeviennent seuls **en gardant chacun leur place**. Personne n'est éjecté du tournoi
parce qu'un partenaire s'est ravisé.

**La liste d'attente suit les mêmes règles.** Une fois les 16 places prises, les suivants
s'inscrivent quand même — seuls ou à deux — et entrent en file, ordonnée par date. Quand des
places se libèrent, la file avance dans l'ordre, à concurrence des places disponibles.

**Au lancement, les joueurs encore seuls sont appariés automatiquement** (décision du user) :
niveaux proches, **et côtés complémentaires quand c'est possible**. Cette seconde règle ne
s'invente pas — `scoreSide()` existe déjà dans `lib/compat.ts` et note exactement cela
(complémentaires 10, l'un des deux flexible 5, même côté 2). On la réutilise plutôt que d'en
écrire une seconde qui divergerait. L'organisateur garde son droit d'intervention et peut
refaire un binôme à la main.

**S'il reste un joueur impair**, il ne joue pas et retourne en tête de liste d'attente. Un
nombre **impair de binômes**, en revanche, ne pose aucun problème : le terrain incomplet
donne un bye tournant, et le format continue.

**Le check-in reste**, lui, et il est distinct : avant le lancement, les joueurs confirment
leur présence. Le tournoi ne se lance normalement que lorsque les huit binômes sont présents,
mais **l'organisateur peut passer outre** — remplacer un binôme, ou lancer quand même.

Un binôme ne change plus de joueur après le lancement, sauf intervention de l'organisateur.

## 4. Placement initial

Les huit binômes sont répartis à raison de deux par terrain. Trois modes, au choix à la
création :

- **ALÉATOIRE**
- **NIVEAU_PAGMATCH** — niveau du binôme = moyenne des niveaux de ses deux joueurs ; les plus
  forts au Terrain 1
- **MANUEL** — l'organisateur place lui-même

## 5. Déroulement d'une rotation

Chaque rotation génère **quatre matchs simultanés**, un par terrain. Pendant quinze minutes,
les joueurs comptent les jeux gagnés ; le format No-Ad est recommandé. Au signal, le jeu en
cours se termine, et le binôme ayant remporté le plus de jeux gagne le match.

**Un match ne peut jamais rester nul** : sans vainqueur, on ne saurait pas qui monte. À
égalité de jeux au signal, un **point décisif** se joue sur le terrain, et le binôme qui le
remporte l'inscrit comme un jeu — on saisit donc 6-5, pas 5-5. **L'application refuse un
score à égalité.**

*Décision du user (2026-08-29), qui remplace le §9 de son propre règlement.* Celui-ci
préconisait de conserver `5-5` avec le vainqueur du point décisif à côté, pour garder des
statistiques de jeux exactes. La contrepartie assumée du choix retenu : **le vainqueur du
point décisif enregistre un jeu qu'il n'a pas gagné sur le terrain**, et sa différence de
jeux est donc décalée d'une unité sur ce match. En échange, il n'existe qu'une seule forme de
score, et aucun écran n'a à traiter un cas particulier.

**Le chronomètre n'est pas tenu par l'application en V1** (décision du user). Les heures de
début et de fin de chaque match sont enregistrées dès maintenant, de sorte qu'un décompte
puisse s'ajouter plus tard sans rien démonter.

## 6. Montée et descente

Après validation des quatre matchs d'une rotation :

- **le gagnant monte d'un terrain** (vers un numéro plus petit) ;
- **le perdant descend d'un terrain** ;
- **exception haute** : le gagnant du Terrain 1 reste au Terrain 1 ;
- **exception basse** : le perdant du Terrain 4 reste au Terrain 4.

Cette logique est **entièrement automatique**.

**L'invariant qui la fait tenir** : chaque terrain reçoit le gagnant du terrain en dessous et
le perdant du terrain au-dessus, soit exactement deux binômes ; aux extrémités, celui qui
reste remplace le voisin manquant. **Chaque terrain conserve donc toujours deux binômes.**
C'est la propriété centrale du format et elle doit être testée comme telle.

**Un terrain à effectif impair** — possible après un forfait — donne un bye au binôme ayant
eu le moins de byes jusque-là, et apparie les autres. **Le binôme qui prend un bye reste sur
son terrain** : n'ayant ni gagné ni perdu, il ne monte ni ne descend. Et **aucun binôme n'est
jamais écarté en silence** — un terrain à trois binômes en produit un qui joue et un qui
attend, jamais un qui disparaît du tableau.

Un bye ne compte pas comme une victoire : il ne change ni le nombre de victoires, ni les jeux,
ni la différence. Il coûte donc les jeux qu'on n'a pas pu gagner, ce qui est assumé — c'est le
prix d'un effectif devenu impair, et la raison pour laquelle le bye tourne.

## 7. Résultats et validation

Chaque match enregistre : tournoi, rotation, terrain, les deux binômes, les jeux de chacun,
le gagnant, le perdant, le statut, et les heures de début et de fin.

**La saisie se fait joueur par joueur, et c'est l'accord entre les deux camps qui fait foi**
(décision du user). Chacun des quatre joueurs peut saisir le score ; on conserve **une ligne
par saisie** — qui a saisi quoi, et quand.

- **Le score est acquis dès que deux joueurs de binômes opposés saisissent le même score.**
  Deux saisies suffisent, donc la rotation avance vite.
- **Deux joueurs opposés qui se contredisent ouvrent un litige**, et le match part chez
  l'organisateur, qui tranche sur place. Pas de motif à saisir, pas de délai : tout le monde
  est dans la même salle.
- **Deux coéquipiers d'accord entre eux ne valident rien.** Ils sont juge et partie, et une
  majorité de deux contre un les laisserait décider seuls de leur propre score.
- **L'organisateur peut toujours saisir, corriger ou trancher directement**, sans attendre
  personne.

**Tant que les quatre matchs d'une rotation ne sont pas acquis, la rotation suivante ne peut
pas être générée.** C'est ce qui empêche une soirée de dérailler sur une faute de frappe, et
l'écran doit dire **lesquels manquent** — un blocage qui ne s'explique pas arrête la salle.

**Modifier un résultat après génération de la rotation suivante invalide les rotations
postérieures**, qui sont régénérées. Douloureux, mais l'alternative est une arborescence
incohérente et un classement faux.

**Les scores confirmés ne sont jamais détruits.** Une clôture anticipée **borne** le
classement à la dernière rotation complète ; elle n'efface aucune ligne.

## 8. Classement provisoire

Recalculé après chaque rotation, dans cet ordre :

1. **palier actuel** (Terrain 1 devant Terrain 4)
2. **nombre de victoires**
3. **différence de jeux**
4. **jeux gagnés**
5. **confrontation directe**

Le palier prime, et c'est voulu : sans cela, un binôme accumulant des jeux sur les terrains
inférieurs passerait devant un binôme qui s'est maintenu en haut. *(La version précédente
classait d'abord aux jeux gagnés — inversé.)*

**La confrontation directe agrège toutes les rencontres** entre deux binômes, pas seulement
la première : les revanches sont la norme dans une échelle, et n'en retenir qu'une rendrait
le résultat dépendant de l'ordre des lignes.

## 9. Rotation finale et classement final

Après la **cinquième** rotation, les mouvements sont effectués une dernière fois et **les
positions sont figées**. La **sixième** rotation ne fait plus monter ni descendre : c'est une
**rotation de classement**.

| Terrain | Enjeu |
|---|---|
| 1 | places 1 et 2 |
| 2 | places 3 et 4 |
| 3 | places 5 et 6 |
| 4 | places 7 et 8 |

Le gagnant de chaque match prend la meilleure des deux places. **Le classement final est
celui-là** : les statistiques des rotations précédentes restent enregistrées mais ne le
remplacent pas.

**Si la rotation finale n'a pas lieu** — soirée qui déborde, terrain repris, binôme parti —
le classement final est **le classement provisoire de la dernière rotation complète**, selon
la hiérarchie du §8. Le tournoi compte normalement et les points sont attribués (décision du
user).

## 10. Historique des mouvements

La position de chaque binôme est enregistrée après chaque rotation : rotation, terrain avant,
terrain après, et le mouvement — **MONTÉE / DESCENTE / SUR PLACE**. C'est ce qui permet
d'afficher le parcours `T4 → T3 ↑ → T2 ↑ → T3 ↓ → T2 ↑ → T1 ↑`.

## 11. Points et classements individuels

**Deux classements distincts.**

**Le classement du tournoi appartient au binôme** — c'est le podium de la soirée.

**Le classement PAG MATCH montante/descente appartient au joueur**, et se cumule sur tous ses
tournois, quels que soient ses partenaires successifs.

**Les points sont attribués par rang, depuis une table configurable en base** — jamais codés
en dur. Barème initial, **sans valeur négative** :

| Rang | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| Points | 100 | 80 | 65 | 55 | 45 | 35 | 25 | 15 |

**Les deux joueurs d'un binôme reçoivent les mêmes points.**

## 12. « Mon parcours »

Pour chaque joueur : ses tournois, ses matchs, ses scores, ses partenaires, ses adversaires,
son parcours entre les terrains, et ses cumuls — tournois joués, matchs, victoires et
défaites, pourcentage de victoires, différence de jeux, victoires de tournoi, podiums, et
points montante/descente.

## 13. Ce qui est repris de la conception précédente

Trois pièces déjà construites et éprouvées restent valables :

- **L'architecture.** Des tables `tournament_*` **sans aucun lien avec `games`**, parce que
  deux mécanismes existants saboteraient le format : le blocage anti-chevauchement ±2h, qui
  refuserait un binôme jouant six fois en deux heures, et le déclencheur qui distribue l'ELO
  à chaque validation. Ni l'un ni l'autre n'est modifié. C'est la « règle technique
  fondamentale » du règlement — séparer MATCH, ROTATION et CLASSEMENT — exprimée en base.
- **L'unicité joueur/binôme**, garantie par un index maintenu par déclencheur plutôt que par
  du code applicatif.
- **L'interrupteur** `tournaments_enabled`, éteint par défaut, pour livrer sans que rien
  n'apparaisse et allumer quand on le décide.

**L'invariant du moteur** (deux binômes par terrain) reste vrai quel que soit le sens de
numérotation ; seul le sens du mouvement s'inverse.

## 14. Machine à états

`BROUILLON → INSCRIPTIONS_OUVERTES → COMPLET → CHECK_IN → PRÊT → EN_COURS → TERMINÉ →
CLASSEMENT_VALIDÉ`

Les points ne sont crédités et le tournoi n'apparaît dans « Mon parcours » qu'au passage à
**CLASSEMENT_VALIDÉ**.

## 15. Forfaits

- **Avant le tournoi** : remplacement possible depuis la liste d'attente.
- **Pendant** : statut FORFAIT. L'organisateur choisit de remplacer le binôme ou de continuer
  avec forfait automatique.
- **Le score attribué en cas de forfait est paramétrable**, afin de ne pas polluer les
  statistiques de jeux. **Valeur par défaut : victoire pour l'adversaire, 0-0 aux jeux.**
  L'adversaire gagne donc son match — il compte dans les victoires, 2ᵉ critère du classement,
  et il monte d'un terrain — sans encaisser des jeux qu'il n'a pas joués, ce qui fausserait la
  différence de jeux et les jeux gagnés face aux binômes qui ont dû les gagner sur le terrain.

  ⚠️ **`0-0` est un score à égalité, que l'application refuse par ailleurs.** Le chemin du
  forfait doit contourner ce refus explicitement, sans quoi le forfait devient impossible à
  enregistrer.

- **Le match en cours** au moment du forfait est enregistré ainsi. **Aux rotations suivantes**,
  le binôme est hors de l'échelle : son ancien adversaire n'attend pas, le terrain se retrouve
  simplement à effectif impair et le bye tournant s'en charge.

## 16. Vérification

Le cœur du format est du **calcul pur** — placement, mouvement, byes, classement, départages,
rotation finale — donc testable sans base ni écran, avec les tests déjà en place.

**Le SQL fait autorité, `lib/` en est le miroir d'affichage** : c'est la règle du dépôt, déjà
en vigueur pour l'ELO. Elle ouvre un risque de divergence silencieuse, et la parade a fait
ses preuves : **un test de parité** qui rejoue un tournoi complet et vérifie que les deux
implémentations rendent exactement le même classement.

Un piège déjà rencontré et à ne pas rejouer : un départage écrit comme comparateur par paires
d'un côté et comme agrégat de l'autre **ne donne pas le même ordre sur une égalité à trois**.
Les deux côtés doivent calculer la même chose, pas seulement « quelque chose de proche ».

**Déploiement en trois temps** : éteint par défaut → un tournoi de test réel → ouverture.

## 17. Hors périmètre

- **Le chronomètre dans l'application** — les heures sont enregistrées, le décompte viendra
  plus tard.
- **Le paiement en ligne.** Le prix reste affiché, réglé au club.
- **Les comptes club.** Le user seul crée les tournois.
- **La rotation des partenaires** — le binôme est fixe.
- **Le scoring live au poignet** sur les matchs de tournoi.
- Toute modification de l'ELO, du blocage ±2h, ou des parties ordinaires.

## 18. Points de vigilance

- **Le Terrain 1 est le plus fort.** Toute la version précédente supposait l'inverse ; c'est
  la première chose à vérifier dans le code repris.
- **Ne jamais toucher au déclencheur ELO ni au blocage ±2h.**
- **Le classement en cours ne se stocke pas** — il se calcule. Le dénormaliser réintroduirait
  la classe de bug de `spots_available`.
- **Une rotation ne se génère jamais sur des résultats incomplets.**
- **Aucun binôme ne disparaît jamais d'un tableau**, quelle que soit la parité d'un terrain.
- **Le test de parité SQL ↔ TypeScript n'est pas optionnel.**
