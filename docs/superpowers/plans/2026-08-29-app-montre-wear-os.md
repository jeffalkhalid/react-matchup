# App montre Wear OS (Samsung) — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une application Wear OS autonome qui permet de scorer un match de padel au poignet, à parité complète avec l'app Garmin déjà livrée.

**Architecture:** Projet Gradle autonome dans `wear/`, sans aucun lien avec le projet Android régénéré par `expo prebuild`. Kotlin + Compose for Wear OS. La montre appelle **directement** les quatre fonctions Supabase déjà déployées, avec le même jeton d'appairage et la même idempotence que la Garmin. Aucune modification du backend, de l'app téléphone, ni de l'app Garmin.

**Tech Stack:** Kotlin, Jetpack Compose for Wear OS, Gradle (Kotlin DSL), OkHttp, kotlinx.serialization, `androidx.wear:wear-ongoing`, JUnit pour les tests JVM.

**Spec:** `docs/superpowers/specs/2026-08-29-app-montre-wear-os-design.md`

## Global Constraints

- **Aucun cas particulier par modèle.** Brancher sur une capacité (écran rond, présence d'une lunette), jamais sur un identifiant d'appareil, une taille d'écran ou une marque.
- **La couleur décore, elle n'informe jamais.** Ce qui distingue les deux équipes est leur position — haut et bas — jamais leur teinte.
- **Annulation et validation ne partagent JAMAIS le même geste.**
- **Le balayage vers la droite appartient au système Wear OS.** Ne jamais le capturer ni le détourner.
- **Aucun point ne s'ajoute en silence** : chaque point marqué s'annonce à l'écran. L'annulation est un **bouton visible**, jamais un geste caché.
- **`client_seq` est monotone et jamais réutilisé** : c'est la clé d'idempotence côté serveur, sur `(session_id, watch_link_id, client_seq)`.
- **Un événement est enregistré dans la file AVANT d'être envoyé**, et reste en tête tant qu'il n'est pas acquitté.
- **Compiler ne prouve rien sur l'affichage.** Sur le chantier Garmin, la compilation validait 53 modèles pendant que 13 sur 14 affichaient des lignes superposées.
- **Vérifier les API avant de s'appuyer dessus** — `androidx.wear.ongoing`, le mode ambiant, le type de service de premier plan et le lever de poignet sont attendus tels que décrits, mais doivent être lus dans la documentation, pas présumés.
- Identifiant applicatif : `com.pagmatch.wear` (distinct de `com.pagmatch.app`, qui est le téléphone).
- `minSdk = 30` (Wear OS 3, première version des Galaxy Watch 4).
- **La publication au Play Store est hors périmètre.** L'app s'installe à la main pendant tout ce plan.
- Ne jamais modifier `watch/` (app Garmin), `supabase/` ni `app/` : ce plan n'y touche pas.

---

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `wear/settings.gradle.kts`, `wear/build.gradle.kts`, `wear/gradle/libs.versions.toml` | Projet Gradle autonome |
| `wear/app/build.gradle.kts` | Dépendances et cibles du module |
| `wear/app/src/main/AndroidManifest.xml` | Déclarations, permissions, service |
| `wear/app/src/main/java/com/pagmatch/wear/Config.kt` | URL Supabase, clé anon, étiquette de l'appareil |
| `wear/app/src/main/java/com/pagmatch/wear/Api.kt` | Les 4 appels serveur + extraction des refus |
| `wear/app/src/main/java/com/pagmatch/wear/Queue.kt` | File persistante + `client_seq` |
| `wear/app/src/main/java/com/pagmatch/wear/Session.kt` | Modèle du payload serveur |
| `wear/app/src/main/java/com/pagmatch/wear/MatchStore.kt` | État observable + boucle d'envoi |
| `wear/app/src/main/java/com/pagmatch/wear/ui/PairingScreen.kt` | Saisie du code à 6 chiffres |
| `wear/app/src/main/java/com/pagmatch/wear/ui/MatchScreen.kt` | Tableau de match + saisie des points |
| `wear/app/src/main/java/com/pagmatch/wear/ui/ConfirmScreen.kt` | Confirmation de validation |
| `wear/app/src/main/java/com/pagmatch/wear/MainActivity.kt` | Point d'entrée et navigation |
| `wear/app/src/main/java/com/pagmatch/wear/OngoingMatch.kt` | Activité en cours + service de premier plan |
| `wear/app/src/test/java/com/pagmatch/wear/*Test.kt` | Tests JVM |

**Nouveauté par rapport à la Garmin : il existe un vrai framework de test.** Monkey C n'en avait aucun, ce qui obligeait à tout vérifier à l'œil. Ici, la file, l'idempotence, le parsing du payload et l'extraction des refus se testent en JVM, sans montre. C'est là que se cachaient les bugs les plus coûteux du chantier Garmin : ils deviennent testables.

---

### Task 1 : Squelette du projet et première compilation

**Files:**
- Create: `wear/settings.gradle.kts`, `wear/build.gradle.kts`, `wear/gradle/libs.versions.toml`
- Create: `wear/app/build.gradle.kts`, `wear/app/src/main/AndroidManifest.xml`
- Create: `wear/app/src/main/java/com/pagmatch/wear/MainActivity.kt`
- Create: `wear/.gitignore`, `wear/README.md`

**Interfaces:**
- Consumes: rien.
- Produces: un projet Gradle qui compile, et la commande de build que toutes les tâches suivantes réutilisent.

- [ ] **Step 1 : Créer le projet Gradle**

Créer `wear/settings.gradle.kts` :

```kotlin
pluginManagement {
    repositories { google(); mavenCentral(); gradlePluginPortal() }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories { google(); mavenCentral() }
}
rootProject.name = "PagMatchWear"
include(":app")
```

Créer `wear/build.gradle.kts` :

```kotlin
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.serialization) apply false
}
```

- [ ] **Step 2 : Déclarer les dépendances**

Créer `wear/gradle/libs.versions.toml`. **Résoudre les versions au moment de l'installation** — prendre les dernières stables et laisser la compilation les valider ; ne pas recopier des numéros supposés.

```toml
[versions]
agp = "RESOUDRE"          # Android Gradle Plugin stable
kotlin = "RESOUDRE"
composeBom = "RESOUDRE"   # androidx.compose:compose-bom
[libraries]
androidx-activity-compose = { module = "androidx.activity:activity-compose" }
compose-bom = { module = "androidx.compose:compose-bom", version.ref = "composeBom" }
compose-ui-tooling = { module = "androidx.compose.ui:ui-tooling" }
wear-compose-material = { module = "androidx.wear.compose:compose-material" }
wear-compose-foundation = { module = "androidx.wear.compose:compose-foundation" }
wear-ongoing = { module = "androidx.wear:wear-ongoing" }
okhttp = { module = "com.squareup.okhttp3:okhttp" }
kotlinx-serialization-json = { module = "org.jetbrains.kotlinx:kotlinx-serialization-json" }
junit = { module = "junit:junit" }
[plugins]
android-application = { id = "com.android.application", version.ref = "agp" }
kotlin-android = { id = "org.jetbrains.kotlin.android", version.ref = "kotlin" }
kotlin-serialization = { id = "org.jetbrains.kotlin.plugin.serialization", version.ref = "kotlin" }
```

Le mot `RESOUDRE` doit avoir disparu du fichier à la fin de cette tâche. S'il reste, la tâche n'est pas finie.

Créer `wear/app/build.gradle.kts` :

```kotlin
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.serialization)
}
android {
    namespace = "com.pagmatch.wear"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.pagmatch.wear"
        minSdk = 30
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
    }
    buildFeatures { compose = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
dependencies {
    implementation(platform(libs.compose.bom))
    implementation(libs.androidx.activity.compose)
    implementation(libs.wear.compose.material)
    implementation(libs.wear.compose.foundation)
    implementation(libs.wear.ongoing)
    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)
    debugImplementation(libs.compose.ui.tooling)
    testImplementation(libs.junit)
}
```

- [ ] **Step 3 : Le manifeste**

Créer `wear/app/src/main/AndroidManifest.xml` :

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-feature android:name="android.hardware.type.watch" />
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <application
        android:label="PAG MATCH"
        android:supportsRtl="false"
        android:theme="@android:style/Theme.DeviceDefault">
        <!-- standalone=true : l'app parle directement au serveur, elle ne
             depend d'aucune app telephone installee. -->
        <meta-data android:name="com.google.android.wearable.standalone" android:value="true" />
        <activity android:name=".MainActivity" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
```

- [ ] **Step 4 : Un écran minimal**

Créer `wear/app/src/main/java/com/pagmatch/wear/MainActivity.kt` :

```kotlin
package com.pagmatch.wear

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { App() }
    }
}

