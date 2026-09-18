# Localisation — conception

Date : 2026-09-17
Statut : validée section par section avec l'utilisateur, en attente de relecture du document.

## 1. Objectif

Utiliser la localisation pour aider un joueur à trouver des parties près de lui :

1. **Parties près de moi** : filtrer et trier l'Explorer par distance, et favoriser la proximité dans les suggestions de l'accueil.
2. **Distance sur les fiches** d'une partie et d'un tournoi.
3. **Carte des parties** dans l'Explorer.
4. **Alertes de proximité** intégrées aux alertes enregistrées.

## 2. Existant (relevé le 2026-09-17)

- Table `clubs` : 108 clubs avec `latitude`, `longitude` et `geo_confidence` (`exact` ou `city`). **28 clubs sont précis et 80 sont placés au centre de leur ville** (coordonnées partagées). Sur les 160 parties créées depuis le 1er août, toutes correspondent à un club connu, mais 128 sont dans un club placé au centre-ville.
- Une partie désigne son club **par son nom** (`open_games.location`, texte), sans identifiant.
- `lib/maps.ts` : « Ouvrir dans Maps », cache des coordonnées des clubs par nom.
- `components/ClubsMapModal.tsx` + `lib/clubsMapHtml.ts` + `lib/clubsMap.ts` : carte Leaflet embarquée (WebView), utilisée dans l'assistant de création.
- `lib/exploreFilters.ts` : filtres purs et testés de l'Explorer ; `lib/savedFilters.ts` + déclencheur serveur `fn_notify_saved_filters` : alertes enregistrées.
- `lib/homeSlot.ts` : suggestions de l'accueil classées par priorités (niveau → urgence → club favori → date).
- Aucune géolocalisation du téléphone : pas de module, pas d'autorisation.

## 3. Décisions

| Sujet | Décision |
|---|---|
| Source de la position | GPS du téléphone si autorisé, sinon zone de référence |
| Zone de référence | Point placé sur une carte + rayon (5 / 10 / 20 / 40 km) |
| Explorer | Filtre « Distance max » + tri « Les plus proches » + distance sur chaque carte |
| Accueil | Priorités : niveau → proche → urgence → club favori → date |
| Fiches | Distance à vol d'oiseau (aucun service d'itinéraire) |
| Carte | Bascule Liste / Carte dans l'Explorer, mêmes filtres que la liste |
| Alertes | « Distance max » devient un critère des alertes enregistrées, mesuré depuis la zone |
| Calcul des distances | Dans le téléphone, à partir des coordonnées des clubs (approche A) |
| Module GPS | Chargé prudemment : absent d'un APK → repli sur la zone, sans plantage |
| Clubs mal placés | Lot 0 : fichier de positions fourni par l'utilisateur, validé ligne par ligne avant import |

