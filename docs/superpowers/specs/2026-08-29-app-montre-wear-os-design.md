# App montre Wear OS (Samsung) — conception

**Date** : 2026-08-29
**Statut** : validé section par section avec le user, prêt pour le plan d'implémentation
**Prérequis** : `2026-08-25-app-montre-design.md` et `2026-08-26-rendu-adaptatif-montre-design.md`
(app Connect IQ, en prod sur 53 modèles Garmin)

---

## 1. Objectif

Porter le scoring live au poignet sur les montres **Wear OS**, à parité complète avec l'app
Garmin, pour les joueurs équipés de Samsung Galaxy Watch 4 ou plus récente.

## 2. Pourquoi Wear OS, et pourquoi pas les autres

Le parc réel des joueurs PAG MATCH, d'après le user (2026-08-29) : *« les utilisateurs ont
diverses montres et la plupart ont des montres Apple et Samsung, Huawei ou autre. Les
Garmin commencent à prendre du terrain car les joueurs de padel sont aussi des sportifs
réguliers. »*

| Montre | App tierce possible ? | État |
|---|---|---|
| Garmin | oui | ✅ livré, 53 modèles |
| **Samsung Galaxy Watch 4+** | **oui, Wear OS** | **objet de cette conception** |
| Apple Watch | oui, mais 🔴 compte Apple Developer bloqué | reporté |
| Huawei, Amazfit, Xiaomi | **non, jamais** | hors d'atteinte |

**L'uniformité au poignet est hors d'atteinte par nature, pas par manque de travail.** Une
Huawei n'acceptera jamais d'application tierce, quel que soit le budget. Le modèle retenu
est donc celui de tout le monde : **une liste de montres officiellement prises en charge,
chacune avec une vraie application**, annoncée clairement. Garmin, Samsung, Apple à terme.

**Apple Watch est reportée pour une raison externe, pas technique** : une app watchOS ne
peut exister que comme extension d'une app iPhone, et l'inscription Apple Developer de
QUARTZTEC est en révision manuelle depuis le 2026-08-08 (faux positif de marque sur
« Quartz » dans « Quartztec », dossier 20000129900529). Concevoir est possible, livrer et
même **vérifier** ne l'est pas.

**Une voie moins chère a été explorée puis écartée : la télécommande par notification.**
Une notification avec boutons d'action, affichée au poignet par recopie, aurait touché
toutes les marques sans écrire une seule app de montre — les briques existent déjà dans
`expo-notifications` (catégories, `buttonTitle`, `opensAppToForeground`, `sticky`). Elle a
été rejetée par le user, à raison : *« je ne crois pas qu'on puisse rendre cette
fonctionnalité premium avec autant de limites »*. Une fonctionnalité dont le comportement
change avec la marque du poignet, et qui s'éteint quand le système ferme l'application, ne
se vend pas.

## 3. Le constat qui rend ce chantier petit

**Tout le travail difficile est déjà fait, et il n'est pas spécifique à Garmin.** Vérifié :
les migrations `watch_*.sql` ne contiennent **aucune ligne** dépendante de Garmin (la seule
occurrence du mot est un commentaire sur les polices). L'appairage par code, les jetons, la
limitation de débit, l'anti-doublon par `client_seq` sont du HTTPS ordinaire.

La montre n'appelle que **quatre fonctions**, toutes déployées :
`redeem_watch_pairing_code`, `watch_current_session`, `watch_apply_event`,
`watch_finalize_session`.

Répartition des 1975 lignes de l'app Garmin :

| | Lignes | Devient |
|---|---|---|
| `Layout.mc` — moteur de mesure | 378 | **disparaît** |
| `Api` + `Queue` + `Config` | 255 | se transpose presque à l'identique |
| Les 3 écrans | 1321 | rétrécissent nettement |

**Le fichier le plus cher du chantier Garmin ne sert à rien ici.** `Layout.mc` n'existe que
parce que Monkey C n'a aucune notion de mise en page : on dessine à des coordonnées
absolues ou on ne dessine pas. Compose mesure et arrange tout seul. Une grosse part des 790
lignes de l'écran de match est de l'arithmétique de placement, pour la même raison, et
s'évapore avec.

## 4. Architecture