@Composable
fun App() {
    MaterialTheme {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text("PAG MATCH")
        }
    }
}
```

- [ ] **Step 5 : Ignorer les artefacts de build**

Créer `wear/.gitignore` :

```
.gradle/
build/
local.properties
*.iml
.idea/
```

- [ ] **Step 6 : Compiler**

`JAVA_HOME` doit pointer sur le JBR d'Android Studio, comme pour les builds Android du dépôt (le JRE 1.8 du PATH est trop vieux).

Run: `cd wear; .\gradlew.bat assembleDebug`
Expected: `BUILD SUCCESSFUL`, et un APK produit sous `wear/app/build/outputs/apk/debug/`.

Si le wrapper Gradle n'existe pas encore, le générer avec `gradle wrapper` ou en copiant celui d'un projet Android récent, puis le committer.

- [ ] **Step 7 : Lancer sur un émulateur Wear OS**

Créer un appareil virtuel Wear OS rond dans Android Studio, puis :

Run: `cd wear; .\gradlew.bat installDebug`
Expected: l'app apparaît dans la liste des applications de la montre virtuelle et affiche « PAG MATCH ».

**Rendre compte de ce qui a été vu à l'écran**, pas seulement du succès de la commande.

- [ ] **Step 8 : Documenter**

Créer `wear/README.md` : à quoi sert ce projet, en quoi il est indépendant du projet Expo (`android/` est régénéré par `expo prebuild`, ce projet ne l'est pas), la commande de build, la commande d'installation, et le fait que la publication au Play Store est hors périmètre.

- [ ] **Step 9 : Commit**

```bash
git add wear/
git commit -m "feat(wear): squelette du projet Wear OS autonome"
```

---

### Task 2 : Réglages et appels serveur

**Files:**
- Create: `wear/app/src/main/java/com/pagmatch/wear/Config.kt`
- Create: `wear/app/src/main/java/com/pagmatch/wear/Api.kt`
- Test: `wear/app/src/test/java/com/pagmatch/wear/ApiTest.kt`

**Interfaces:**
- Consumes: le projet de la Task 1.
- Produces: `Config.SUPABASE_URL`, `Config.ANON_KEY`, `Config.deviceLabel(): String` ; `Api.errorReason(json: String?): String?`, `Api.reasonPair(reason: String?): Pair<String, String>?`, et quatre fonctions suspendues `Api.redeem(code: String, label: String): String` (renvoie le jeton), `Api.currentSession(token: String): String` (JSON brut), `Api.applyEvent(token: String, sessionId: String, eventType: String, team: Int, clientSeq: Long): String`, `Api.finalize(token: String, sessionId: String): String`.

**Contrat serveur, relevé sur l'app Garmin — à respecter au caractère près.** Les quatre fonctions sont des POST sur `{SUPABASE_URL}/rest/v1/rpc/{nom}`, avec les en-têtes `Content-Type: application/json`, `apikey: {ANON_KEY}` et `Authorization: Bearer {ANON_KEY}`.

| Fonction | Corps | Réponse |
|---|---|---|
| `redeem_watch_pairing_code` | `{"p_code":…, "p_device_label":…}` | `{"ok":true,"token":"…"}` ou `{"ok":false,"reason":"…"}` |
| `watch_current_session` | `{"p_token":…}` | l'objet de session, ou `{"has_session":false}` |
| `watch_apply_event` | `{"p_token":…,"p_session_id":…,"p_event_type":…,"p_payload":{"team":…},"p_client_seq":…}` | objet de session mis à jour |
| `watch_finalize_session` | `{"p_token":…,"p_session_id":…}` | `{"ok":true,"match_id":"…"}` |

**Deux formes de refus, et c'est le piège** : PostgREST renvoie le texte d'un `RAISE` dans le champ `message` (`{"code":"P0001","message":"not_the_scorer"}`), tandis que `redeem_watch_pairing_code` répond **200** avec `{"ok":false,"reason":"…"}`. Une seule fonction doit lire les deux clés.

- [ ] **Step 1 : Écrire les tests d'abord**

Créer `wear/app/src/test/java/com/pagmatch/wear/ApiTest.kt` :

```kotlin
package com.pagmatch.wear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ApiTest {
    @Test fun `lit le message d un RAISE postgrest`() {
        assertEquals("not_the_scorer",
            Api.errorReason("""{"code":"P0001","message":"not_the_scorer"}"""))
    }

    @Test fun `lit le reason d un refus d appairage`() {
        assertEquals("code_invalid",
            Api.errorReason("""{"ok":false,"reason":"code_invalid"}"""))
    }

    @Test fun `renvoie null quand il n y a pas de refus`() {
        assertNull(Api.errorReason("""{"ok":true,"token":"abc"}"""))
        assertNull(Api.errorReason(null))
        assertNull(Api.errorReason("pas du json"))
    }

    @Test fun `chaque raison connue porte une forme riche et une forme courte`() {
        val p = Api.reasonPair("not_the_scorer")!!
        assertEquals("Plus le scoreur", p.first)
        assertEquals("Pas toi", p.second)
    }

    @Test fun `une raison inconnue ne casse rien`() {
        assertNull(Api.reasonPair("raison_jamais_vue"))
        assertNull(Api.reasonPair(null))
    }
}
```

- [ ] **Step 2 : Lancer les tests, vérifier qu'ils échouent**

Run: `cd wear; .\gradlew.bat :app:testDebugUnitTest`
Expected: ÉCHEC — `Api` n'existe pas encore.

- [ ] **Step 3 : Écrire `Config.kt`**

```kotlin
package com.pagmatch.wear

