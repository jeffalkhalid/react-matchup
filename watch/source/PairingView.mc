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
        var w = dc.getWidth();
        var h = dc.getHeight();

        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 18 / 100, Graphics.FONT_XTINY, "Code affiche dans l app", Graphics.TEXT_JUSTIFY_CENTER);

        var s = "";
        for (var i = 0; i < 6; i = i + 1) {
            s = s + _digits[i].toString();
            if (i == 2) { s = s + " "; }
        }
        dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 40 / 100, Graphics.FONT_NUMBER_MILD, s, Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 62 / 100, Graphics.FONT_XTINY, "Chiffre " + (_pos + 1) + "/6", Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(w / 2, h * 74 / 100, Graphics.FONT_XTINY, "HAUT/BAS puis SELECT", Graphics.TEXT_JUSTIFY_CENTER);

        if (!_status.equals("")) {
            dc.setColor(Graphics.COLOR_RED, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, h * 86 / 100, Graphics.FONT_XTINY, _status, Graphics.TEXT_JUSTIFY_CENTER);
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
