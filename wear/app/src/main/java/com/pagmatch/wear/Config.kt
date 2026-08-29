package com.pagmatch.wear

import android.os.Build

// SEUL fichier a toucher si le projet Supabase change.
// La cle anon est PUBLIQUE par conception (deja embarquee dans l'APK) : les
// droits reels sont portes par le jeton d'appairage, jamais par cette cle.
object Config {
    // Recopiees a l'identique depuis watch/source/Config.mc (app Garmin).
    const val SUPABASE_URL = "https://icshhobxeppttgayxmba.supabase.co"
    const val ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imljc2hob2J4ZXBwdHRnYXl4bWJhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4MjU3MjAsImV4cCI6MjA4ODQwMTcyMH0.cSE2y-AQI3U9xkn5vyG5VjOhKNUD4qV9etQkvrLK68I"

    // Etiquette envoyee a l'appairage (watch_links.device_label) et RELUE PAR
    // L'UTILISATEUR dans la liste des montres liees du telephone. Ce n'est PAS
    // une decision de mise en page : rien ici ne doit servir a choisir une
    // taille ou une position.
    fun deviceLabel(): String {
        val model = Build.MODEL?.trim()
        return if (model.isNullOrEmpty()) "Montre Wear OS" else model
    }
}
