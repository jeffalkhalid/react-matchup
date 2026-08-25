// watch/source/Config.mc
// SEUL fichier à toucher si le projet Supabase change.
// La clé anon est PUBLIQUE par conception (déjà embarquée dans l'APK) : les
// droits réels sont portés par le jeton d'appairage, jamais par cette clé.
module Config {
    const SUPABASE_URL = "https://icshhobxeppttgayxmba.supabase.co";
    const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imljc2hob2J4ZXBwdHRnYXl4bWJhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4MjU3MjAsImV4cCI6MjA4ODQwMTcyMH0.cSE2y-AQI3U9xkn5vyG5VjOhKNUD4qV9etQkvrLK68I";
    const DEVICE_LABEL = "epix2";
}
