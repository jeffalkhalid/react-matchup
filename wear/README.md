# PAG MATCH — Wear OS

Application Wear OS (Samsung Galaxy Watch et compatibles) autonome pour
PAG MATCH : elle permet de scorer un match de padel directement au poignet,
sans dépendre du téléphone. C'est la petite sœur Wear OS de l'app Garmin qui
existe déjà dans `watch/` (Connect IQ / Monkey C) : même idée, plateforme et
toolchain différentes (Kotlin + Jetpack Compose for Wear OS + Gradle).

## Indépendance vis-à-vis du projet Expo

Ce dossier est un projet Gradle Android **totalement séparé** du dossier
`android/` à la racine du dépôt. `android/` est généré (et régénéré) par
`expo prebuild` pour l'app téléphone React Native — il est git-ignoré et peut
être effacé/reconstruit à tout moment. Un module placé dedans serait donc
perdu au premier `expo prebuild`.

`wear/` n'est jamais touché par Expo : c'est un projet Android natif classique
avec son propre `settings.gradle.kts`, son propre wrapper Gradle, son propre
`applicationId` (`com.pagmatch.wear`, distinct de `com.pagmatch.app` sur
téléphone). Il peut vivre indéfiniment dans le dépôt sans jamais être écrasé.

## Prérequis locaux

- Android Studio installé (fournit le SDK Android et le JBR).
- `JAVA_HOME` doit pointer sur le JBR d'Android Studio, pas sur le `java` du
  PATH (souvent un vieux JRE 1.8 incompatible avec Gradle/AGP) :

  ```powershell
  $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
  ```

## Compiler

```powershell
cd wear
.\gradlew.bat assembleDebug
```

L'APK debug est produit dans `wear/app/build/outputs/apk/debug/app-debug.apk`.

## Installer sur un émulateur ou une montre

```powershell
cd wear
.\gradlew.bat installDebug
```

Nécessite un appareil Wear OS déjà démarré (émulateur rond créé dans Android
Studio, ou montre physique en mode développeur connectée via `adb`).

## Lancer les tests

```powershell
cd wear
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
.\gradlew.bat testDebugUnitTest --rerun-tasks
```

`--rerun-tasks` n'est pas décoratif : sans lui Gradle considère la tâche
`up-to-date` et **n'exécute rien** dès que rien n'a changé — on lit alors un
`BUILD SUCCESSFUL` qui ne prouve rien.

## Vérifier le rendu rond — le piège de l'émulateur

**Le piège.** Un AVD Wear OS créé avec `hw.lcd.circular = false` affiche un
écran rond **en carré**. Android ne pose alors pas `FLAG_ROUND` sur la fenêtre,
donc **le système ne découpe jamais l'image au disque** : les captures sont
parfaites et cachent tout ce que le verre trancherait en réalité. Coût mesuré
sur ce projet : **six défauts d'affichage restés invisibles pendant quatre
tâches**, dont un nom d'équipe coupé en plein milieu d'une lettre — avec, à
chaque fois, des captures d'écran qui semblaient bonnes.

Le rognage rond n'est pas une troncature Compose : il arrive **après** la mise
en page, dans le tampon d'image. Il ne produit donc **aucun point de
suspension** — rien à l'écran ne signale que le texte est coupé. C'est
exactement pour cela qu'il faut le mesurer et pas le regarder.

**Comment vérifier, dans l'ordre :**

1. **Le fichier de l'AVD.**
   `%USERPROFILE%\.android\avd\<Nom>.avd\config.ini` doit contenir
   `hw.lcd.circular = true`. Un profil d'appareil rond dans Android Studio ne
   suffit pas à le garantir : c'est cette ligne-là qui décide.
2. **L'appareil qui tourne.**
   `adb shell dumpsys window | Select-String FLAG_ROUND` doit renvoyer quelque
   chose. Absent = l'émulateur ment sur sa forme, toute capture prise dessus
   est sans valeur pour un défaut de bord.
3. **Le comptage de pixels sur la capture.** Nombre de pixels **peints** hors
   du cercle inscrit : doit être **zéro**.
   Attention au sens de ce zéro : sur un écran vraiment rond il est zéro **par
   construction**, puisque le système a déjà découpé. Ce qui discrimine
   réellement, c'est la **marge minimale** entre le texte peint et le bord du
   verre : une marge de ~0 px veut dire « le texte atteint exactement le bord »,
   donc qu'il **est** tranché. Mesurer la marge, pas seulement le compte. Sur le
   carré, mêmes mesures mais sur les quatre côtés (le cercle inscrit n'y a aucun
   sens).

Trois AVD couvrent les cas utiles : `wearos_small_round` (384 px = 192 dp),
`wearos_large_round` (454 px = 227 dp) et `wearos_square` (360 px = **180 dp**).
Le carré est **le plus étroit des trois en dp** : c'est lui, et non le petit
rond, le pire cas de largeur.

## Invariants à connaître avant de toucher au code

Chacun est justifié en détail à son point d'appel ; cette liste existe pour
qu'on sache **qu'il faut aller y lire** avant de modifier quoi que ce soit.

- **Un seul `MatchStore` et une seule `Queue` par processus.** Passer par
  `MatchStore.get()` ; le constructeur est `internal`. Deux `Queue` sur le même
  `SharedPreferences` ont perdu **265 à 280 événements sur 320** à la mesure
  (commentaire de classe de `MatchStore.kt`, `enqueue()` dans `Queue.kt`).
- **Mettre en file par `Queue.enqueue()`, jamais par `nextSeq()` + `push()`.**
  Ces deux primitifs sont `internal` et n'ont aucun appelant dans `main/` : le
  processus qui meurt entre les deux appels consomme un numéro de séquence sans
  jamais écrire l'événement — un point perdu, irrécupérable.
- **Toute écriture de préférences par `commit()`, jamais `apply()`.**
  L'atomicité de la file suppose qu'un `putString()` qui retourne a atteint le
  disque, et que deux écritures s'appliquent dans l'ordre émis (`Prefs.kt`,
  `KeyValueStore` dans `Queue.kt`).
- **Ne jamais capturer le balayage vers la droite** : c'est le retour système de
  Wear OS. `Modifier.clickable` ne prend qu'un tapotement et le laisse passer ;
  un `pointerInput`/`draggable` posé sur toute la surface le confisquerait.
- **Toutes les chaînes affichées en ASCII pur, sans accent, et courtes.** La
  police du cadran et celle des notifications ne garantissent pas les accents,
  et ce qui est long ne se lit pas en plein soleil, une balle dans la main
  (`ONGOING_MAX_CHARS`, `ui/Fit.kt`). Ce fichier-ci est de la documentation :
  les accents y sont normaux, à l'écran non.
- **La couleur ne porte jamais une information seule** : les équipes sont
  distinguées par leur **position** (haut / bas), jamais par une teinte.
- **Brancher sur la FORME et sur les CAPACITÉS, jamais sur un modèle
  d'appareil.** `LocalConfiguration.isScreenRound`, la place réellement
  disponible mesurée (`ui/Fit.kt`), la version d'API — jamais la marque, la
  définition ni le nom commercial de la montre.
- **Aucun état de match écrit hors de `applySession()`** : effacer le match est
  un écrit comme un autre et doit passer par le même numéro d'ordre, sinon une
  réponse partie avant lui et atterrie après le ressuscite.

## Hors périmètre

La publication sur le Play Store n'est pas prévue pour cette app, à aucune
étape du projet : elle est installée à la main (sideload via `adb`/Gradle)
tout au long de son développement et de son usage.