Approches écartées : relier chaque partie à un `club_id` (utile, mais chantier séparé) ; faire calculer « les parties près de moi » par le serveur (imposerait d'envoyer la position GPS au serveur).

## 4. Découpage en lots

Chaque lot est livrable seul, dans cet ordre : **0 → 1 → 2 → 3 → 4**. Le lot 1 peut avancer en parallèle du lot 0 ; sans lot 0, la plupart des distances sont approximatives.

### Lot 0 — Positions précises des clubs

Source : fichier de l'utilisateur `base_clubs_padel_maroc_PAGMATCH.xlsx` (81 clubs : ville, nom, adresse, latitude, longitude, statut de vérification).

Mesures faites :
- justesse : sur les 11 clubs déjà précis en base et présents dans le fichier, 10 sont à moins de 170 m (médiane 70 m), un est à 54 km ;
- rapprochement automatique des noms pour les 80 clubs au centre-ville : environ 40 correspondances nettes (dont quelques fausses, trompées par le nom de la ville), 8 à vérifier, 32 absents du fichier.

Circuit :
1. Générer un **fichier Excel de vérification** des 80 clubs : correspondance proposée, coordonnées, lien Google Maps cliquable, distance au centre-ville, alertes (« seul le nom de la ville en commun », « point partagé par deux clubs », « loin de la ville »).
2. L'utilisateur remplit une colonne : `oui`, `non`, ou un **lien Google Maps** du bon emplacement (y compris pour les absents).
3. Transformer les seules lignes validées en **migration SQL** : `latitude`, `longitude`, `geo_confidence = 'exact'`, source notée. Les coordonnées d'un lien Google Maps sont extraites puis contrôlées (dans le Maroc, près de la ville du club).

Les clubs non validés restent `city`. Hors lot : ajouter à la base les clubs du fichier qui n'y sont pas.

### Lot 1 — Socle + Explorer

**Position (`lib/location.ts`, `hooks/useOrigin.ts`)**

Ordre de résolution du point de départ :
1. GPS : si autorisé et position de moins de 10 minutes. Autorisation demandée à la **première utilisation d'une fonction de distance**, jamais au lancement. Délai maximal 8 s, puis repli.
2. Zone de référence du joueur.
3. Aucun : fonctions de distance masquées, encart « Choisis ta zone ».

Le point de départ porte sa source (`gps` ou `zone`) ; l'interface l'affiche (« depuis ta position » / « depuis ta zone »).

Le module `expo-location` n'est **jamais importé directement** : il est chargé à l'exécution, et son absence (ancien APK) équivaut à un GPS indisponible. Un test garde-fou refuse tout import direct.

**Zone de référence**

- Réglage « Ma zone » dans le menu du profil, et depuis l'encart de l'Explorer : épingle déplaçable sur la carte Leaflet existante + choix du rayon.
- Table `player_zones` (`player_id` clé, `lat`, `lng`, `radius_km`, `updated_at`). Lecture et écriture **par le joueur uniquement** (règles d'accès). Coordonnées **arrondies au 0,005° le plus proche** (≈ 550 m en latitude, ≈ 460 m en longitude au Maroc) avant enregistrement, côté app et contrôlé côté serveur.
- La position GPS n'est jamais envoyée au serveur.
- Politique de confidentialité : mention de la zone et de l'usage local de la localisation.

**Distance (`lib/geo.ts`, pur et testé)**

- Distance à vol d'oiseau (formule de haversine).
- Affichage : « 800 m » sous 1 km, « 4,2 km » sous 10 km, « 23 km » au-delà.
- Coordonnées des clubs chargées une fois, retrouvées par nom normalisé (même règle que `lib/maps.ts`), avec leur précision.
- Résultat pour une partie : `{ km, approx }` ou `null`. `approx` = club placé au centre-ville → affiché « ~12 km ». `null` = lieu inconnu → rien d'affiché.

**Explorer**

- `ExploreFilters.maxKm : number | null` (5 / 10 / 20 / 40 / null). À la première activation, prend le rayon de la zone (20 km sans zone). Grisé sans point de départ.
- `exploreRefusal` : nouvelle raison `distance`. Refus si distance `null`, `approx`, ou supérieure à `maxKm`. La distance est fournie par le contexte (`ctx.distanceOf`), le module reste pur. Compte dans `activeExploreFilterCount`, libellé « Distance », pris en charge par `bestExploreFilterToDrop`.
- Tri **Date | Proximité** (état d'affichage, non enregistré dans les alertes) : fonction pure `sortByProximity` — distances précises croissantes, puis approximatives, puis inconnues ; la date départage.
- Carte de partie (`GameCard`) : mention « 4,2 km » / « ~12 km » à côté du club, dans l'Explorer et « À venir ».
- Distances calculées une fois par point de départ (mémoïsation), pas à chaque rendu.

### Lot 2 — Accueil + fiches

- `lib/homeSlot.ts` : critère « proche » inséré après le niveau. Proche = distance ≤ rayon de la zone, que la position du club soit exacte ou approximative (décision utilisateur 2026-09-18 : exiger une position exacte favorisait les 28 clubs vérifiés au détriment de parties réellement plus proches) (20 km par défaut sans zone). Distance fournie en paramètre. Sans point de départ, critère ignoré (ordre actuel inchangé). Tests : une partie proche passe devant une partie urgente éloignée ; sans position, rien ne change.
- Carte « Prochain match » : distance à côté du club.
- Fiche de partie (« Informations de la partie ») et fiche de tournoi (près de l'adresse) : « 4,2 km depuis ta position / ta zone », à côté du bouton « Ouvrir dans Maps ». Club au centre-ville : « ~12 km (position approximative du club) ». Sans point de départ ou lieu inconnu : pas de ligne.

### Lot 3 — Carte

- Sélecteur **Liste | Carte** en haut de l'Explorer ; la carte affiche les parties retenues par `filterExplore` (mêmes filtres, recherche comprise), mises à jour sans rechargement de la carte.
- Repères (fonction pure `groupMapMarkers`, testée) :
  - un repère par position de club **précise**, avec le nombre de parties ;
  - les clubs **au centre-ville** regroupés en **un repère par ville**, style atténué, « emplacement exact inconnu ».
- Point de départ : point bleu (GPS) ou repère de zone ; cercle du rayon si « Distance max » est actif. Carte centrée sur le point de départ, sinon cadrée sur les repères.
- Toucher un repère : panneau en bas **dessiné dans l'écran** (pas de fenêtre modale native) listant club(s) et parties (heure, niveau, places, distance) ; toucher une partie ouvre sa fiche habituelle.
- Réutilise l'asset Leaflet embarqué : `buildClubsMapHtml` élargi (point de départ, cercle, repères de ville) sans changement de comportement pour l'assistant de création. Échanges app ↔ carte par messages, comme dans l'assistant.
- Hors ligne : « Carte indisponible hors ligne », la liste reste utilisable.

### Lot 4 — Alertes

- `lib/savedFilters.ts` : `maxKm` rejoint les critères surveillés, libellé « Distance : moins de N km de ta zone », tests.
- Enregistrer une alerte avec distance sans zone → proposer d'abord « Choisis ta zone ».
- Supprimer sa zone → avertissement « Tes N alertes avec distance ne se déclencheront plus ».
- Serveur : fonction SQL `distance_km(lat1, lng1, lat2, lng2)` (haversine, sans extension). `fn_notify_saved_filters` reprend **à l'identique** la version en production (vérifiée à l'implémentation) et ajoute : si `criteria->>'maxKm'` est renseigné, le club de la partie doit être `exact` et à distance ≤ `maxKm` de la zone du joueur (`player_zones`). Club au centre-ville ou joueur sans zone → pas de correspondance.
- La zone est lue au moment de la création de la partie : changer de zone met toutes les alertes à jour.
- Une seule notification par partie et par joueur, comme aujourd'hui.

## 5. Livraison

- Chaque lot publié sur la branche `preview` **après** application de sa migration (lot 0 : positions des clubs ; lot 1 : `player_zones` ; lot 4 : `distance_km` + déclencheur). L'app tolère une migration absente : fonction concernée masquée.
- `expo-location` : fonctionne dans Expo Go. **Un nouvel APK** est nécessaire une fois, avec les autorisations de localisation ajoutées **à la main** au manifeste Android (pas de régénération du dossier natif) ; textes d'autorisation iOS en français via le plugin.

## 6. Erreurs

| Situation | Comportement |
|---|---|
| GPS refusé | Repli sur la zone |
| Position « approximative » (Android) | Utilisée telle quelle |
| GPS sans réponse en 8 s | Repli sur la zone |
| APK sans le module GPS | Repli sur la zone, aucun plantage |
| Carte hors ligne | Message, liste utilisable |
| Échec d'enregistrement de la zone | Message clair, ancienne zone conservée |
| Migration non appliquée | Fonction concernée masquée |

## 7. Tests

- Automatiques (vitest) : `lib/geo` (calcul, affichage, précision), filtre `distance` et tri de proximité, priorités de l'accueil, `groupMapMarkers`, critère d'alerte, rapprochement et contrôles du lot 0.
- Garde-fou : aucun import direct de `expo-location`.
- Manuels sur téléphone : demande d'autorisation iOS et Android, ancien APK sans le module, carte hors ligne.

## 8. Hors périmètre

Temps de trajet ; ajout des clubs du fichier absents de la base ; lien `club_id` entre parties et clubs ; outil de placement des clubs dans le panel arbitre.