**Un projet autonome, à côté de `watch/`**, en Kotlin + Compose for Wear OS. La montre parle
**directement** à Supabase, comme la Garmin.

Trois raisons, aucune n'est une préférence de goût :

1. Elle réutilise un backend déjà écrit, relu et vérifié comme neutre.
2. Elle **évite le piège du prebuild** : `android/` est ignoré par git et régénéré par
   `expo prebuild`. Tout code natif posé dedans disparaîtrait tôt ou tard, ou exigerait un
   plugin de configuration Expo pour être réinjecté à chaque fois.
3. La montre continue de fonctionner **même si l'app du téléphone est fermée** — ce qui est
   la promesse même de la fonctionnalité.

**Deux alternatives écartées.** Un module dans le projet Android d'Expo : ajoute une
machinerie fragile sans rien gagner. Une montre qui ne parle qu'au téléphone via le Data
Layer : séduisante sur le papier (une seule source de vérité), mais impose du code natif
**côté téléphone** aussi, un transport entièrement nouveau à construire et déboguer, et
s'arrête dès que l'app du téléphone se ferme — on remplacerait un chemin HTTPS éprouvé par
un chemin à inventer.

**Contrepartie acceptée** : l'app montre aura son propre identifiant, distinct de
`com.pagmatch.app`. Les joueurs ne la verront pas s'installer automatiquement sur leur
poignet ; ils l'installeront séparément. C'est le prix de l'indépendance vis-à-vis du
prebuild.

**Ce qui n'est pas touché** : le backend (pas une ligne), l'écran d'appairage du téléphone
(`app/watch-link.tsx`, déjà neutre — il dit « ta montre », jamais « ta Garmin »), et l'app
Garmin.

## 5. Les écrans

Ceux de la Garmin, à l'identique, mêmes mots : **saisie du code** d'appairage à 6 chiffres,
**tableau de match**, **confirmation de validation**.

Parité complète, décidée par le user : appairage, tableau consultable, mode jeu par jeu
**et** mode point par point, annulation, validation du score depuis la montre, file
d'attente hors ligne. Pas de v1 étroite : le backend étant écrit, l'écart de coût avec une
version amputée est plus faible qu'il n'y paraît, et deux comportements différents selon la
montre contrediraient la promesse premium.

## 6. La saisie

**Contrainte qui ne se transpose pas : sur Wear OS, le balayage vers la droite appartient
au système.** C'est le geste « retour », et une application n'a pas le droit de le
détourner. Or c'est précisément le geste d'annulation sur la Garmin. Il ne passe pas.

**Décision (validée)** : **deux grandes moitiés tactiles** — on touche la moitié de l'écran
où est affichée l'équipe qui vient de marquer, comme sur la Garmin. Le geste désigne
l'équipe telle qu'elle est affichée ; rien à mémoriser, et le même réflexe sur les deux
montres.

**Le risque assumé, et son rattrapage.** La relecture de la Garmin a montré qu'un contact
involontaire — manche, sueur, essuyage — marquait un point **sans rien afficher**. Sur une
montre Wear OS toute la face est tactile en permanence : le risque est mécaniquement plus
grand. Il est accepté en échange de la rapidité, à deux conditions non négociables :

- **l'annulation est un bouton visible**, pas un geste caché ;
- **chaque point ajouté s'annonce clairement à l'écran** — jamais d'ajout silencieux.

Deux options ont été écartées : des boutons plus petits et franchement dessinés (plus sûrs,
mais il faut viser, un ballon à la main entre deux points), et la lunette rotative des
Samsung (impossible à déclencher par accident, mais absente des modèles non-Classic, donc
deux façons de faire selon le modèle).

⚠️ **Annulation et validation ne doivent JAMAIS partager le même geste.** Règle héritée de
la conception Garmin, où une première rédaction avait placé l'action destructrice et
l'action irréversible derrière un geste identique. Elle reste en vigueur ici.

## 7. Rester au poignet pendant tout le match

C'est le point où Wear OS est **plus difficile** que la Garmin.

Une app Connect IQ reste ouverte tant qu'on n'en sort pas. Wear OS revient au cadran après
quelques secondes d'inactivité : sans traitement, le joueur lève le poignet entre deux
points et voit l'heure. La fonctionnalité serait morte à cet instant précis.

