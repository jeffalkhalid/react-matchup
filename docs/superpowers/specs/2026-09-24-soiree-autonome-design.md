# Soirée de tournoi autonome — conception

**Date** : 2026-09-24
**Statut** : conception validée en dialogue avec le user (2026-09-24), pas encore planifiée.
**Source** : les règles données par le user ce jour-là. En cas de doute, ce texte fait foi.
**Complète** : `2026-08-29-tournois-montante-descente-design.md`, qui reste la référence du
format. Rien n'y est annulé ; ce document ne change que **qui conduit la soirée**.

---

## 1. Objectif

Aujourd'hui, une soirée avance parce qu'un administrateur appuie sur « Rotation suivante »
entre chaque tour. Il faut donc qu'il soit présent, disponible et attentif pendant deux
heures — et pendant ce temps, huit à seize personnes attendent un bouton que personne sur
place ne peut presser à sa place.

**La soirée doit se conduire au rythme des matchs.** Chaque terrain démarre quand ses quatre
joueurs sont prêts, joue ses quinze minutes, rend son score ; quand les quatre terrains ont
rendu, la rotation suivante part toute seule et chacun apprend où il va.

**L'administrateur devient un dépanneur** : il lance la soirée, il reçoit les alertes, il
tranche un désaccord, il tape un score que personne ne rendra. Il ne rythme plus rien.

Dans tout ce document, **« l'admin »** désigne l'**organisateur** du tournoi, c'est-à-dire son
créateur (`tournaments.created_by`) — qui est aujourd'hui forcément un administrateur de
l'app, puisque la création n'est proposée que là. Élargir ce rôle à un non-admin est hors
périmètre (§14).

Corollaire assumé : les terrains dérivent les uns par rapport aux autres (une à trois
minutes par rotation). C'est voulu — c'est ce décalage que le bouton unique ne savait pas
absorber.

## 2. Avant / après

| | Aujourd'hui | Après |
|---|---|---|
| Lancer la soirée | « Démarrer », puis « Tirer le tour 1 » | **un geste**, tour 1 compris |
| Début d'un match | rien ne le marque | un des 4 joueurs appuie **« On commence »** |
| Fin d'un match | rien ne le signale | **sonnerie** sur les 4 téléphones à 15 min |
| Rotation suivante | bouton de l'admin | **automatique**, dès que les 4 terrains ont un score |
| Savoir où aller | rouvrir l'app et chercher | **notification** « Rotation 2 — Terrain 1 » |
| Forfait | l'admin le prononce | **le binôme le déclare** (un des deux suffit) |
| Terrain muet | personne n'est prévenu | relance aux 4 joueurs, puis **alerte à l'admin** |
| Clôture | geste de l'admin | **automatique** ; la validation reste à l'admin |

## 3. Le déroulé, minute par minute

1. L'admin appuie **« Lancer la soirée »** : binômes figés, terrains de départ attribués,
   rotation 1 tirée. Tout le monde reçoit « Rotation 1 — Terrain 2, contre X & Y ».
2. Les quatre joueurs arrivent. L'un d'eux appuie **« On commence »** : le chrono de ce
   terrain part pour `round_minutes` (15 par défaut, réglage du tournoi). Les quatre
   téléphones affichent le même compte à rebours.
3. À la fin du temps : **ça sonne** sur les quatre téléphones, l'écran passe à la saisie.
   L'app n'interrompt rien — on finit le point.
4. N'importe lequel des quatre saisit le score. **La première saisie fait foi**
   (`tournament_score_effective.sql`). L'adversaire confirme, ou saisit autre chose — et
   c'est alors un désaccord, qui bloque ce terrain jusqu'à ce que l'un des deux corrige.
5. Trois minutes après la sonnerie sans saisie : **deuxième sonnerie** aux quatre joueurs.
   Cinq minutes après la sonnerie (donc deux minutes plus tard) : **alerte à l'admin**, une
   seule fois par match.
6. Quand les quatre terrains ont un score acquis : **la rotation suivante est tirée par le
   serveur**, et tout le monde reçoit son terrain. Retour à l'étape 2.
7. Après la dernière rotation (celle du classement) : le classement se **fige tout seul** ;
   l'admin **valide**, et c'est cette validation qui crédite les points.

## 4. Le chrono d'un terrain

**Donnée** : `tournament_matches.started_at timestamptz NULL` (ajout de colonne, additif).
Une seule source pour les quatre téléphones : celui qui arrive en retard voit le temps réel
restant, et personne ne compte dans son coin.

**`tournament_start_match(p_match uuid)`** — nouvelle fonction, accordée à `authenticated`.

Contrôles, dans cet ordre, avant toute écriture :

| Refus | Quand |
|---|---|
| `feature_disabled` | drapeau tournois éteint |
| `not_authenticated` | pas de joueur courant |
| `match_not_found` | identifiant inconnu |
| `bye_match` | `team_b IS NULL` — un repos ne se démarre pas |
| `tournament_not_started` | statut ≠ `EN_COURS` |
| `round_closed` | `round_no` ≠ `current_round` |
| `not_a_player` | l'appelant n'est pas l'un des quatre joueurs du match |
| `already_scored` | `games_a IS NOT NULL` — un match joué ne se redémarre pas |

