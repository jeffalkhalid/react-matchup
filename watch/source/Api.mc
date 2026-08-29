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

    // ------------------------------------------------------------------
    // LA PAIRE EST L'UNITE D'EDITION.
    //
    // Chaque raison porte DEUX formulations : la riche, et le repli court
    // employe quand la riche ne tient pas sur la corde disponible. Elles
    // vivaient dans deux fonctions paralleles, et c'etait un piege : ajouter
    // une raison a l'une sans penser a l'autre rendait un court `null`, donc
    // le repli retombait sur la forme riche — c'est-a-dire exactement sur
    // l'ecran muet qu'on venait de corriger, mais pour cette seule raison, et
    // sans que rien ne le signale. Une seule table de paires rend cet oubli
    // INEXPRIMABLE sur une ligne : on n'ecrit plus une formulation, on ecrit
    // une paire.
    //
    // Chaines SANS ACCENTS : les polices systeme Garmin ne les garantissent
    // pas. Renvoie null si la raison est inconnue -> l'appelant garde son
    // message generique, jamais un echec muet.
    //
    // [0] VINGT CARACTERES AU PLUS, par construction. Ce n'est pas une
    // coquetterie de style : la corde utilisable d'un cadran rond au niveau de
    // la ligne de message tombe a une petite dizaine de caracteres sur les plus
    // petits modeles du parc (~88 px sur fenix5s, 218 px), et la regle du
    // module est de ne RIEN dessiner plutot que de rogner. « Montre deliee -
    // reappairer » (26 car.) et « Trop d essais - patiente » (24 car.) ne
    // s'affichaient donc NULLE PART sur un petit cadran rond : le refus serveur
    // n'atteignait jamais le poignet. Un message court se lit aussi mieux en
    // plein soleil, une balle a la main.
    //
    // [1] DIX CARACTERES AU PLUS : « Invalide » a ete vu s'afficher au
    // simulateur sur la ligne de statut d'un fenix5s, la ou « Code invalide »
    // ne passait pas.
    // ------------------------------------------------------------------
    function reasonPair(reason) {
        if (reason == null) { return null; }
        if (reason.equals("token_revoked"))     { return ["Montre deliee",      "Deliee"]; }
        if (reason.equals("not_the_scorer"))    { return ["Plus le scoreur",    "Pas toi"]; }
        if (reason.equals("watch_has_control")) { return ["Montre a la main",   "Montre"]; }
        if (reason.equals("session_not_live"))  { return ["Match termine",      "Termine"]; }
        if (reason.equals("not_a_participant")) { return ["Plus dans ce match", "Hors match"]; }
        if (reason.equals("rate_limited"))      { return ["Trop d essais",      "Attendre"]; }
        if (reason.equals("invalid_code"))      { return ["Code invalide",      "Invalide"]; }
        if (reason.equals("code_expired"))      { return ["Code expire",        "Expire"]; }
        if (reason.equals("code_already_used")) { return ["Code deja utilise",  "Deja pris"]; }
        if (reason.equals("feature_disabled"))  { return ["Fonction desactivee","Desactivee"]; }
        return null;
    }

    // Les deux accesseurs gardent leur signature d'origine : tous les
    // appelants sont inchanges, seule la source a fusionne.
    // Garde-fou, les deux accesseurs : une entree malformee ne peut pas lever
    // d'exception au poignet. Une paire vide se lit comme une raison inconnue
    // (l'appelant garde son message generique) et une paire a un seul element
    // retombe sur la forme riche. Un message trop long risque d'etre omis ;
    // une exception, elle, tue l'application en plein match.
    function reasonText(reason) {
        var p = reasonPair(reason);
        if (p == null || p.size() < 1) { return null; }
        return p[0];
    }

    function reasonShort(reason) {
        var p = reasonPair(reason);
        if (p == null || p.size() < 1) { return null; }
        return p.size() >= 2 ? p[1] : p[0];
    }

    // cb.invoke(responseCode, data)
    // Reponse : {"ok":true,"token":"..."} ou {"ok":false,"reason":"..."}.
    function redeem(code, cb) {
        post("redeem_watch_pairing_code",
             { "p_code" => code, "p_device_label" => Config.deviceLabel() }, cb);
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
