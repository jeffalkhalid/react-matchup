// Écran de confirmation avant de valider le score depuis la montre.
//
// Pourquoi un écran dédié : valider clôt le match et déclenche la demande de
// validation chez les adversaires. Ça ne doit jamais partir d'un appui
// réflexe. On y arrive par un appui LONG sur HAUT, et il faut encore
// confirmer avec START ici.
//
// Chaines AFFICHEES sans accents (polices Garmin).
using Toybox.WatchUi;
using Toybox.Graphics;
using Toybox.Lang;

class ConfirmView extends WatchUi.View {

    hidden var _sid;
    hidden var _score;
    hidden var _msg = "";
    hidden var _busy = false;
    hidden var _done = false;

    function initialize(sid, score) {
        View.initialize();
        _sid = sid;
        _score = score;
    }

    function confirm() {
        if (_busy || _done) { return; }
        _busy = true;
        _msg = "Envoi...";
        WatchUi.requestUpdate();
        Api.finalize(_sid, method(:onDone));
    }

    function cancel() {
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
    }

    function onDone(responseCode as Lang.Number, data as Lang.Dictionary or Lang.String or Null) as Void {
        _busy = false;
        if (responseCode == 200 && data != null && !(data instanceof Lang.String)
            && data["ok"] == true) {
            _done = true;
            _msg = "Score envoye";
            WatchUi.requestUpdate();
            // On rend la main a l'ecran de match : son onShow relance un
            // rafraichissement, qui affichera l'etat final renvoye par le serveur.
            WatchUi.popView(WatchUi.SLIDE_RIGHT);
            return;
        }
        // Le serveur refuse un match non joue : on le dit en clair plutot que
        // d'afficher un code.
        var reason = Api.errorReason(data);
        var txt = Api.reasonText(reason);
        if (txt == null && reason != null) {
            if (reason.equals("no_winner"))       { txt = "Pas de vainqueur"; }
            if (reason.equals("not_enough_sets")) { txt = "Moins de 2 sets joues"; }
        }
        _msg = txt != null ? txt : "Echec (" + responseCode.toString() + ")";
        WatchUi.requestUpdate();
    }

    function onUpdate(dc) {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();
        var w = dc.getWidth();
        var h = dc.getHeight();

        dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 20 / 100, Graphics.FONT_XTINY, "Valider le score ?", Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 38 / 100, Graphics.FONT_SMALL, _score, Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 60 / 100, Graphics.FONT_XTINY, "START = oui", Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(w / 2, h * 70 / 100, Graphics.FONT_XTINY, "RETOUR = non", Graphics.TEXT_JUSTIFY_CENTER);

        if (!_msg.equals("")) {
            dc.setColor(_done ? Graphics.COLOR_GREEN : Graphics.COLOR_ORANGE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, h * 82 / 100, Graphics.FONT_XTINY, _msg, Graphics.TEXT_JUSTIFY_CENTER);
        }
    }
}

class ConfirmDelegate extends WatchUi.BehaviorDelegate {

    hidden var _view;

    function initialize(view) {
        BehaviorDelegate.initialize();
        _view = view;
    }

    function onSelect() { _view.confirm(); return true; }
    function onBack()   { _view.cancel();  return true; }
}
