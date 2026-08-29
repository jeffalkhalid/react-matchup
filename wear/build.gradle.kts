plugins {
    alias(libs.plugins.android.application) apply false
    // Pas de plugin kotlin-android : AGP 9 integre le support Kotlin nativement.
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.kotlin.compose) apply false
}
