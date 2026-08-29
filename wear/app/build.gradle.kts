plugins {
    alias(libs.plugins.android.application)
    // Pas de plugin kotlin-android : AGP 9 compile le Kotlin nativement.
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.kotlin.compose)
}
android {
    namespace = "com.pagmatch.wear"
    // compileSdk/targetSdk 37 (et non 35) : les versions stables actuelles de
    // core-ktx/okhttp/compose exigent de compiler contre l'API 36 ou 37.
    // minSdk reste 30 (Wear OS 3 / Galaxy Watch 4), exigence figee du projet.
    compileSdk = 37
    defaultConfig {
        applicationId = "com.pagmatch.wear"
        minSdk = 30
        targetSdk = 37
        versionCode = 1
        versionName = "1.0.0"
    }
    buildFeatures { compose = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
kotlin {
    // Remplace l'ancienne DSL `kotlinOptions { jvmTarget = "17" }`, retiree
    // (erreur de compilation, pas juste deprecation) dans la version de
    // Kotlin Gradle Plugin resolue pour ce projet.
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}
dependencies {
    implementation(platform(libs.compose.bom))
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.core)
    implementation(libs.wear.compose.material)
    implementation(libs.wear.compose.foundation)
    implementation(libs.wear.ongoing)
    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)
    debugImplementation(libs.compose.ui.tooling)
    testImplementation(libs.junit)
}
