// watch/source/PairingView.mc
// Saisie du code à 6 chiffres. Un chiffre à la fois : HAUT/BAS changent le
// chiffre courant, SELECT valide et passe au suivant, BACK revient en arrière.
// Chaines AFFICHEES sans accents (polices Garmin).
using Toybox.WatchUi;
using Toybox.Graphics;

class PairingView extends WatchUi.View {

    hidden var _digits = [0, 0, 0, 0, 0, 0];
    hidden var _pos = 0;
    hidden var _status = "";

    function initialize() { View.initialize(); }

    function up()   { _digits[_pos] = (_digits[_pos] + 1) % 10; WatchUi.requestUpdate(); }
    function down() { _digits[_pos] = (_digits[_pos] + 9) % 10; WatchUi.requestUpdate(); }

    function back() {
        if (_pos > 0) { _pos = _pos - 1; WatchUi.requestUpdate(); return true; }
        return false;
    }

    function code() {
        var s = "";
        for (var i = 0; i < 6; i = i + 1) { s = s + _digits[i].toString(); }
        return s;
    }

    function setStatus(s) { _status = s; WatchUi.requestUpdate(); }

    // Renvoie true si le code est complet et doit etre envoye.
    function next() {
        if (_pos < 5) { _pos = _pos + 1; WatchUi.requestUpdate(); return false; }
        return true;
    }

    function onUpdate(dc) {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();
        var h = dc.getHeight();

        // Memes deux regles que l'ecran de match, et pour les memes defauts vus
        // a l'ecran : un BUDGET VERTICAL par ligne, et AUCUN separateur confie
        // a une police FONT_NUMBER_*.
        //
        // Le code d'appairage etait le cas le plus grave de tout le parc : il
        // etait dessine « 000 000 », espace compris, avec numberLadder. Sur
        // vivoactive_hr le code sortait « 000[?]000 », l'espace remplace par
        // l'image « caractere manquant » de Garmin, EN PLEIN MILIEU des six
        // chiffres que l'utilisateur doit lire et recopier — sur le tout
        // premier ecran de l'application.
        var tl = Layout.textLadder();
        var yHint  = h * 14 / 100;
        var yCode  = h * 34 / 100;
        var yPos   = h * 60 / 100;
        var yHow   = h * 72 / 100;
        var yStat  = h * 85 / 100;
        var yEnd   = h * 96 / 100;

        // Formulations de la plus riche a la plus pauvre, comme les noms
        // d'equipe de l'ecran de match. Sans ce garde-fou, la consigne
        // disparaissait purement et simplement des le fenix5s : mesuree a la
        // corde de sa LIGNE DE BASE elle ne tenait plus, et la regle du module
        // est de ne rien dessiner plutot que de rogner. Une consigne plus
        // courte vaut mieux qu'aucune consigne.
        Layout.drawBestBox(dc, yHint, yCode - yHint,
                           ["Code affiche dans l app", "Code dans l app", "Code"],
                           tl, Graphics.COLOR_LT_GRAY);

        var g1 = "";
        var g2 = "";
        for (var i = 0; i < 6; i = i + 1) {
            if (i < 3) { g1 = g1 + _digits[i].toString(); }
            else       { g2 = g2 + _digits[i].toString(); }
        }
        var parts = [g1, g2];
        var nl = Layout.numberLadder();
        Layout.drawPartsAt(dc, yCode, parts, nl,
                           Layout.fitPartsIndex(dc, parts, yCode, yPos - yCode, nl),
                           Graphics.COLOR_YELLOW);

        Layout.drawBox(dc, yPos, yHow - yPos, "Chiffre " + (_pos + 1) + "/6",
                       tl, Graphics.COLOR_WHITE);
        Layout.drawBestBox(dc, yHow, yStat - yHow,
                           ["HAUT/BAS puis SELECT", "HAUT/BAS + SELECT", "HAUT/BAS"],
                           tl, Graphics.COLOR_WHITE);

        if (!_status.equals("")) {
            Layout.drawBox(dc, yStat, yEnd - yStat, _status, tl, Graphics.COLOR_RED);
        }
    }
}

class PairingDelegate extends WatchUi.BehaviorDelegate {

    hidden var _view;

    function initialize(view) {
        BehaviorDelegate.initialize();
        _view = view;
    }

    function onPreviousPage() { _view.up();   return true; }
    function onNextPage()     { _view.down(); return true; }
    function onBack()         { return _view.back(); }

    function onSelect() {
        if (_view.next()) {
            _view.setStatus("Envoi...");
            Api.redeem(_view.code(), method(:onRedeem));
        }
        return true;
    }

    // redeem_watch_pairing_code repond en jsonb : {"ok":true,"token":"..."} ou
    // {"ok":false,"reason":"..."}. Un refus metier arrive donc en 200 - c'est
    // voulu : un RAISE annulerait l'ecriture du compteur anti-force-brute.
    function onRedeem(responseCode, data) {
        if (responseCode == 200 && data != null && data["ok"] == true && data["token"] != null) {
            Api.setToken(data["token"]);
            // SessionDelegate PREND la vue en argument : ne jamais l'instancier
            // sans, sinon l'app plante à la bascule.
            var v = new SessionView();
            WatchUi.switchToView(v, new SessionDelegate(v), WatchUi.SLIDE_IMMEDIATE);
            return;
        }
        // Raison metier (corps 200 "reason", ou "message" d'un vrai 4xx).
        var txt = Api.reasonText(Api.errorReason(data));
        if (txt != null) { _view.setStatus(txt); return; }
        if (responseCode == 200 || responseCode == 400 || responseCode == 404) {
            _view.setStatus("Code refuse");
            return;
        }
        _view.setStatus("Erreur " + responseCode.toString());
    }
}