**Décision : déclarer le match comme activité en cours** (`androidx.wear.ongoing`), le
mécanisme prévu pour ce cas et utilisé par les applications de sport. Il apporte trois
choses :

- une pastille PAG MATCH sur le cadran, avec le score, tant que le match dure ;
- lever le poignet ramène **dans l'app**, pas sur l'heure ;
- le système cesse de considérer l'app comme fermable pour récupérer de la mémoire, ce qui
  règle proprement le risque « le système tue l'application en plein match ».

**Décision batterie (validée)** : l'écran s'allume au lever de poignet et s'estompe entre
les points, plutôt que de rester allumé en permanence. On garde le coup d'œil instantané
sans vider la montre en un match.

## 8. Fiabilité

Rien à inventer. Une montre Wear OS sans carte SIM passe par le téléphone en Bluetooth ;
sur un terrain, le téléphone est dans le sac à dix mètres — ça tient, mais ça peut
décrocher.

**La file d'attente hors ligne et l'anti-doublon de la Garmin sont transposés, pas
réécrits.** Ce sont 56 lignes, mais ce sont les 56 qui garantissent qu'un point marqué hors
réseau n'est ni perdu ni compté deux fois. Elles ont été pensées et relues ; les
réinventer serait rejouer des bugs déjà résolus. L'unicité repose côté serveur sur
`(session_id, watch_link_id, client_seq)`.

## 9. Rendu adaptatif

**Non-problème ici**, et c'est une des raisons pour lesquelles la deuxième montre coûte
moins cher que la première. Wear OS a des écrans ronds et carrés de tailles variées — même
piège qu'en Garmin — mais Compose sait mesurer et arranger. On ne réécrit pas de moteur.

La **discipline** reste, elle : mesurer plutôt que supposer, et surtout **regarder les
écrans**. Voir §11.

## 10. Vérification

Deux niveaux, comme pour la Garmin, mais mieux outillés.

**Simulateur** : images Wear OS rondes et carrées, plusieurs tailles. À comparer aux 57
définitions à balayer une par une côté Garmin, c'est une simplification majeure.

**La Samsung du user**, qui reste le juge final : un vrai match joué de bout en bout, en
surveillant précisément **le contact involontaire**, puisque c'est le risque explicitement
accepté au §6.

Compiler ne prouve rien sur l'affichage. Sur le chantier Garmin, la compilation validait 53
modèles pendant que 13 sur 14 affichaient des lignes superposées.

## 11. Points de vigilance

- **Regarder n'est pas exécuter, et compiler n'est pas regarder.** Trois fois sur le
  chantier Garmin, un contrôle passé de « relire » à « exécuter » a trouvé des défauts
  déclarés propres par la relecture.
- **Vérifier les API avant de s'appuyer dessus.** `androidx.wear.ongoing`, le mode ambiant,
  la lunette rotative et le comportement exact du lever de poignet sont attendus tels que
  décrits ici, mais doivent être lus dans la documentation, pas présumés.
- **Le balayage vers la droite est au système.** Ne jamais le capturer.
- **Ne pas encoder d'information dans la couleur seule** — règle héritée de la Garmin. Ce
  qui distingue les deux équipes est leur position, haut et bas.
- **Aucun cas particulier par modèle.** Brancher sur une capacité (écran rond, présence
  d'une lunette), jamais sur un identifiant d'appareil.

## 12. Hors périmètre

- **La publication sur le Play Store.** Décidée hors périmètre par le user : l'app téléphone
  elle-même n'est sur aucun store (APK direct, test fermé, 8 utilisateurs), et publier la
  montre seule créerait un parcours bancal où la montre serait mieux distribuée que le
  produit dont elle dépend. La publication sera un chantier à part, **téléphone et montre
  ensemble**. Conséquence : cette app s'installe à la main pendant le développement.
- **Apple Watch** — bloquée sur le compte Apple, à reprendre au déblocage.
- **Huawei, Amazfit, Xiaomi** — hors d'atteinte, aucune app tierce possible.
- **La télécommande par notification** — explorée, rejetée (§2).
- **La publication de l'app Garmin sur la boutique Connect IQ** — toujours en attente depuis
  la conception précédente ; l'app n'est installable que par le développeur.
- Toute évolution fonctionnelle : cette conception **porte** l'existant, elle n'ajoute rien.
