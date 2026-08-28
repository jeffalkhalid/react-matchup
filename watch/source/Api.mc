// watch/source/Api.mc
// Toutes les requêtes vers Supabase. Le jeton d'appairage est stocké en
// permanence dans Application.Storage : il survit aux redémarrages.
using Toybox.Communications;
using Toybox.Application;
using Toybox.Lang;

module Api {

    const KEY_TOKEN = "watch_token";

    function token() {
        return Application.Storage.getValue(KEY_TOKEN);
    }

    function hasToken() {
        var t = token();
        return t != null && t.length() > 0;
    }

    function setToken(t) {
        Application.Storage.setValue(KEY_TOKEN, t);
    }

    function clearToken() {
        Application.Storage.deleteValue(KEY_TOKEN);
    }

    function headers() {
        return {
            "Content-Type"  => Communications.REQUEST_CONTENT_TYPE_JSON,
            "apikey"        => Config.ANON_KEY,
            "Authorization" => "Bearer " + Config.ANON_KEY
        };
    }

    function post(path, body, cb) {
        Communications.makeWebRequest(
            Config.SUPABASE_URL + "/rest/v1/rpc/" + path,
            body,
            {
                :method => Communications.HTTP_REQUEST_METHOD_POST,
                :headers => headers(),
                :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
            },
            cb
        );
    }

    // ---- Refus serveur : les rendre LISIBLES au poignet (spec §13) ----------
    // PostgREST renvoie le texte du RAISE dans le champ "message" du corps
    // ({"code":"P0001","message":"not_the_scorer",...}), que Connect IQ nous
    // livre déjà parse en Dictionary. redeem_watch_pairing_code, elle, répond
    // 200 avec {"ok":false,"reason":"..."} : même extraction, deux clés.
    function errorReason(data) {
        if (data == null) { return null; }
        if (!(data instanceof Lang.Dictionary)) { return null; }
        var m = data["message"];
        if (m == null) { m = data["reason"]; }
        if (m == null) { return null; }
        if (!(m instanceof Lang.String)) { return null; }
        return m;
    }

    // Chaines SANS ACCENTS : les polices systeme Garmin ne les garantissent pas.
    // Retourne null si la raison est inconnue -> l'appelant garde son message
    // generique, jamais un echec muet.
    //
    // VINGT CARACTERES AU PLUS, par construction. Ce n'est pas une coquetterie
    // de style : la corde utilisable d'un cadran rond au niveau de la ligne de
    // message tombe a une petite dizaine de caracteres sur les plus petits
    // modeles du parc (~88 px sur fenix5s, 218 px), et la regle du module est
    // de ne RIEN dessiner plutot que de rogner. « Montre deliee - reappairer »
    // (26 car.) et « Trop d essais - patiente » (24 car.) ne s'affichaient donc
    // NULLE PART sur un petit cadran rond : le refus serveur n'atteignait
    // jamais le poignet. Un message court se lit aussi mieux en plein soleil,
    // une balle a la main.
    function reasonText(reason) {
        if (reason == null) { return null; }
        if (reason.equals("token_revoked"))     { return "Montre deliee"; }
        if (reason.equals("not_the_scorer"))    { return "Plus le scoreur"; }
        if (reason.equals("watch_has_control")) { return "Montre a la main"; }
        if (reason.equals("session_not_live"))  { return "Match termine"; }
        if (reason.equals("not_a_participant")) { return "Plus dans ce match"; }
        if (reason.equals("rate_limited"))      { return "Trop d essais"; }
        if (reason.equals("invalid_code"))      { return "Code invalide"; }
        if (reason.equals("code_expired"))      { return "Code expire"; }
        if (reason.equals("code_already_used")) { return "Code deja utilise"; }
        if (reason.equals("feature_disabled"))  { return "Fonction desactivee"; }
        return null;
    }

    // DEUXIEME BARREAU de la meme raison : la formulation de repli, quand la
    // premiere ne tient pas. Meme role que les variantes courtes des noms
    // d'equipe ou de la consigne d'appairage — sauf qu'ici la ligne concernee
    // est la SEULE qui dise POURQUOI quelque chose a echoue. Une explication
    // amputee vaut infiniment mieux qu'un ecran muet ou l'utilisateur croit
    // que son appui n'a pas ete pris en compte.
    // Dix caracteres au plus : « Invalide » a ete vu s'afficher au simulateur
    // sur la ligne de statut d'un fenix5s (218 px, le plus petit cadran rond
    // buildable), la ou « Code invalide » ne passait pas.
    // Jamais null quand reasonText ne l'est pas : les deux listes se
    // correspondent raison pour raison, et c'est ici qu'on le verifie.
    function reasonShort(reason) {
        if (reason == null) { return null; }
        if (reason.equals("token_revoked"))     { return "Deliee"; }
        if (reason.equals("not_the_scorer"))    { return "Pas toi"; }
        if (reason.equals("watch_has_control")) { return "Montre"; }
        if (reason.equals("session_not_live"))  { return "Termine"; }
        if (reason.equals("not_a_participant")) { return "Hors match"; }
        if (reason.equals("rate_limited"))      { return "Attendre"; }
        if (reason.equals("invalid_code"))      { return "Invalide"; }
        if (reason.equals("code_expired"))      { return "Expire"; }
        if (reason.equals("code_already_used")) { return "Deja pris"; }
        if (reason.equals("feature_disabled"))  { return "Desactivee"; }
        return null;
    }

    // cb.invoke(responseCode, data)
    // Reponse : {"ok":true,"token":"..."} ou {"ok":false,"reason":"..."}.
    function redeem(code, cb) {
        post("redeem_watch_pairing_code",
             { "p_code" => code, "p_device_label" => Config.DEVICE_LABEL }, cb);
    }

    // Valide le score depuis la montre. Le serveur refuse un match non joué
    // (no_winner / not_enough_sets), donc la montre ne peut pas valider trop tôt.
    // Reponse : {"ok":true,"match_id":"..."}.
    function finalize(sessionId, cb) {
        post("watch_finalize_session",
             { "p_token" => token(), "p_session_id" => sessionId }, cb);
    }

    function currentSession(cb) {
        post("watch_current_session", { "p_token" => token() }, cb);
    }

    function applyEvent(sessionId, eventType, team, clientSeq, cb) {
        post("watch_apply_event", {
            "p_token"      => token(),
            "p_session_id" => sessionId,
            "p_event_type" => eventType,
            "p_payload"    => { "team" => team },
            "p_client_seq" => clientSeq
        }, cb);
    }
}
