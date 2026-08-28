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

        Layout.drawFit(dc, h * 18 / 100, "Code affiche dans l app",
                       Layout.textLadder(), Graphics.COLOR_LT_GRAY);

        var s = "";
        for (var i = 0; i < 6; i = i + 1) {
            s = s + _digits[i].toString();
            if (i == 2) { s = s + " "; }
        }
        Layout.drawFit(dc, h * 40 / 100, s, Layout.numberLadder(), Graphics.COLOR_YELLOW);

        Layout.drawFit(dc, h * 62 / 100, "Chiffre " + (_pos + 1) + "/6",
                       Layout.textLadder(), Graphics.COLOR_WHITE);
        Layout.drawFit(dc, h * 74 / 100, "HAUT/BAS puis SELECT",
                       Layout.textLadder(), Graphics.COLOR_WHITE);

        if (!_status.equals("")) {
            Layout.drawFit(dc, h * 86 / 100, _status, Layout.textLadder(), Graphics.COLOR_RED);
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
