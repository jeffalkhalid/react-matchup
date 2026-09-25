# État des lieux — handoff « Tournois & Événements »

**25 septembre 2026.** Confrontation du handoff de design (10 prototypes, 68 captures)
au code et au schéma réellement en place. Aucune ligne de code n'a été modifiée pour
écrire ce document.

À lire avant de décider ce qui entre en V1 : la section Tournois est marquée **hors
périmètre V1**, et ce handoff représente à lui seul dix écrans et une section nouvelle.

> ⚠️ **Ce document est l'état d'AVANT travaux, et il a vieilli le jour même.**
> Dans la journée du 25 septembre ont été livrés : l'habillage du mode soirée, le bloc
> « Comment ça tourne » de la fiche, la courbe de Mon parcours, **toute la section
> Événements** (tables, fiche, onglet, création, notifications), le signalement d'un
> score faux, la validation automatique du classement, la relance d'invitation,
> l'invitation d'un joueur non inscrit, la suggestion de partenaire, la feuille
> « Tu organises quoi ? » et la colonne Tournois unique.
>
> Ce qui reste : la clôture automatique des inscriptions, « Relancer les 4 »,
> l'historique des corrections, le bandeau hors ligne. Les trois premiers demandent
> d'ouvrir en deux un RPC de production, comme l'a été `tournament_validate`.

---

## 1. Le verdict en trois phrases

1. **Le moteur de la soirée est déjà construit.** Les huit états d'un terrain, le chrono
   partagé, la saisie par un seul camp, le litige bloquant, le forfait, le bye, la
   rotation tirée automatiquement, les sonneries : tout existe et tourne en production
   depuis le 24 septembre. Ce que le handoff apporte sur l'écran 01, c'est l'**habillage**,
   pas la mécanique.