import android.os.Build

// SEUL fichier a toucher si le projet Supabase change.
// La cle anon est PUBLIQUE par conception (deja embarquee dans l'APK) : les
// droits reels sont portes par le jeton d'appairage, jamais par cette cle.
object Config {
    // Recopier les deux valeurs depuis watch/source/Config.mc, a l'identique.
    const val SUPABASE_URL = "https://icshhobxeppttgayxmba.supabase.co"
    const val ANON_KEY = "<recopier depuis watch/source/Config.mc>"

    // Etiquette envoyee a l'appairage (watch_links.device_label) et RELUE PAR
    // L'UTILISATEUR dans la liste des montres liees du telephone. Ce n'est PAS
    // une decision de mise en page : rien ici ne doit servir a choisir une
    // taille ou une position.
    fun deviceLabel(): String {
        val model = Build.MODEL?.trim()
        return if (model.isNullOrEmpty()) "Montre Wear OS" else model
    }
}
```

Sur la Garmin, l'équivalent était figé à `"epix2"` pour les 53 modèles, si bien qu'un vivoactive6 apparaissait comme un epix2 dans le téléphone. Ici `Build.MODEL` donne directement un nom lisible ; le repli générique reste honnête là où un modèle précis mais faux ne l'est pas.

- [ ] **Step 4 : Écrire `Api.kt`**

```kotlin
package com.pagmatch.wear

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

object Api {
    private val client = OkHttpClient()
    private val JSON = "application/json".toMediaType()
    private val lenient = Json { ignoreUnknownKeys = true; isLenient = true }

    // ---- Refus serveur : les rendre LISIBLES au poignet --------------------
    // PostgREST renvoie le texte du RAISE dans "message"
    // ({"code":"P0001","message":"not_the_scorer"}). redeem_watch_pairing_code
    // repond 200 avec {"ok":false,"reason":"..."} : meme extraction, deux cles.
    fun errorReason(body: String?): String? {
        if (body == null) return null
        return try {
            val o = lenient.parseToJsonElement(body).jsonObject
            val m = o["message"] ?: o["reason"] ?: return null
            m.jsonPrimitive.content
        } catch (e: Exception) { null }
    }

    // LA PAIRE EST L'UNITE D'EDITION. Chaque raison porte DEUX formulations :
    // la riche, et le repli court employe quand la riche ne tient pas. Les
    // separer en deux tables etait un piege sur la Garmin : ajouter une raison
    // a l'une sans penser a l'autre rendait l'ecran muet pour cette seule
    // raison, sans que rien ne le signale.
    fun reasonPair(reason: String?): Pair<String, String>? = when (reason) {
        null -> null
        "token_revoked"     -> "Montre deliee"      to "Deliee"
        "not_the_scorer"    -> "Plus le scoreur"    to "Pas toi"
        "session_not_live"  -> "Match termine"      to "Termine"
        "feature_disabled"  -> "Fonction desactivee" to "Desactivee"
        "watch_has_control" -> "Montre a la main"   to "Montre"
        "phone_has_control" -> "Tel a la main"      to "Tel"
        "rate_limited"      -> "Trop d essais"      to "Trop d essais"
        "code_invalid"      -> "Code invalide"      to "Invalide"
        "code_expired"      -> "Code expire"        to "Expire"
        "no_winner"         -> "Pas de vainqueur"   to "Pas fini"
        "not_enough_sets"   -> "2 sets minimum"     to "2 sets min"
        else -> null
    }

    private suspend fun post(path: String, body: String): String = withContext(Dispatchers.IO) {
        val req = Request.Builder()
            .url("${Config.SUPABASE_URL}/rest/v1/rpc/$path")
            .addHeader("apikey", Config.ANON_KEY)
            .addHeader("Authorization", "Bearer ${Config.ANON_KEY}")
            .post(body.toRequestBody(JSON))
            .build()
        client.newCall(req).execute().use { it.body?.string() ?: "" }
    }

    private fun q(s: String) = Json.encodeToString(kotlinx.serialization.json.JsonPrimitive(s))

    suspend fun redeem(code: String, label: String): String =
        post("redeem_watch_pairing_code", """{"p_code":${q(code)},"p_device_label":${q(label)}}""")

    suspend fun currentSession(token: String): String =
        post("watch_current_session", """{"p_token":${q(token)}}""")

    suspend fun applyEvent(
        token: String, sessionId: String, eventType: String, team: Int, clientSeq: Long
    ): String = post("watch_apply_event",
        """{"p_token":${q(token)},"p_session_id":${q(sessionId)},"p_event_type":${q(eventType)},"p_payload":{"team":$team},"p_client_seq":$clientSeq}""")

