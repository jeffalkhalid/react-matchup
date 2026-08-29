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

## Hors périmètre

La publication sur le Play Store n'est pas prévue pour cette app, à aucune
étape du projet : elle est installée à la main (sideload via `adb`/Gradle)
tout au long de son développement et de son usage.