**Idempotente** : si `started_at` est déjà posé, elle rend `{ok:true, started_at, already:true}`
plutôt qu'un refus — deux joueurs appuient en même temps, c'est le cas normal, pas une erreur.

**`tournament_reset_match_start(p_match uuid)`** — mêmes contrôles, remet `started_at` à
`NULL`. Sert au cas « quelqu'un a appuyé trop tôt » ; refusée dès qu'un score existe. Aucun
appel à l'admin pour ça.

Le temps restant s'affiche à partir de `started_at + round_minutes`, jamais d'un compteur
maison : une app rouverte, un téléphone éteint, un joueur arrivé en retard donnent tous le
même chiffre.

## 5. La sonnerie (sur le téléphone)

Chaque appareil programme **deux notifications locales** (`expo-notifications`) dès qu'il voit
`started_at` posé sur le match **où ce joueur joue**, à la rotation en cours :

1. à `started_at + round_minutes` — « Terminé. Entrez le score du Terrain X. » ;
2. à `+ 3 min` — « Le score du Terrain X n'est toujours pas rentré. »

**Annulation** — dès que l'une de ces conditions apparaît : un score est saisi
(`games_a IS NOT NULL`), la rotation change, `started_at` est remis à zéro, ou le binôme
déclare forfait. Les identifiants des notifications programmées sont gardés par appareil
(`AsyncStorage`, une clé par match), et les clés des tours passés sont purgées.

**Pourquoi sur le téléphone et pas sur le serveur** : la sonnerie tombe à la seconde près,
elle part même si le réseau du club est mauvais à cet instant, et elle évite environ quatre
cents notifications par soirée. Le serveur ne garde que ce qui concerne **les autres**.

**Décalage d'horloge** : la notification se programme en **durée relative** (« dans N
secondes »), N étant calculé à partir de l'heure serveur reçue avec le match. Une horloge de
téléphone en avance ou en retard ne décale donc pas la sonnerie.

**Dégradation** : si les notifications sont refusées, le compte à rebours reste affiché et
l'écran le dit une fois, sans insister. Aucune fonction n'est bloquée.

## 6. Les notifications envoyées par le serveur

Toutes passent par le chemin existant (déclencheur SQL → `pg_net` → fonction `send-push`),
**jamais un push depuis le client**.

**A. « Rotation N — Terrain X »** — à chacun des joueurs encore en lice, dès que la rotation
est tirée (dans la foulée des insertions de `fn_tournament_generate_round`, une seule fois
par rotation). Contenu : le numéro de rotation, le terrain, les adversaires. Un binôme au
repos reçoit « Tu es au repos à la rotation N ».

**B. « Terrain muet »** — à l'organisateur, par un travail planifié à la minute
(`pg_cron`) : tournoi `EN_COURS`, match de la rotation en cours, `team_b` non nul,
`started_at + round_minutes + 5 min < now()`, aucun score. **Une seule fois par match** —
marqué par une colonne `silent_notified_at` sur le match, sans quoi l'admin reçoit une
alerte par minute.

**C. Forfait déclaré** — au partenaire et aux deux adversaires du match en cours.

**D. Classement validé** — à chaque joueur, son rang et ses points, au moment où l'admin
valide.

**Routage côté app** : `hooks/usePushNotifications.ts` n'a aucun cas `tournament` — un push
de tournoi n'ouvre rien aujourd'hui. Il ouvrira le **Mode soirée** si la soirée tourne, la
fiche du tournoi sinon.

## 7. Le forfait, déclaré par le binôme

`tournament_forfeit(p_tournament, p_team)` n'accepte aujourd'hui que le créateur du tournoi.
Elle acceptera en plus **tout joueur membre du binôme visé**. Le reste ne bouge pas : c'est
**définitif**, les matchs non acquis du binôme sont soldés en faveur de l'adversaire, qui
monte.

**Un seul des deux suffit** (décision du user) : le plus souvent, on abandonne justement
parce que l'autre est déjà parti. Le partenaire est prévenu (§6 C).

Côté app, dans le Mode soirée : bouton **« Nous abandonnons »**, avec une confirmation qui
dit exactement ce qui se passe — définitif, l'adversaire gagne le match en cours, la soirée
continue sans eux.

## 8. Le déblocage par l'admin

Décision du user : quand un terrain ne rendra pas son score, **l'admin tape le score à leur
place**. Pas de « match non joué », pas de rotation sautée.

Or `tournament_resolve_dispute` refuse `no_dispute` tant que les deux camps ne se contredisent
pas : sur un terrain **muet** (zéro saisie), l'admin ne peut donc rien faire aujourd'hui. Ce
refus disparaît — l'organisateur pourra poser un score sur tout match **non confirmé**, qu'il
porte zéro, une ou deux saisies contradictoires. Le score posé est confirmé
(`confirmed_at = now()`), comme aujourd'hui, et le refus `already_confirmed` reste : un match
déjà acquis se rouvre (`tournament_reopen_match`), il ne se réécrit pas.