    suspend fun finalize(token: String, sessionId: String): String =
        post("watch_finalize_session", """{"p_token":${q(token)},"p_session_id":${q(sessionId)}}""")
}
```

- [ ] **Step 5 : Vérifier que les tests passent**

Run: `cd wear; .\gradlew.bat :app:testDebugUnitTest`
Expected: 5 tests au vert.

- [ ] **Step 6 : Compléter la table des raisons**

Ouvrir `watch/source/Api.mc`, relever **toutes** les raisons de `reasonPair`, et vérifier que la table Kotlin les couvre **toutes**, avec les mêmes formulations. Puis chercher les `RAISE` du serveur :

Run: `grep -rn "RAISE EXCEPTION" supabase/migrations/watch_*.sql supabase/migrations/live_*.sql`

Rendre compte, dans le rapport, de **toute raison levée par le serveur qui n'est traduite ni dans la Garmin ni ici** — elles s'afficheront comme un code brut. Ne pas les inventer : les signaler.

- [ ] **Step 7 : Commit**

```bash
git add wear/app/src/main/java/com/pagmatch/wear/Config.kt wear/app/src/main/java/com/pagmatch/wear/Api.kt wear/app/src/test/java/com/pagmatch/wear/ApiTest.kt
git commit -m "feat(wear): reglages et appels serveur"
```

---

### Task 3 : La file d'envoi persistante

**Files:**
- Create: `wear/app/src/main/java/com/pagmatch/wear/Queue.kt`
- Test: `wear/app/src/test/java/com/pagmatch/wear/QueueTest.kt`

**Interfaces:**
- Consumes: rien de la Task 2.
- Produces: `class Queue(store: KeyValueStore)` avec `nextSeq(): Long`, `push(sessionId: String, eventType: String, team: Int, seq: Long)`, `head(): Pending?`, `popHead()`, `size(): Int`, `clear()` ; `data class Pending(val sid: String, val type: String, val team: Int, val seq: Long)` ; `interface KeyValueStore { fun getString(k: String): String?; fun putString(k: String, v: String) }`.

**C'est le cœur de la fiabilité**, et la raison pour laquelle la spec dit de **transposer et non réécrire** : un appui est enregistré ICI d'abord, envoyé ensuite. Tant qu'un envoi n'est pas acquitté, l'événement reste en tête et sera rejoué — c'est l'idempotence serveur, sur `(session_id, watch_link_id, client_seq)`, qui rend ce rejeu sûr.

L'injection d'un `KeyValueStore` permet de tester la file en JVM, sans appareil. La Garmin ne pouvait pas.

- [ ] **Step 1 : Écrire les tests d'abord**

Créer `wear/app/src/test/java/com/pagmatch/wear/QueueTest.kt` :

```kotlin
package com.pagmatch.wear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FakeStore : KeyValueStore {
    private val m = mutableMapOf<String, String>()
    override fun getString(k: String) = m[k]
    override fun putString(k: String, v: String) { m[k] = v }
}

class QueueTest {
    @Test fun `la sequence est monotone et jamais reutilisee`() {
        val q = Queue(FakeStore())
        assertEquals(1L, q.nextSeq())
        assertEquals(2L, q.nextSeq())
        assertEquals(3L, q.nextSeq())
    }

    @Test fun `la sequence survit a un redemarrage`() {
        val store = FakeStore()
        Queue(store).nextSeq()
        Queue(store).nextSeq()
        assertEquals(3L, Queue(store).nextSeq())
    }

    @Test fun `les evenements sortent dans l ordre d entree`() {
        val q = Queue(FakeStore())
        q.push("s1", "point_won", 1, 1)
        q.push("s1", "point_won", 2, 2)
        assertEquals(1L, q.head()!!.seq)
        q.popHead()
        assertEquals(2L, q.head()!!.seq)
        q.popHead()
        assertNull(q.head())
    }

    @Test fun `la file survit a un redemarrage`() {
        val store = FakeStore()
        Queue(store).push("s1", "undo", 0, 7)
        val q = Queue(store)
        assertEquals(1, q.size())
        assertEquals("undo", q.head()!!.type)
        assertEquals(7L, q.head()!!.seq)
    }

    @Test fun `depiler une file vide ne casse rien`() {
        val q = Queue(FakeStore())
        q.popHead()
        assertEquals(0, q.size())
    }
}
```

- [ ] **Step 2 : Lancer les tests, vérifier qu'ils échouent**

Run: `cd wear; .\gradlew.bat :app:testDebugUnitTest --tests "*QueueTest*"`
Expected: ÉCHEC — `Queue` n'existe pas.

- [ ] **Step 3 : Écrire `Queue.kt`**

```kotlin
package com.pagmatch.wear

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

interface KeyValueStore {
    fun getString(k: String): String?
    fun putString(k: String, v: String)
}

@Serializable
data class Pending(val sid: String, val type: String, val team: Int, val seq: Long)

// File d'envoi persistante : un appui est enregistre ICI d'abord, envoye
// ensuite. Tant qu'un envoi n'a pas ete acquitte, l'evenement reste en tete et
// sera rejoue — c'est l'idempotence cote serveur (client_seq) qui rend ce
// rejeu sur.
class Queue(private val store: KeyValueStore) {

    private val json = Json { ignoreUnknownKeys = true }

    fun items(): List<Pending> {
        val raw = store.getString(KEY_ITEMS) ?: return emptyList()
        return try { json.decodeFromString(raw) } catch (e: Exception) { emptyList() }
    }

    private fun save(a: List<Pending>) {
        store.putString(KEY_ITEMS, json.encodeToString(a))
    }

    // client_seq monotone, JAMAIS reutilise : c'est la cle d'idempotence.
    fun nextSeq(): Long {
        val s = (store.getString(KEY_SEQ)?.toLongOrNull() ?: 0L) + 1L
        store.putString(KEY_SEQ, s.toString())
        return s
    }

    fun push(sessionId: String, eventType: String, team: Int, seq: Long) {
        save(items() + Pending(sessionId, eventType, team, seq))
    }

    fun head(): Pending? = items().firstOrNull()

    fun popHead() {
        val a = items()
        if (a.isEmpty()) return
        save(a.drop(1))
    }

    fun size(): Int = items().size

    fun clear() = save(emptyList())

