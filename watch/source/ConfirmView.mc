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

        // Le libelle du OUI decrit une cible et non plus l'ecran entier :
        // « ICI » designe le cadre dans lequel ce texte est ecrit. Les
        // formulations vont de la plus riche a la plus pauvre (meme principe
        // que _scoreVariants) et se terminent par « OK », assez court pour
        // qu'aucun ecran du parc ne puisse le refuser : sans ce dernier
        // barreau, un cadran minuscule affichait un ecran de validation ou
        // RIEN ne disait comment valider. Le libelle du NON est inchange.
        var yesVariants;
        if (Layout.isTouch()) {
            yesVariants = ["Toucher ICI = oui", "ICI = oui", "OK"];
        } else {
            yesVariants = ["START = oui", "OK"];
        }
        var no = Layout.isTouch() ? "Vers droite = non" : "RETOUR = non";

        var yesY = h * 56 / 100;
        var noY  = h * 74 / 100;
        var msgY = h * 86 / 100;

        // ---------------------------------------------------------------
        // LA CIBLE D'ABORD, LE LIBELLE ENSUITE.
        //
        // Il y a une dependance circulaire : la largeur de la cible depend de
        // sa hauteur (c'est une corde, sur un cadran rond), sa hauteur
        // dependrait de la police du libelle, et la police depend de la
        // largeur disponible. On la casse par le PIRE CAS : la cible est
        // dimensionnee sur FONT_LARGE, le barreau le plus haut de textLadder.
        // Toute police retenue ensuite est plus petite ou egale, donc la cible
        // reste au moins aussi large que la valeur qu'on mesure ici.
        // ---------------------------------------------------------------
        var worstH = Graphics.getFontHeight(Graphics.FONT_LARGE);
        var minH   = Graphics.getFontHeight(Graphics.FONT_XTINY);
        var top = yesY - worstH / 2;
        var bot = yesY + worstH + worstH / 2;
        // Bornes de voisinage : jamais sur la ligne de score (pire cas de sa
        // propre police, elle puise dans le meme textLadder), jamais sur la
        // ligne « non ».
        var limitTop = scoreY + worstH;
        if (top < limitTop) { top = limitTop; }
        if (bot > noY)      { bot = noY; }
        // Bornes de coherence : le cadre doit CONTENIR le libelle, sinon on
        // dessine une affordance qui ment. yesY est le haut du glyphe (drawFit
        // n'utilise pas TEXT_JUSTIFY_VCENTER), et une ligne de FONT_XTINY est
        // la plus petite qu'on puisse ecrire.
        if (top > yesY)        { top = yesY; }
        if (bot < yesY + minH) { bot = yesY + minH; }

        // Largeur : la plus etroite des deux cordes utilisables, prise aux
        // DEUX bords du cadre — sur un cadran rond celle du bas est la plus
        // courte et c'est elle qui commande.
        // Layout.usableWidth renvoie un Float sur un ecran rond ; on convertit
        // ICI, une seule fois, pour qu'aucun flottant n'atteigne une primitive
        // de dessin et pour que le dessin et le test de toucher travaillent sur
        // exactement la meme valeur entiere.
        var wTop = Layout.usableWidth(dc, top);
        var wBot = Layout.usableWidth(dc, bot);
        var bwf = wTop < wBot ? wTop : wBot;
        var bw = bwf.toNumber();

        _btnX = dc.getWidth() / 2 - bw / 2;
        _btnY = top;
        _btnW = bw;
        _btnH = bot - top;

        // ---------------------------------------------------------------
        // LE LIBELLE, MESURE CONTRE LA CIBLE.
        //
        // C'etait le defaut : la police etait choisie sur usableWidth(yesY),
        // plus large que le cadre, si bien que les lettres des extremites
        // tombaient HORS de la zone tactile — on visait un texte dessine et
        // il ne se passait rien. Le texte et le cadre partagent maintenant UNE
        // largeur, bw. On filtre aussi sur la hauteur : la ligne doit tenir
        // dans le cadre, pas seulement a cote.
        // ---------------------------------------------------------------
        var ladder = Layout.textLadder();
        var roomH = bot - yesY;
        var yesText = null;
        var yesFont = null;
        for (var v = 0; v < yesVariants.size() && yesFont == null; v = v + 1) {
            for (var i = 0; i < ladder.size(); i = i + 1) {
                var f = ladder[i];
                if (Graphics.getFontHeight(f) <= roomH
                    && dc.getTextWidthInPixels(yesVariants[v], f) <= bw) {
                    yesText = yesVariants[v];
                    yesFont = f;
                    break;
                }
            }
        }

        // La cible est dessinee MEME si aucun libelle ne tenait : un cadre muet
        // laisse encore confirmer au toucher, alors que ne rien dessiner du
        // tout priverait de tout moyen de valider une montre sans bouton.
        // Dessinee uniquement sur ecran tactile : ailleurs elle designerait un
        // geste qui n'existe pas. La couleur ne dit rien que le texte ne dise
        // deja — c'est le CADRE qui montre ou toucher.
        if (Layout.isTouch() && _btnW > 0 && _btnH > 0) {
            dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.fillRoundedRectangle(_btnX, _btnY, _btnW, _btnH, minH / 2);
        }
        if (yesFont != null) {
            // Dessine avec LA police qu'on vient de mesurer, et non via
            // Layout.drawFit qui en rechoisirait une contre une autre largeur :
            // ce serait re-creer les deux sources qu'on vient de fusionner.
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(dc.getWidth() / 2, yesY, yesFont, yesText,
                        Graphics.TEXT_JUSTIFY_CENTER);
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
