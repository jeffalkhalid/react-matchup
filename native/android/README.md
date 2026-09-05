# Code natif Android écrit à la main

Ces trois fichiers Kotlin **ne sont pas générés par Expo**. Ils servent au
remplissage automatique des mots de passe sur Android, et notamment au
contournement du problème rencontré sur les écrans d'authentification Samsung.

- `AutofillModule.kt` — expose `AutofillManager` d'Android au JavaScript
  (dont `notifyViewEntered`, resté muet sur certains appareils Samsung).
- `CredentialManagerModule.kt` — enregistrement d'un mot de passe dans le
  gestionnaire d'identifiants Android (`androidx.credentials`).
- `AutofillPackage.kt` — déclare les deux modules à React Native.

## Pourquoi ils sont ici et pas seulement dans `android/`

Le dossier `android/` est **fabriqué par Expo** (`npx expo prebuild`) et il est
exclu de git : il est considéré comme jetable. Ces trois fichiers, eux, ne sont
pas refabricables — ils n'existaient nulle part ailleurs qu'à un seul endroit,
sur une seule machine, dans un dossier qu'une simple régénération efface.

Cette copie est leur seul exemplaire durable. **Ne pas la supprimer.**

## Où les remettre après une régénération

Après tout `npx expo prebuild` (surtout avec `--clean`), qui recrée `android/`
de zéro :

1. Recopier les trois fichiers dans
   `android/app/src/main/java/com/pagmatch/app/`
2. Rouvrir `android/app/src/main/java/com/pagmatch/app/MainApplication.kt` et
   ajouter la ligne de raccordement dans `getPackages()` :

   ```kotlin
   override fun getPackages(): List<ReactPackage> =
       PackageList(this).packages.apply {
         add(AutofillPackage())
       }
   ```

Sans cette ligne, les fichiers sont présents mais React Native ne les voit pas :
le remplissage automatique cesse de fonctionner **sans aucune erreur visible**.

3. Rouvrir `android/app/build.gradle` et remettre, dans le bloc
   `dependencies { }`, les deux lignes dont `CredentialManagerModule.kt` a
   besoin :

   ```gradle
   implementation("androidx.credentials:credentials:1.3.0")
   implementation("androidx.credentials:credentials-play-services-auth:1.3.0")
   ```

   Cette étape a été **oubliée** lors de la montée en Expo 57 : les trois
   fichiers avaient bien été recopiés et la ligne d'enregistrement remise,
   mais `app/build.gradle` avait été refabriqué depuis le gabarit Expo, sans
   ces dépendances. La compilation s'est arrêtée sur trente-cinq
   « Unresolved reference » de `androidx.credentials`, après dix-neuf minutes
   de build.

   L'échec est brutal et lisible, contrairement à celui de l'étape 2 — mais
   il n'apparaît qu'à la toute fin. Les deux versions sont celles qui
   fonctionnaient avant la régénération ; elles sont déjà dans le cache
   Gradle local, la remise en état ne demande donc pas de réseau.

## Les autres réglages que `prebuild` efface

Ils ne concernent pas le code natif maison, mais ils vivent dans les mêmes
fichiers jetables et disparaissent de la même façon.

**`android/gradle.properties` — mémoire du build.** Le gabarit Expo donne
`-Xmx2048m -XX:MaxMetaspaceSize=512m`. Le build de **debug** passe avec ça, le
build de **release** non : il dexe toutes les dépendances d'un coup et D8 meurt
en `OutOfMemoryError: Metaspace` sur `:app:mergeExtDexRelease`. Valeur remise :

```properties
org.gradle.jvmargs=-Xmx6144m -XX:MaxMetaspaceSize=2048m
```

La réponse durable ici serait le plugin **`expo-build-properties`**, qui écrit
ces valeurs à chaque `prebuild` depuis `app.json`. Il n'est pas installé.

## La solution durable, le jour où ça vaudra la peine

La réponse prévue par Expo pour du code natif maison dans un projet où
`android/` est régénéré, c'est un **plugin de configuration** : un bout de
JavaScript qui recopie ces fichiers, ajoute la ligne d'enregistrement ET les
deux dépendances Gradle, automatiquement, à chaque `prebuild`. Tant que ce
plugin n'existe pas, les trois étapes ci-dessus sont à refaire à la main après
chaque régénération — et l'expérience montre qu'on en oublie une.