    companion object {
        const val KEY_ITEMS = "queue_items"
        const val KEY_SEQ = "queue_seq"
    }
}
```

- [ ] **Step 4 : Vérifier que les tests passent**

Run: `cd wear; .\gradlew.bat :app:testDebugUnitTest --tests "*QueueTest*"`
Expected: 5 tests au vert.

- [ ] **Step 5 : Commit**

```bash
git add wear/app/src/main/java/com/pagmatch/wear/Queue.kt wear/app/src/test/java/com/pagmatch/wear/QueueTest.kt
git commit -m "feat(wear): file d'envoi persistante et idempotente"
```

---

### Task 4 : Le modèle de session

**Files:**
- Create: `wear/app/src/main/java/com/pagmatch/wear/Session.kt`
- Test: `wear/app/src/test/java/com/pagmatch/wear/SessionTest.kt`

**Interfaces:**
- Consumes: rien.
- Produces: `data class Session(...)` et `fun parseSession(json: String?): Session?` (renvoie `null` si `has_session` est faux ou absent).

**Avant d'écrire quoi que ce soit, lire la forme exacte du payload** dans `supabase/migrations/watch_team_initials.sql`, fonction `fn_watch_payload` — c'est la définition qui fait foi. Les clés relevées sont : `has_session`, `session_id`, `scoring_mode`, `is_scorer`, `input_device`, `team1`, `team2`, `team1_short`, `team2_short`, `sets`, `sets_won`, `current_game`, `game_label`, `golden_point`, `tie_break`, `match_decided`, `finished`, `contest_count`. **Vérifier cette liste contre le SQL plutôt que de la croire**, et rendre compte de tout écart.

- [ ] **Step 1 : Écrire les tests d'abord**

Créer `wear/app/src/test/java/com/pagmatch/wear/SessionTest.kt`. Remplacer le JSON par un payload **réel**, relevé en appelant `watch_current_session` sur un match de test, ou reconstruit fidèlement depuis `fn_watch_payload` :

```kotlin
package com.pagmatch.wear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionTest {
    private val payload = """
    {"has_session":true,"session_id":"11111111-1111-1111-1111-111111111111",
     "scoring_mode":"points","is_scorer":true,"input_device":"watch",
     "team1":"Karim & Ali","team2":"Youssef & Omar",
     "team1_short":"K&A","team2_short":"Y&O",
     "sets":[{"t1":6,"t2":4},{"t1":3,"t2":6}],"sets_won":[1,1],
     "current_game":{"t1":2,"t2":1},"game_label":"30 - 15",
     "golden_point":false,"tie_break":false,
     "match_decided":false,"finished":false,"contest_count":0}
    """

    @Test fun `lit une session complete`() {
        val s = parseSession(payload)!!
        assertEquals("points", s.scoringMode)
        assertEquals("Karim & Ali", s.team1)
        assertEquals("K&A", s.team1Short)
        assertEquals(2, s.sets.size)
        assertEquals(6, s.sets[0].t1)
        assertEquals("30 - 15", s.gameLabel)
        assertTrue(s.isScorer)
    }

    @Test fun `absence de session renvoie null`() {
        assertNull(parseSession("""{"has_session":false}"""))
        assertNull(parseSession(null))
        assertNull(parseSession("pas du json"))
    }

    @Test fun `une cle manquante ne fait pas planter`() {
        val s = parseSession("""{"has_session":true,"session_id":"x","team1":"A","team2":"B"}""")!!
        assertEquals("x", s.sessionId)
        assertTrue(s.sets.isEmpty())
        assertNull(s.gameLabel)
    }
}
```

- [ ] **Step 2 : Lancer les tests, vérifier qu'ils échouent**

Run: `cd wear; .\gradlew.bat :app:testDebugUnitTest --tests "*SessionTest*"`
Expected: ÉCHEC — `parseSession` n'existe pas.

- [ ] **Step 3 : Écrire `Session.kt`**

```kotlin
package com.pagmatch.wear

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Serializable
data class SetScore(val t1: Int = 0, val t2: Int = 0)

@Serializable
data class Session(
    @SerialName("has_session")    val hasSession: Boolean = false,
    @SerialName("session_id")     val sessionId: String = "",
    @SerialName("scoring_mode")   val scoringMode: String = "games",
    @SerialName("is_scorer")      val isScorer: Boolean = false,
    @SerialName("input_device")   val inputDevice: String? = null,
    val team1: String = "",
    val team2: String = "",
    @SerialName("team1_short")    val team1Short: String? = null,
    @SerialName("team2_short")    val team2Short: String? = null,
    val sets: List<SetScore> = emptyList(),
    @SerialName("sets_won")       val setsWon: List<Int> = emptyList(),
    @SerialName("current_game")   val currentGame: SetScore? = null,
    @SerialName("game_label")     val gameLabel: String? = null,
    @SerialName("golden_point")   val goldenPoint: Boolean = false,
    @SerialName("tie_break")      val tieBreak: Boolean = false,
    @SerialName("match_decided")  val matchDecided: Boolean = false,
    val finished: Boolean = false,
    @SerialName("contest_count")  val contestCount: Int = 0,
)

private val json = Json { ignoreUnknownKeys = true; isLenient = true }

// Renvoie null quand il n'y a pas de match en cours. Le serveur signale ce cas
// par has_session:false plutot que par un corps vide.
fun parseSession(body: String?): Session? {
    if (body == null) return null
    return try {
        val s = json.decodeFromString<Session>(body)
        if (s.hasSession) s else null
    } catch (e: Exception) { null }
}
```

- [ ] **Step 4 : Vérifier que les tests passent**

Run: `cd wear; .\gradlew.bat :app:testDebugUnitTest --tests "*SessionTest*"`
Expected: 3 tests au vert.

- [ ] **Step 5 : Commit**

```bash
git add wear/app/src/main/java/com/pagmatch/wear/Session.kt wear/app/src/test/java/com/pagmatch/wear/SessionTest.kt
git commit -m "feat(wear): modele de session"
```

---

### Task 5 : L'écran d'appairage

**Files:**
- Create: `wear/app/src/main/java/com/pagmatch/wear/ui/PairingScreen.kt`
- Create: `wear/app/src/main/java/com/pagmatch/wear/Prefs.kt`
- Modify: `wear/app/src/main/java/com/pagmatch/wear/MainActivity.kt`

**Interfaces:**
- Consumes: `Api.redeem`, `Api.errorReason`, `Api.reasonPair`, `Config.deviceLabel`, `KeyValueStore`.
- Produces: `class Prefs(context: Context) : KeyValueStore` avec en plus `var token: String?` ; `@Composable fun PairingScreen(prefs: Prefs, onPaired: () -> Unit)` ; `Api.parseToken(body: String?): String?`.

L'écran d'appairage du téléphone existe déjà et est **neutre** (`app/watch-link.tsx` dit « ta montre », jamais « ta Garmin ») : il n'y a rien à y changer. Il génère un code à 6 chiffres valable 5 minutes.

- [ ] **Step 1 : Le stockage persistant**

Créer `wear/app/src/main/java/com/pagmatch/wear/Prefs.kt` :

```kotlin
package com.pagmatch.wear

import android.content.Context

// Le jeton d'appairage survit aux redemarrages : on ne demande le code qu'une
// seule fois, comme sur la Garmin.
class Prefs(context: Context) : KeyValueStore {
    private val sp = context.getSharedPreferences("pagmatch", Context.MODE_PRIVATE)
    override fun getString(k: String): String? = sp.getString(k, null)
    override fun putString(k: String, v: String) { sp.edit().putString(k, v).apply() }

