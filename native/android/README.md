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

## La solution durable, le jour où ça vaudra la peine

La réponse prévue par Expo pour du code natif maison dans un projet où
`android/` est régénéré, c'est un **plugin de configuration** : un bout de
JavaScript qui recopie ces fichiers et ajoute la ligne automatiquement à chaque
`prebuild`. Tant que ce plugin n'existe pas, la manœuvre ci-dessus est à refaire
à la main après chaque régénération.
