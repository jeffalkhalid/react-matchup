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
    // Du plus riche au plus pauvre (cf. SessionView.askFinalize) : le premier
    // qui tient est dessine, jamais rien de tronque, et jamais un ecran de
    // confirmation sans AUCUN score visible (spec : le score est priorite 1).
    hidden var _scoreVariants;
    hidden var _msg = "";
    hidden var _busy = false;
    hidden var _done = false;

    function initialize(sid, scoreVariants) {
        View.initialize();
        _sid = sid;
        _scoreVariants = scoreVariants;
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
        var h = dc.getHeight();

        Layout.drawFit(dc, h * 20 / 100, "Valider le score ?",
                       Layout.textLadder(), Graphics.COLOR_YELLOW);

        Layout.drawBest(dc, h * 38 / 100, _scoreVariants, Layout.textLadder(), Graphics.COLOR_WHITE);

        // Nommer START et RETOUR est un mensonge sur un appareil tactile qui
        // n'a ni l'un ni l'autre — et l'appui long sur l'ecran de match y amene
        // desormais. On nomme donc le geste reellement disponible.
        // Verifie sur ConfirmDelegate ci-dessous, pas suppose :
        //   oui = onSelect, qui se declenche aussi sur un CLICK_TYPE_TAP
        //         (doc SDK BehaviorDelegate.onSelect) -> un simple toucher ;
        //   non = onBack, dont la doc precise que certains appareils
        //         interpretent un SWIPE_RIGHT comme un KEY_ESC -> balayage vers
        //         la droite.
        var yes = Layout.isTouch() ? "Toucher = oui"     : "START = oui";
        var no  = Layout.isTouch() ? "Vers droite = non" : "RETOUR = non";
        Layout.drawFit(dc, h * 60 / 100, yes, Layout.textLadder(), Graphics.COLOR_LT_GRAY);
        Layout.drawFit(dc, h * 70 / 100, no,  Layout.textLadder(), Graphics.COLOR_LT_GRAY);

        if (!_msg.equals("")) {
            Layout.drawFit(dc, h * 82 / 100, _msg, Layout.textLadder(),
                           _done ? Graphics.COLOR_GREEN : Graphics.COLOR_ORANGE);
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