    var token: String?
        get() = sp.getString(KEY_TOKEN, null)?.ifEmpty { null }
        set(v) { sp.edit().apply { if (v == null) remove(KEY_TOKEN) else putString(KEY_TOKEN, v) }.apply() }

    companion object { const val KEY_TOKEN = "watch_token" }
}
```

- [ ] **Step 2 : L'écran**

Créer `wear/app/src/main/java/com/pagmatch/wear/ui/PairingScreen.kt` :

```kotlin
package com.pagmatch.wear.ui

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.*
import com.pagmatch.wear.*
import kotlinx.coroutines.launch

// Saisie du code a 6 chiffres, un chiffre a la fois. Chaque chiffre se regle
// avec les fleches et se valide avec le bouton central.
@Composable
fun PairingScreen(prefs: Prefs, onPaired: () -> Unit) {
    var digits by remember { mutableStateOf(IntArray(6)) }
    var index by remember { mutableStateOf(0) }
    var status by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    Column(
        Modifier.fillMaxSize().padding(8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text("Code affiche dans l app", textAlign = TextAlign.Center,
             style = MaterialTheme.typography.caption2)
        Spacer(Modifier.height(4.dp))
        Text(digits.joinToString(""), style = MaterialTheme.typography.display2)
        Text("Chiffre ${index + 1}/6", style = MaterialTheme.typography.caption2)
        Spacer(Modifier.height(6.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { digits = digits.clone().also { it[index] = (it[index] + 9) % 10 } },
                   enabled = !busy) { Text("-") }
            Button(onClick = { digits = digits.clone().also { it[index] = (it[index] + 1) % 10 } },
                   enabled = !busy) { Text("+") }
            Button(enabled = !busy, onClick = {
                if (index < 5) { index++ } else {
                    busy = true; status = "..."
                    scope.launch {
                        val body = Api.redeem(digits.joinToString(""), Config.deviceLabel())
                        val reason = Api.errorReason(body)
                        if (reason != null) {
                            status = Api.reasonPair(reason)?.first ?: reason
                            busy = false
                        } else {
                            val t = parseToken(body)
                            if (t == null) { status = "Reponse illisible"; busy = false }
                            else { prefs.token = t; onPaired() }
                        }
                    }
                }
            }) { Text(if (index < 5) ">" else "OK") }
        }
        if (status != null) {
            Spacer(Modifier.height(4.dp))
            Text(status!!, color = MaterialTheme.colors.error,
                 style = MaterialTheme.typography.caption2, textAlign = TextAlign.Center)
        }
    }
}
```

Ajouter dans `Api.kt` :

```kotlin
    fun parseToken(body: String?): String? {
        if (body == null) return null
        return try {
            lenient.parseToJsonElement(body).jsonObject["token"]?.jsonPrimitive?.content
        } catch (e: Exception) { null }
    }
```

et l'importer dans l'écran (`import com.pagmatch.wear.Api.parseToken`).

- [ ] **Step 3 : Brancher la navigation**

Modifier `MainActivity.kt` pour afficher `PairingScreen` quand `prefs.token == null`, et un simple `Text("Appaire")` sinon — l'écran de match arrive à la Task 6.

- [ ] **Step 4 : Compiler et installer**

Run: `cd wear; .\gradlew.bat :app:testDebugUnitTest; .\gradlew.bat installDebug`
Expected: tests au vert, `BUILD SUCCESSFUL`.

- [ ] **Step 5 : Appairer pour de vrai**

Générer un code dans l'app téléphone (écran « Connecter ma montre »), le saisir sur la montre. Vérifier ensuite dans la liste des montres liées du téléphone que l'étiquette affichée est bien le modèle de la montre, pas un nom générique.

**Rendre compte de ce qui a été vu à l'écran**, et de l'étiquette réellement affichée dans le téléphone.

- [ ] **Step 6 : Commit**

```bash
git add wear/app/src/main/java/com/pagmatch/wear/
git commit -m "feat(wear): ecran d'appairage"
```

---

### Task 6 : L'écran de match

**Files:**
- Create: `wear/app/src/main/java/com/pagmatch/wear/MatchStore.kt`
- Create: `wear/app/src/main/java/com/pagmatch/wear/ui/MatchScreen.kt`
- Modify: `wear/app/src/main/java/com/pagmatch/wear/MainActivity.kt`

**Interfaces:**
- Consumes: `Api`, `Queue`, `Prefs`, `parseSession`, `Session`.
- Produces: `class MatchStore(prefs: Prefs)` avec `val session: StateFlow<Session?>`, `val message: StateFlow<String?>`, `fun refresh()`, `fun score(team: Int)`, `fun undo()`, `fun drain()` ; `@Composable fun MatchScreen(store: MatchStore, onValidate: () -> Unit)`.

**Les règles de saisie, non négociables :**

- **Deux grandes moitiés tactiles** : toucher la moitié haute marque pour l'équipe **affichée en haut**, la moitié basse pour celle **affichée en bas**. Le geste désigne l'équipe telle qu'elle est affichée.
- **L'annulation est un bouton visible**, jamais un geste caché.
- **Aucun point ne s'ajoute en silence** : après chaque point, un message court s'affiche.
- **Ne jamais capturer le balayage vers la droite** : il appartient au système.
- L'ordre d'affichage des équipes ne change jamais : équipe 1 en haut, équipe 2 en bas.

- [ ] **Step 1 : L'état et la boucle d'envoi**

Créer `MatchStore.kt` :

```kotlin
package com.pagmatch.wear

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

// Un appui est enregistre dans la file AVANT d'etre envoye. La boucle vide la
// file en respectant l'ordre ; un evenement non acquitte reste en tete et sera
// rejoue, ce que l'idempotence serveur (client_seq) rend sur.
class MatchStore(private val prefs: Prefs) {
    private val queue = Queue(prefs)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    private val _session = MutableStateFlow<Session?>(null)
    val session: StateFlow<Session?> = _session
    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message
    val pending: Int get() = queue.size()

    fun refresh() {
        val t = prefs.token ?: return
        scope.launch {
            val body = Api.currentSession(t)
            val reason = Api.errorReason(body)
            if (reason != null) { _message.value = Api.reasonPair(reason)?.first ?: reason }
            else { _session.value = parseSession(body); if (_session.value != null) _message.value = null }
        }
    }

    fun score(team: Int) {
        val s = _session.value ?: return
        if (!s.isScorer || s.finished) return
        val type = if (s.scoringMode == "points") "point_won" else "game_won"
        queue.push(s.sessionId, type, team, queue.nextSeq())
        _message.value = if (team == 1) "Point ${shortOf(s, 1)}" else "Point ${shortOf(s, 2)}"
        drain()
    }

    fun undo() {
        val s = _session.value ?: return
        if (!s.isScorer || s.finished) return
        queue.push(s.sessionId, "undo", 0, queue.nextSeq())
        _message.value = "Annulation"
        drain()
    }

    private fun shortOf(s: Session, team: Int): String =
        (if (team == 1) s.team1Short ?: s.team1 else s.team2Short ?: s.team2).take(8)

    fun drain() {
        val t = prefs.token ?: return
        scope.launch {
            while (true) {
                val h = queue.head() ?: break
                val body = Api.applyEvent(t, h.sid, h.type, h.team, h.seq)
                val reason = Api.errorReason(body)
                if (reason != null) {
                    // Un refus metier est definitif : le rejouer bouclerait.
                    _message.value = Api.reasonPair(reason)?.first ?: reason
                    queue.popHead()
                    continue
                }
                val s = parseSession(body)
                if (s == null) break   // panne reseau : on garde l'evenement en tete
                _session.value = s
                queue.popHead()
            }
        }
    }
}
```

- [ ] **Step 2 : L'écran**

Créer `ui/MatchScreen.kt`. Deux moitiés qui remplissent l'écran, chacune affichant le nom et le score d'une équipe, et un bouton d'annulation visible entre les deux.

```kotlin
package com.pagmatch.wear.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.*
import com.pagmatch.wear.MatchStore
import com.pagmatch.wear.Session

@Composable
fun MatchScreen(store: MatchStore, onValidate: () -> Unit) {
    val session by store.session.collectAsState()
    val message by store.message.collectAsState()
    val s = session

    if (s == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text(message ?: "Aucun match en cours", textAlign = TextAlign.Center)
        }
        return
    }

    Column(Modifier.fillMaxSize()) {
        TeamHalf(s, 1, Modifier.weight(1f)) { store.score(1) }
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            CompactButton(onClick = { store.undo() }) { Text("↶") }
            Text(
                message ?: s.gameLabel ?: "",
                style = MaterialTheme.typography.caption2,
                maxLines = 1, overflow = TextOverflow.Ellipsis
            )
            CompactButton(onClick = onValidate, enabled = s.matchDecided) { Text("✓") }
        }
        TeamHalf(s, 2, Modifier.weight(1f)) { store.score(2) }
    }
}

