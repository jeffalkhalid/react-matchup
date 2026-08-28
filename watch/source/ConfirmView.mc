// Ecran de confirmation avant de valider le score depuis la montre.
//
// Pourquoi un ecran dedie : valider clot le match et declenche la demande de
// validation chez les adversaires. Ca ne doit jamais partir d'un appui reflexe.
//
// On y arrive par un appui LONG — bouton HAUT, ou l'ecran lui-meme sur une
// montre tactile (SessionView.onHold). Et il faut encore confirmer ICI :
// bouton START, ou un toucher DANS la cible dessinee autour du libelle
// « oui ». Un toucher ailleurs sur l'ecran ne fait RIEN : sans cette cible,
// onSelect valide sur n'importe quel effleurement, et deux contacts
// involontaires — un pour ouvrir cet ecran, un pour confirmer — suffisaient a
// envoyer un score definitif.
//
// Annuler reste facile et le doit : RETOUR, ou le balayage vers la droite.
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
    // Cible tactile de confirmation, MESUREE au dernier onUpdate (meme principe
    // que la bande morte de SessionView : on lit le Dc, on ne suppose pas).
    // Largeur ou hauteur nulle = pas de cible : aucun toucher ne valide. Pour
    // une action irreversible, ne rien faire est le bon defaut.
    hidden var _btnX = 0;
    hidden var _btnY = 0;
    hidden var _btnW = 0;
    hidden var _btnH = 0;

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

    // Le toucher tombe-t-il dans la cible de confirmation ?
    function isConfirmTarget(x, y) {
        if (_btnW <= 0 || _btnH <= 0) { return false; }
        return x >= _btnX && x <= _btnX + _btnW
            && y >= _btnY && y <= _btnY + _btnH;
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

        var scoreY = h * 38 / 100;
        Layout.drawBest(dc, scoreY, _scoreVariants, Layout.textLadder(),
                        Graphics.COLOR_WHITE);

        // Le libelle du OUI decrit maintenant une cible et non plus l'ecran
        // entier : « ICI » designe le cadre dessine juste dessous, dans lequel
        // ce texte est ecrit. Deuxieme formulation, plus courte, pour les
        // ecrans ou la premiere ne tient pas (meme principe que _scoreVariants).
        // Le libelle du NON est inchange.
        var yesVariants;
        if (Layout.isTouch()) {
            yesVariants = ["Toucher ICI = oui", "ICI = oui"];
        } else {
            yesVariants = ["START = oui"];
        }
        var no = Layout.isTouch() ? "Vers droite = non" : "RETOUR = non";

        // Le OUI remonte et le NON descend par rapport a l'ancienne mise en
        // page : il faut la place du cadre entre les deux.
        var yesY = h * 56 / 100;
        var noY  = h * 74 / 100;
        var msgY = h * 86 / 100;

        // On choisit NOUS-MEMES la formulation et la police au lieu de laisser
        // drawBest le faire : il faut la hauteur de la police pour dimensionner
        // la cible autour du libelle. Le drawFit qui suit reselectionne
        // exactement la meme police, pour le meme texte et la meme largeur.
        var yesText = null;
        var yesFont = null;
        for (var i = 0; i < yesVariants.size(); i = i + 1) {
            var f = Layout.fitFont(dc, yesVariants[i],
                                   Layout.usableWidth(dc, yesY),
                                   Layout.textLadder());
            if (f != null) { yesText = yesVariants[i]; yesFont = f; break; }
        }

        _btnX = 0; _btnY = 0; _btnW = 0; _btnH = 0;
        if (yesFont != null) {
            // GEOMETRIE MESUREE, pas reglee a l'oeil :
            //   hauteur = une ligne du libelle + une demi-ligne de marge de
            //     chaque cote (yesY est le HAUT du glyphe : drawFit n'utilise
            //     pas TEXT_JUSTIFY_VCENTER) ;
            //   largeur = la plus etroite des deux cordes utilisables aux bords
            //     haut et bas du cadre, pour rester dans l'ecran sur un cadran
            //     rond ;
            //   bornes  = jamais au-dessus de la ligne de score, jamais en
            //     dessous de la ligne « non », quelle que soit la police
            //     retenue. La cible ne mord donc sur aucun voisin.
            // Elle reste large — environ un cinquieme de l'ecran : ce qu'on
            // ecarte, c'est le contact ACCIDENTEL, pas la visee approximative.
            var lineH = Graphics.getFontHeight(yesFont);
            var pad = lineH / 2;
            var top = yesY - pad;
            var bot = yesY + lineH + pad;
            // Pire cas pour la ligne de score : elle utilise textLadder elle
            // aussi et peut donc descendre de toute la hauteur de FONT_LARGE,
            // son barreau le plus haut, meme si le libelle du OUI a herite d'une
            // police plus petite. On borne sur CE cas-la, pas sur lineH.
            var limitTop = scoreY + Graphics.getFontHeight(Graphics.FONT_LARGE);
            if (top < limitTop) { top = limitTop; }
            if (bot > noY)      { bot = noY; }
            if (bot > top) {
                var wTop = Layout.usableWidth(dc, top);
                var wBot = Layout.usableWidth(dc, bot);
                var bw = wTop < wBot ? wTop : wBot;
                if (bw > 0) {
                    _btnX = dc.getWidth() / 2 - bw / 2;
                    _btnY = top;
                    _btnW = bw;
                    _btnH = bot - top;
                    // Dessinee UNIQUEMENT sur ecran tactile : ailleurs elle
                    // designerait un geste qui n'existe pas. La couleur ne dit
                    // rien que le texte ne dise deja — c'est le CADRE qui
                    // montre ou toucher.
                    if (Layout.isTouch()) {
                        dc.setColor(Graphics.COLOR_DK_GRAY,
                                    Graphics.COLOR_TRANSPARENT);
                        dc.fillRoundedRectangle(_btnX, _btnY, _btnW, _btnH,
                                                lineH / 3);
                    }
                }
            }
            Layout.drawFit(dc, yesY, yesText, Layout.textLadder(),
                           Graphics.COLOR_WHITE);
        }

        Layout.drawFit(dc, noY, no, Layout.textLadder(), Graphics.COLOR_LT_GRAY);

        if (!_msg.equals("")) {
            Layout.drawFit(dc, msgY, _msg, Layout.textLadder(),
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

    // onSelect renvoie false. Doc SDK, BehaviorDelegate.onSelect : il represente
    // le bouton Start/Enter « or by a CLICK_TYPE_TAP ClickEvent on a touch
    // screen ». Tant qu'il renvoyait true, N'IMPORTE QUEL toucher, n'importe ou,
    // envoyait le score definitif. On le laisse donc retomber sur onKey (bouton)
    // et onTap (toucher), qui ne sont pas la meme chose.
    function onSelect() { return false; }

    // START confirme, exactement comme avant : meme geste, meme effet, aucune
    // cible a viser. Tout le reste renvoie false pour ne rien intercepter.
    function onKey(keyEvent) {
        var k = keyEvent.getKey();
        if (k == WatchUi.KEY_ENTER || k == WatchUi.KEY_START) {
            _view.confirm();
            return true;
        }
        return false;
    }

    // Le toucher ne confirme QUE dans la cible dessinee. Ailleurs : rien. On
    // renvoie quand meme true, pour qu'un toucher hors cible ne parte pas
    // chercher un comportement par defaut.
    function onTap(clickEvent) {
        var c = clickEvent.getCoordinates();
        if (_view.isConfirmTarget(c[0], c[1])) { _view.confirm(); }
        return true;
    }

    // Annuler est sans danger et doit rester facile : inchange. Sur les
    // appareils qui lisent SWIPE_RIGHT comme un KEY_ESC, le balayage vers la
    // droite arrive ici aussi.
    function onBack() { _view.cancel(); return true; }
}
