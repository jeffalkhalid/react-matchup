// watch/source/Config.mc
// SEUL fichier à toucher si le projet Supabase change.
// La clé anon est PUBLIQUE par conception (déjà embarquée dans l'APK) : les
// droits réels sont portés par le jeton d'appairage, jamais par cette clé.
using Toybox.System;
using Toybox.Lang;

module Config {
    const SUPABASE_URL = "https://icshhobxeppttgayxmba.supabase.co";
    const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imljc2hob2J4ZXBwdHRnYXl4bWJhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4MjU3MjAsImV4cCI6MjA4ODQwMTcyMH0.cSE2y-AQI3U9xkn5vyG5VjOhKNUD4qV9etQkvrLK68I";
    // Etiquette de l'appareil, envoyee a l'appairage (watch_links.device_label)
    // et RELUE PAR L'UTILISATEUR dans la liste des montres liees du telephone
    // (app/watch-link.tsx). Ce n'est PAS une decision de mise en page : rien
    // ici ne doit servir a choisir une police ou une position — les seules
    // branches admises pour dessiner restent les capacites (screenShape,
    // isTouchScreen, cf. Layout).
    //
    // C'etait la derniere valeur en dur par modele du projet : figee a
    // "epix2", elle faisait apparaitre les 53 modeles du parc comme un epix2
    // dans le telephone, y compris un vivoactive6 tout juste appaire.
    //
    // Le SDK n'expose aucun nom de modele lisible. DeviceSettings.partNumber
    // (API 1.2.0, tres en dessous du plancher 2.4.0 du manifeste, donc present
    // sur les 53 cibles) est le seul identifiant materiel disponible : opaque
    // mais EXACT, et il distingue reellement deux modeles — epix2 renvoie
    // « 006-B3943-00 » ou « 006-B3944-00 », vivoactive6 « 006-B4625-00 ».
    // La correspondance numero -> modele est publiee par le SDK lui-meme
    // (Devices/<modele>/compiler.json, champ partNumbers) : l'etiquette reste
    // donc remontable a un modele, sans que la montre ait a le deviner.
    // Un repli generique s'il manque : « Montre Garmin » est honnete, la ou un
    // nom de modele precis mais faux ne l'est pas.
    function deviceLabel() {
        var s = System.getDeviceSettings();
        if (s == null) { return "Montre Garmin"; }
        var p = s.partNumber;
        if (p == null) { return "Montre Garmin"; }
        if (!(p instanceof Lang.String)) { return "Montre Garmin"; }
        if (p.length() == 0) { return "Montre Garmin"; }
        return "Garmin " + p;
    }
}