2. **Le tableau « Données à ajouter » du handoff est trompeur.** Sur ses 13 lignes,
   5 existent déjà sous un autre nom, 2 existent sous une autre forme (un statut au lieu
   d'une date), et 6 sont réellement à construire. Le prendre pour une liste de travaux
   ferait créer des colonnes en double.
3. **Les Événements sont bien une page blanche**, comme le brief le disait : aucune table,
   aucun écran, aucune trace dans l'app. C'est le seul lot qui part vraiment de zéro.

Et un constat qui ne coûte rien à corriger : **un vrai défaut est en production**. Voir §6.

---

## 2. Écran par écran

Échelle de coût : **S** = une séance, rendu seul, aucune migration · **M** = deux à trois
séances · **L** = plus, ou base de données nouvelle.

| Écran du handoff | Ce qui existe déjà | Ce qui manque vraiment | Migr. | Coût |
|---|---|---|---|---|
| **00 Existant** | — | Rien : c'est la référence, pas une cible | non | — |
| **01 Mode soirée** (15 états) | `app/tournaments/soiree/[id].tsx` (679 l.), `lib/tournamentEvening.ts` : les 8 états `a_demarrer` / `en_cours` / `temps_ecoule` / `provisoire` / `litige` / `acquis` / `forfait` / `exempt`, le blocage de rotation, `lib/courtAlarm.ts` + `courtAlarmStorage.ts` pour les sonneries locales, chrono calculé depuis `started_at` (donc juste hors ligne) | Les couleurs d'état (§6), la carte « Ton terrain » (n° géant, mini-échelle T1→T4), le chrono Anton 92 px, le bloc d'action unique, l'écran plein noir de sonnerie (01c), le plein écran jaune de rotation suivante (01l), le bandeau hors ligne (01n), les compteurs − / + à la place du clavier | **non** | **M** |
| **02 Entrée** | `app/tournaments/index.tsx` (384 l.) avec en-tête sombre, épinglage de mes inscriptions, groupement, `ListFilters` + `HiddenByFilters` (jamais de cul-de-sac) | Les 3 sous-onglets À venir / En cours / Passés à remplacer par 2 onglets Tournois / Événements — **donc bloqué par le lot Événements** ; la grande carte « prochaine soirée », le podium « jeudi dernier », le bandeau « soirée en cours », les vides utiles, le tournoi annulé avec sa raison | 1 petite | **M** |
| **03 Fiche tournoi** | `app/tournaments/[id].tsx` (1914 l.) + `FicheHeros.tsx` : les trois phases sont là (avant = `RegistrationCard` + `StickyActionBar`, pendant = `LiveHero` / `RoundBanner` + mon terrain, après = `ResultHero` + `FinalStandings`), et la distinction « points en attente » / « points crédités » est déjà écrite | Le bloc « Comment ça tourne » (barème 100→15) n'existe pas ; le reste est du restyle | non | **S** |
| **05 Événement** | **rien** | Tout : tables `events` + `event_rsvps`, RLS, RPC, fiche, « J'y serai », « Me prévenir », cas externe FRMT | **oui** | **L** |
| **06 Mon parcours** | `app/tournaments/parcours.tsx` (386 l.) : cumuls (tournois, matchs, % victoires, points, podiums, tournois gagnés) et liste des résultats | L'histogramme des rangs par soirée, le meilleur rang, les rotations passées au T1, le binôme principal, l'état vide dessiné. Tout est calculable depuis `tournament_results` / `tournament_movements` — pas de nouvelle donnée | non | **M** |
| **07 Poste orga** | `components/admin/TournamentToRun.tsx` (149 l.) — une carte, une action du moment, barre de rotations ; le chemin de réparation d'un score clos existe (commit `962464c`) | La checklist de lancement (07a), la carte par blocage avec « Taper le score » / « Relancer les 4 » (07b) | non | **S/M** |
| **08 Création & inscription** | `create.tsx` (606 l.) a **déjà les 4 étapes** `QUAND & OÙ / LE TYPE / LE FORMAT / RÉCAPITULATIF` ; `ClubDropdown.tsx` fait déjà la **recherche** de club ; `tournament_join_requests` porte l'invitation partenaire avec son côté et sa notification ; `tournament_registrations.side` et `players.court_side` existent | La feuille 08a (choix Tournoi / Événement + « Refaire la montante de jeudi ») ; **l'appariement proposé par l'app** (08s→08u) n'existe pas — seule une fonction de lecture `tournament_pending_pairs` liste les joueurs seuls ; la relance automatique le lendemain 10:00 ; la clôture veille 20:00 ; les 4 étapes Événement (08h→08l) | **oui** | **M** |
| **09 Validation & classement** | Les statuts `TERMINE` → `CLASSEMENT_VALIDE`, `tournament_close`, la notification de validation (`trg_tournament_validated_notify`), le classement figé dès `TERMINE` | Le **signalement joueur** (09b) et l'historique des **corrections** : deux tables absentes ; la validation automatique le lendemain 12:00 ; l'aperçu en direct de l'effet d'une correction sur le classement ; la mention « CORRIGÉ » ; la notification de correction aux 4 joueurs | **oui** | **M/L** |

---

## 3. Le tableau « Données à ajouter » confronté au schéma réel

| Ce que le handoff demande | Réalité en base | Verdict |
|---|---|---|
| `tournament_matches.started_at` | **existe** (`tournament_court_clock.sql`) | ✅ déjà là |
| `tournament_matches.started_by` | absent — c'est la RPC `tournament_start_match` qui tient le geste | ⚠️ à créer *si* on veut afficher qui a lancé |
| `tournaments.round_duration_min` | **existe sous le nom `round_minutes`** (défaut 15) | ⚠️ piège de nom : ne pas créer de doublon |
| `tournaments.registration_closes_at` | absent. La clôture est aujourd'hui un **statut** (`INSCRIPTIONS_OUVERTES` → `COMPLET` → `CHECK_IN`), pas une date | ❌ à créer, avec le déclencheur horaire qui va avec |
| `tournaments.cancel_reason` | le statut `ANNULE` et la RPC `tournament_cancel` existent ; seule la **raison** manque | ⚠️ une colonne, rien de plus |
| `tournaments.validated_at` / `validated_by` / `auto_validate_at` | absents. Le statut `CLASSEMENT_VALIDE` existe | ❌ à créer pour l'auto-validation |
| `players.court_side` | **existe** (+ `preferred_side`) | ✅ déjà là |
| `tournament_registrations.side` | **existe** (`left` / `right` / `both`) | ✅ déjà là |
| `tournament_invites (…)` | **existe sous le nom `tournament_join_requests`**, avec côté, RPC `tournament_respond_join` et notification | ⚠️ piège de nom. Seul `reminded_at` (la relance) manque |
| `pair_proposals (…)` | absent. `tournament_pending_pairs` n'est qu'une **fonction de lecture** | ❌ à créer |
| `tournament_match_corrections (…)` | absent | ❌ à créer |
| `tournament_reports (…)` | absent | ❌ à créer |
| `events (…)` / `event_rsvps (…)` | absents (`analytics_events` n'a aucun rapport) | ❌ à créer |

**Bilan : 3 lignes déjà faites, 4 à retoucher seulement, 6 réellement à construire.**

---

## 4. Notifications

Sept déclencheurs serveur existent déjà sur les tournois : inscription, invitation,
demande de participation, promotion depuis la file, rotation suivante, forfait, validation.

| Ligne du handoff | Existant | Verdict |
|---|---|---|
| tournoi / événement publié → le club | — | ❌ à écrire |
| invitation partenaire | `trg_tournament_invite_notify` | ✅ |
| relance lendemain 10:00 / « Relancer » | — (pas de `reminded_at`) | ❌ |
| proposition d'appariement | — | ❌ |
| chrono à 0 (sonnerie) | `lib/courtAlarm.ts`, sonnerie locale avec son | ⚠️ écrit, **jamais essayé au poignet d'un vrai appareil** |
| rotation suivante | `trg_tournament_round_notify` | ✅ |
| correction de score | — | ❌ |
| points crédités | `trg_tournament_validated_notify` | ✅ |
| place libérée | `trg_tournament_registration_promoted` pour les tournois | ⚠️ à refaire pour les événements |

---

## 5. Les lots, dans l'ordre où je les ferais

| # | Lot | Pourquoi à cette place | Migr. | Coût |
|---|---|---|---|---|
| **0** | Le rouge des terrains + les compteurs de score | Défaut visible en production, six lignes (§6) | non | **S** |
| **1** | Habillage du mode soirée (01) | L'écran qu'on regarde dix fois dans la soirée, et le moteur est déjà là — meilleur rapport effet/effort du handoff | non | **M** |
| **2** | Fiche tournoi (03) + Poste orga (07) | Du restyle sur des écrans déjà structurés | non | **S/M** |
| **3** | Mon parcours (06) | Autonome, aucune donnée nouvelle | non | **M** |
| **4** | Événements (05 + 08h→08l) | La seule page blanche, et **l'entrée 02 en dépend** | oui | **L** |
| **5** | Entrée Tournois & Événements (02) | Ne peut pas se faire avant que les événements existent | 1 petite | **M** |
| **6** | Validation & classement (09) | Le plus lourd en base pour le moins de visible ; l'auto-validation actuelle suffit tant qu'un seul club joue | oui | **M/L** |
| **7** | Clôture 20:00, relance 10:00, appariement proposé (08) | Confort d'organisateur ; à notre échelle, un message règle le même problème | oui | **M** |

Si la V1 reste la priorité, les lots **0** et **1** sont les seuls qui se défendent
maintenant : aucune migration, aucun risque sur la base, et ils touchent l'écran que les
joueurs ont dans les mains le jeudi soir.

---

## 6. Le défaut déjà en production

`app/tournaments/soiree/[id].tsx` lignes 54-63 : la table des couleurs peint **quatre
états sur huit en rouge**, dont `en_cours`.

```
a_demarrer:   Colors.danger   ← gris attendu
en_cours:     Colors.danger   ← blanc + barre jaune attendus
temps_ecoule: Colors.danger   ← rouge légitime
litige:       Colors.danger   ← rouge légitime
```

Conséquence : pendant les 15 minutes où l'on joue, les quatre terrains sont rouges. Le
rouge ne veut donc plus rien dire, et le vrai signal — « quelqu'un doit aller parler à
quelqu'un » — passe inaperçu. Le handoff l'avait repéré, et il avait raison.

Les états, eux, sont déjà correctement séparés dans `lib/tournamentEvening.ts` : il n'y a
**que la table des couleurs à corriger**, pas la logique.

Second point du même ordre : la saisie du score passe par un `TextInput` en
`keyboardType="number-pad"` (ligne 664). Le handoff demande des compteurs − / +, « jamais
au clavier » — et il a raison : debout, entre deux points, les mains moites, un clavier
numérique se rate.

---

## 7. Pièges de nommage à ne pas rater

- `round_minutes`, pas `round_duration_min`.
- `tournament_join_requests`, pas `tournament_invites`.
- `tournament_pending_pairs` est une **fonction**, pas une table de propositions.
- La clôture et la validation existent comme **statuts**, pas comme dates : ajouter les
  dates ne doit pas créer une seconde vérité sur le même sujet.
- `analytics_events` n'a rien à voir avec les événements du handoff.
- Le dossier de handoff nomme l'app « tennis ». C'est du **padel** : ni le mot, ni la
  balle de tennis ne doivent entrer dans l'app.

---

## 8. Ce que je n'ai pas pu vérifier

- **L'état réel de la base de production.** Je lis les fichiers de migration, pas le
  serveur. Deux migrations sont notées « à appliquer » dans mes notes —
  `tournament_auto_advance.sql` et `tournament_score_effective.sql` — sans que je puisse
  confirmer d'ici si elles sont passées. À vérifier avant tout nouveau travail sur les
  tournois.
- **Les sonneries sur un vrai appareil.** Le code existe ; l'essai n'a jamais été fait.
- **Les prototypes interactifs** (01, 08, 09) : j'ai lu le `README.md` du handoff, qui
  décrit chaque état et son déclencheur, mais pas le rendu des `.dc.html` dans un
  navigateur. Un écart entre le texte et le dessin resterait invisible pour moi.

---

## 9. Hors périmètre du handoff lui-même

Le handoff le dit : formats Américano et Poules (affichés « Bientôt »), paiement dans
l'app, modification ou annulation d'un tournoi publié côté organisateur. Ces trois sujets
ne sont ni dessinés ni spécifiés.