// La couleur ne distingue jamais les equipes : seule leur POSITION le fait.
@Composable
private fun TeamHalf(s: Session, team: Int, modifier: Modifier, onTap: () -> Unit) {
    val name = if (team == 1) s.team1 else s.team2
    val won = s.setsWon.getOrNull(team - 1) ?: 0
    val line = s.sets.joinToString(" ") { if (team == 1) "${it.t1}" else "${it.t2}" }
    Column(
        modifier.fillMaxWidth().clickable(onClick = onTap).padding(horizontal = 10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text(name, maxLines = 1, overflow = TextOverflow.Ellipsis,
             style = MaterialTheme.typography.caption1)
        Text(if (line.isEmpty()) "$won" else line,
             style = MaterialTheme.typography.display3, maxLines = 1)
    }
}
```

- [ ] **Step 3 : Rafraîchir régulièrement**

Dans `MainActivity`, appeler `store.refresh()` à l'affichage puis toutes les 5 secondes tant que l'écran de match est visible, et `store.drain()` au retour du réseau.

- [ ] **Step 4 : Compiler, installer, regarder**

Run: `cd wear; .\gradlew.bat :app:testDebugUnitTest; .\gradlew.bat installDebug`
Expected: tests au vert, `BUILD SUCCESSFUL`.

Démarrer un match live depuis le téléphone, prendre la main sur la montre, marquer des points. **Vérifier à l'écran** : le point s'annonce, le score bouge, l'annulation fonctionne, et le nom de l'équipe du haut correspond bien à la moitié du haut.

- [ ] **Step 5 : Éprouver la coupure réseau**

Mettre la montre en mode avion, marquer trois points, ressortir du mode avion. **Les trois points doivent arriver, dans l'ordre, une seule fois chacun.** C'est la garantie centrale ; elle n'avait jamais été testée sur la Garmin.

Rendre compte du résultat observé.

- [ ] **Step 6 : Commit**

```bash
git add wear/app/src/main/java/com/pagmatch/wear/
git commit -m "feat(wear): ecran de match et saisie des points"
```

---

### Task 7 : Validation du score depuis la montre

**Files:**
- Create: `wear/app/src/main/java/com/pagmatch/wear/ui/ConfirmScreen.kt`
- Modify: `wear/app/src/main/java/com/pagmatch/wear/MatchStore.kt`, `MainActivity.kt`

**Interfaces:**
- Consumes: `Api.finalize`, `MatchStore`.
- Produces: `MatchStore.finalize(onDone: (String?) -> Unit)` ; `@Composable fun ConfirmScreen(store: MatchStore, onCancel: () -> Unit, onDone: () -> Unit)`.

**L'action est irréversible**, donc elle doit rester délibérée. Le serveur refuse déjà un match non joué (`no_winner`, `not_enough_sets`) : la montre ne peut pas valider trop tôt, mais l'écran doit quand même l'annoncer clairement.

- [ ] **Step 1 : La méthode du store**

Ajouter à `MatchStore` :

```kotlin
    fun finalize(onDone: (String?) -> Unit) {
        val t = prefs.token ?: return onDone("Montre deliee")
        val s = _session.value ?: return onDone("Aucun match")
        scope.launch {
            val body = Api.finalize(t, s.sessionId)
            val reason = Api.errorReason(body)
            onDone(if (reason == null) null else (Api.reasonPair(reason)?.first ?: reason))
        }
    }
```

- [ ] **Step 2 : L'écran de confirmation**

Créer `ui/ConfirmScreen.kt` :

```kotlin
package com.pagmatch.wear.ui

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.*
import com.pagmatch.wear.MatchStore

@Composable
fun ConfirmScreen(store: MatchStore, onCancel: () -> Unit, onDone: () -> Unit) {
    val session by store.session.collectAsState()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val s = session ?: return

    val score1 = s.sets.joinToString(" ") { "${it.t1}" }
    val score2 = s.sets.joinToString(" ") { "${it.t2}" }

    Column(
        Modifier.fillMaxSize().padding(10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text("Valider le score ?", style = MaterialTheme.typography.caption1)
        Spacer(Modifier.height(4.dp))
        Text("$score1  /  $score2", style = MaterialTheme.typography.title3,
             textAlign = TextAlign.Center)
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Button(onClick = onCancel, enabled = !busy) { Text("Non") }
            Button(enabled = !busy, onClick = {
                busy = true
                store.finalize { err -> if (err == null) onDone() else { error = err; busy = false } }
            }) { Text("Oui") }
        }
        if (error != null) {
            Spacer(Modifier.height(4.dp))
            Text(error!!, color = MaterialTheme.colors.error,
                 style = MaterialTheme.typography.caption2, textAlign = TextAlign.Center)
        }
    }
}
```

- [ ] **Step 3 : Brancher**

Le bouton `✓` de `MatchScreen` ouvre `ConfirmScreen` ; « Non » revient au match, « Oui » valide puis revient au match rafraîchi.

- [ ] **Step 4 : Compiler et éprouver**

Run: `cd wear; .\gradlew.bat :app:testDebugUnitTest; .\gradlew.bat installDebug`

Sur un match non terminé, vérifier que le bouton `✓` est bien inactif. Sur un match décidé, valider depuis la montre et **vérifier dans l'app téléphone que le match est passé en attente de validation**.

- [ ] **Step 5 : Commit**

```bash
git add wear/app/src/main/java/com/pagmatch/wear/
git commit -m "feat(wear): validation du score depuis la montre"
```

---

### Task 8 : Rester au poignet pendant tout le match

**Files:**
- Create: `wear/app/src/main/java/com/pagmatch/wear/OngoingMatch.kt`
- Modify: `wear/app/src/main/AndroidManifest.xml`, `MainActivity.kt`

**Interfaces:**
- Consumes: `MatchStore.session`.
- Produces: un service de premier plan qui publie une activité en cours tant qu'un match est ouvert.

**Sans cette tâche, la fonctionnalité meurt entre deux points** : Wear OS revient au cadran après quelques secondes d'inactivité, et le joueur qui lève le poignet voit l'heure au lieu du score.

- [ ] **Step 1 : Lire la documentation avant de coder**

Vérifier dans la documentation officielle : l'API `androidx.wear.ongoing.OngoingActivity`, le type de service de premier plan à déclarer sur API 34+, les permissions associées, et le comportement au lever de poignet. **Rendre compte de ce qui a été lu, avec les liens.** Le SDK Connect IQ a démenti trois hypothèses sur le chantier précédent ; ne rien présumer.

- [ ] **Step 2 : Le service**

Créer `OngoingMatch.kt` : un `Service` de premier plan qui publie une notification permanente portant le score, décorée d'une `OngoingActivity` pointant vers `MainActivity`. Il démarre quand une session devient disponible et s'arrête quand elle se termine ou que la montre est déliée.

Le texte de la notification doit porter le score courant et rester **sous 20 caractères**, comme sur la Garmin : la brièveté sert la lisibilité en plein soleil.

- [ ] **Step 3 : Déclarer dans le manifeste**

Ajouter la permission de service de premier plan et le type relevé au Step 1, ainsi que la déclaration `<service>`.

- [ ] **Step 4 : Écran allumé au lever de poignet**

L'écran s'allume au lever de poignet et s'estompe entre les points — pas d'écran allumé en permanence, qui viderait la montre en un match. Suivre le mécanisme relevé au Step 1.

- [ ] **Step 5 : Éprouver en durée**

Lancer un match, laisser la montre au repos deux minutes, puis lever le poignet. **On doit retomber sur le score, pas sur le cadran.** Répéter après dix minutes. Noter la consommation de batterie observée.

Rendre compte de ce qui a été vu.

- [ ] **Step 6 : Commit**

```bash
git add wear/
git commit -m "feat(wear): match declare comme activite en cours"
```

---

### Task 9 : La passe visuelle

**Files:** aucun fichier modifié a priori — c'est une passe d'inspection. Les correctifs éventuels touchent `ui/`.

- [ ] **Step 1 : Capturer chaque forme et chaque taille**

Créer des appareils virtuels Wear OS couvrant : **rond petit**, **rond grand**, **carré**. Pour chacun, capturer les trois écrans (appairage, match, confirmation), plus l'écran de match avec des **noms d'équipe longs** et un message d'erreur affiché.

- [ ] **Step 2 : Regarder chaque capture**

Pour chaque écran et chaque taille, vérifier :
- aucun texte rogné, sur aucun bord — en particulier là où le biseau rond mord en haut et en bas ;
- le score reste l'élément le plus gros et le plus lisible ;
- aucune ligne n'en chevauche une autre ;
- les deux moitiés tactiles se distinguent par leur **position**, jamais par leur couleur ;
- le bouton d'annulation est visible et atteignable sans viser.

**Rendre compte écran par écran et taille par taille** — pas une conclusion globale. Une taille non regardée est une taille non vérifiée.

- [ ] **Step 3 : Corriger**

Toute correction porte sur la mise en page partagée, jamais sur un cas particulier de modèle.

- [ ] **Step 4 : Un vrai match sur la Samsung**

Jouer un match complet sur la montre du user. Surveiller précisément :
- **le contact involontaire** — c'est le risque explicitement accepté à la conception. Le score dérive-t-il tout seul ? Manche, sueur, essuyage ;
- le retour au score après lever de poignet ;
- la batterie sur la durée.

- [ ] **Step 5 : Commit**

```bash
git add wear/
git commit -m "fix(wear): corrections issues de la passe visuelle"
```

---

## Auto-relecture du plan

**Couverture de la spec :** §4 architecture → Task 1 ; §5 les trois écrans → Tasks 5, 6, 7 ; §6 saisie et ses deux garde-fous → Task 6 ; §7 activité en cours et batterie → Task 8 ; §8 fiabilité et file → Tasks 3 et 6 (Step 5) ; §9 rendu adaptatif → Task 9 ; §10 vérification → Tasks 6, 8, 9 ; §11 vigilance → contraintes globales et Task 8 Step 1 ; §12 hors périmètre → contraintes globales. Aucune section sans tâche.

**Cohérence des noms :** `KeyValueStore` est produit en Task 3 et consommé en Tasks 5 et 6 ; `Prefs` l'implémente en Task 5 et sert de stockage à `Queue` en Task 6 ; `parseSession` est produit en Task 4 et consommé en Task 6 ; `Api.parseToken` est ajouté en Task 5 et n'est utilisé que là ; `MatchStore.finalize` est ajouté en Task 7 et consommé par `ConfirmScreen`.

**Un point à trancher par l'exécutant, signalé plutôt que caché :** les versions du catalogue Gradle (Task 1, Step 2) sont marquées `RESOUDRE` parce qu'inventer des numéros de version serait pire qu'admettre qu'ils se relèvent à l'installation. La compilation est le contrôle.