Le nom de la fonction ne change pas (surface gelée) ; c'est le libellé côté app qui devient
« Saisir le score à leur place ».

## 9. La fin de la soirée

`fn_tournament_try_advance` ne fait rien aujourd'hui quand la dernière rotation est atteinte.
Elle gagne une branche : **dernière rotation complète → `tournament_close`**, dans la même
transaction que le dernier score.

La **validation reste un geste de l'admin** (décision du user) : c'est elle qui crédite les
points, donc elle garde un dernier regard humain. Le classement figé s'affiche « en attente
de validation » chez tout le monde entre les deux.

## 10. Ce que devient l'écran Admin

**Disparaît** : « Rotation suivante » et « Rotation de classement » — le serveur les tire.

**Reste** : lancer la soirée (start + tour 1 en un geste), trancher / saisir un score,
prononcer un forfait, rouvrir un match d'une rotation passée, annuler le tournoi, valider le
classement.

**Apparaît** : les alertes « terrain muet » de la soirée en cours, en tête de la carte du
tournoi.

## 11. Prérequis

Dans cet ordre, avant toute chose :

1. **`tournament_score_effective.sql`** (écrite, recette 9/9, pas encore appliquée) — sans
   elle, les binômes ne bougent pas et rien de ce document n'a de sens.
2. **`tournament_auto_advance.sql`** (écrite le 2026-09-14, pas encore appliquée) — c'est
   elle qui tire la rotation suivante après chaque score et qui met `tournament_matches` en
   temps réel, condition du « tu vas au Terrain X » affiché sans rouvrir l'écran.

Appliquée seule, `tournament_auto_advance.sql` **aggrave** la situation (mesuré :
`tournament_ladder_corrupt` à la quatrième rotation, la saisie du joueur annulée). L'ordre
n'est pas une préférence.

## 12. Les états d'un terrain, à l'écran

`lib/tournamentEvening.ts` en connaît six (vide, provisoire, litige, acquis, forfait,
exempt). L'état « vide » se scinde en trois, parce qu'ils n'appellent pas la même phrase :

| État | Ce que voit le joueur |
|---|---|
| `a_demarrer` | « On commence » — personne n'a lancé le chrono |
| `en_cours` | le compte à rebours |
| `temps_ecoule` | « Entrez le score » (après la sonnerie) |
| `provisoire` | un camp a saisi, l'autre peut confirmer |
| `litige` | les deux camps se contredisent — ce terrain bloque la rotation |
| `acquis` | score validé des deux côtés, ou arbitré, ou forfait |

`forfait` et `exempt` (repos) ne changent pas.

## 13. Vérification

**Banc PostgreSQL local** — le harnais `pagmatch-db-tests` (embedded-postgres, hors dépôt,
jamais la prod), qui applique les migrations réelles et joue une vraie soirée. À vérifier :
chacun des refus de `tournament_start_match`, son idempotence, la
remise à zéro, le forfait déclaré par un joueur du binôme **et** refusé à un tiers, la saisie
admin sur un terrain muet, la clôture automatique après la dernière rotation, et l'absence de
clôture tant qu'un litige traîne.

**Vitest** : le temps restant (calcul pur, horloge injectée), la programmation et
l'annulation des sonneries (minuteur simulé), les trois nouveaux états de terrain, le routage
des notifications de tournoi.

**Sur appareil, et c'est la seule preuve qui compte pour la sonnerie** : deux téléphones, un
terrain, app **fermée** — la sonnerie tombe à l'heure, la deuxième aussi, et elles ne partent
pas si le score est saisi en avance. Android d'abord.

## 14. Hors périmètre

Arrêt forcé du jeu à la sonnerie. Compteur de retard visible par tous (« Terrain 3 en retard
depuis 6 min » — écarté par le user). Match « non joué ». Chronomètre tenu par le serveur.
Son personnalisé. Remplaçant d'un joueur parti. Chat de tournoi. Classement général aux
points. Ouverture de l'organisation à un non-admin.

## 15. Points de vigilance

- **Une notification programmée qui ne s'annule pas** est pire que pas de notification : elle
  sonne pendant la rotation suivante. L'annulation est au cœur du §5, pas un détail.
- **Deux comptes sur un même appareil** : piège connu des pushes de ce dépôt — le jeton est
  par appareil, pas par joueur.
- **Expo SDK 57** : certaines API de notification lèvent au lieu d'avertir. Vérifier la forme
  du déclencheur avant d'écrire du code par mémoire.
- **`silent_notified_at`** : sans ce marqueur, l'alerte « terrain muet » part chaque minute.
- **Le tour 1 tiré au lancement** ne change rien au pointage : il n'est pas exigé, un binôme
  absent joue quand même — inchangé, mais à dire dans la confirmation du bouton.
- **Ordre des migrations** (§11), qui est une condition de correction, pas de confort.
