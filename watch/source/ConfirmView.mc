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
    // Comme _scoreVariants : DEUX formulations, riche et courte. Cette ligne
    // est le seul endroit ou le refus du serveur atteint l'utilisateur, et
    // l'echelle lui avait ete oubliee (cf. onUpdate).
    hidden var _msg = "";
    hidden var _msgShort = "";
    hidden var _busy = false;
    hidden var _done = false;
    // Cible tactile de confirmation, MESUREE au dernier onUpdate (meme principe
    // que la bande morte de SessionView : on lit le Dc, on ne suppose pas).
    // Les quatre champs sont poses a CHAQUE onUpdate, sans condition — y compris
    // sur un appareil non tactile, ou aucun cadre n'est dessine : ils decrivent
    // une geometrie, pas une decision d'affichage. Seul isConfirmTarget decide,
    // et il exige une largeur ET une hauteur strictement positives ; a zero,
    // aucun toucher ne valide. Pour une action irreversible, ne rien faire est
    // le bon defaut.
    hidden var _btnX = 0;
    hidden var _btnY = 0;
    hidden var _btnW = 0;
    hidden var _btnH = 0;

    function initialize(sid, scoreVariants) {
        View.initialize();
        _sid = sid;
        _scoreVariants = scoreVariants;
    }

    // Pose les deux formulations d'un coup : elles ne peuvent pas diverger.
    hidden function setMsg(text, short) {
        _msg = text;
        _msgShort = (short == null) ? text : short;
    }

    function confirm() {
        if (_busy || _done) { return; }
        _busy = true;
        setMsg("Envoi...", "Envoi");
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
            setMsg("Score envoye", "Envoye");
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
        var shortTxt = Api.reasonShort(reason);
        if (txt == null && reason != null) {
            // « Moins de 2 sets joues » faisait 21 caracteres et ne s'affichait
            // pas sur un petit cadran rond : le serveur refusait la validation
            // et l'appui sur START avait l'air de ne rien faire du tout.
            if (reason.equals("no_winner")) {
                txt = "Pas de vainqueur"; shortTxt = "Non fini";
            }
            if (reason.equals("not_enough_sets")) {
                txt = "Moins de 2 sets"; shortTxt = "2 sets min";
            }
        }
        if (txt != null) {
            setMsg(txt, shortTxt);
        } else {
            // Le code HTTP est l'information : on le garde dans les deux
            // formulations plutot que de retomber sur un « Echec » muet.
            setMsg("Echec (" + responseCode.toString() + ")",
                   "E " + responseCode.toString());
        }
        WatchUi.requestUpdate();
    }

    function onUpdate(dc) {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();
        var h = dc.getHeight();

        // BUDGET VERTICAL sur chaque ligne (Layout.drawBox) et non plus simple
        // mesure horizontale. Deux raisons, toutes deux vues a l'ecran :
        //   - drawFit ne mesurait la corde qu'au HAUT de l'encre ; sur fenix5s
        //     le « n » final de « RETOUR = non » sortait du cadran, coupe par
        //     la lunette. Layout.lineWidth prend desormais la plus etroite des
        //     cordes du haut ET du bas de la ligne ;
        //   - la ligne de score bornee a worstH n'etait qu'une HYPOTHESE, alors
        //     que toute la bande de la cible est calculee dessous. Elle devient
        //     une garantie.
        var worstH = Graphics.getFontHeight(Graphics.FONT_LARGE);
        var minH   = Graphics.getFontHeight(Graphics.FONT_XTINY);

        var titleY = h * 20 / 100;
        var scoreY = h * 38 / 100;
        Layout.drawBox(dc, titleY, scoreY - titleY, "Valider le score ?",
                       Layout.textLadder(), Graphics.COLOR_YELLOW);

        Layout.drawBestBox(dc, scoreY, worstH, _scoreVariants,
                           Layout.textLadder(), Graphics.COLOR_WHITE);

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
        // Comme le libelle du OUI : de la plus riche a la plus pauvre. La
        // ligne du NON etait la seule du parc reellement ROGNEE par la lunette
        // (le « n » final coupe sur fenix5s). Elle est desormais mesuree a la
        // corde de sa ligne de base, ce qui la ferait DISPARAITRE sur les
        // memes cadrans — or c'est le seul rappel du geste d'annulation. Une
        // formulation courte reste donc toujours disponible.
        var noVariants = Layout.isTouch()
            ? ["Vers droite = non", "Droite = non", "NON"]
            : ["RETOUR = non", "RETOUR", "NON"];

        var noY  = h * 74 / 100;
        var msgY = h * 86 / 100;

        // ---------------------------------------------------------------
        // LA CIBLE D'ABORD, LE LIBELLE DEDANS.
        //
        // Dependance circulaire : la largeur de la cible depend de sa hauteur
        // (c'est une corde, sur un cadran rond), sa hauteur dependrait de la
        // police du libelle, et la police depend de la largeur disponible. On
        // la casse par le PIRE CAS : tout est dimensionne sur FONT_LARGE, le
        // barreau le plus haut de textLadder. Toute police retenue ensuite est
        // plus petite ou egale.
        //
        // La BANDE est calculee en premier et rien ne la repousse ensuite.
        // C'est le point corrige ici : la version precedente appliquait les
        // bornes de voisinage PUIS des bornes de coherence qui pouvaient les
        // annuler (top ramene sur yesY, plus haut que la ligne de score des que
        // FONT_LARGE depassait ~19 % de la hauteur d'ecran). Les deux familles
        // de bornes ne peuvent plus entrer en conflit : la bande est absolue,
        // la boite vit DEDANS, et le libelle est centre DANS la boite. Trois
        // inclusions emboitees, vraies pour n'importe quelles metriques de
        // police.
        // ---------------------------------------------------------------
        // Bande utilisable : sous le pire cas d'encre de la ligne de score
        // (elle puise dans le meme textLadder), au-dessus du haut de la ligne
        // « non ». Bornes ABSOLUES.
        var bandTop = scoreY + worstH;
        var bandBot = noY;
        var bandH   = bandBot - bandTop;

        // Boite souhaitee : une ligne du pire cas, plus une demi-ligne de marge
        // de chaque cote. Rabotee a la bande si la bande est plus etroite, puis
        // centree dedans. bandH negatif (ecran degenere) donne une hauteur nulle
        // : pas de cible, et isConfirmTarget refusera tout toucher.
        var wantH = worstH * 2;
        var boxH  = wantH < bandH ? wantH : bandH;
        if (boxH < 0) { boxH = 0; }
        var top = bandTop + (bandH - boxH) / 2;
        var bot = top + boxH;

        // Largeur : la plus etroite des deux cordes utilisables, prise aux DEUX
        // bords de la boite — sur un cadran rond celle du bas est la plus courte
        // et c'est elle qui commande.
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
        _btnH = boxH;

        // ---------------------------------------------------------------
        // LE LIBELLE, MESURE CONTRE LA CIBLE.
        //
        // La police est choisie contre bw, la largeur REELLE de la boite, et
        // non contre la corde de sa ligne : c'etait le defaut, les lettres des
        // extremites tombaient hors de la zone tactile. Filtre de hauteur en
        // plus : la ligne doit tenir DANS la boite, pas seulement a cote.
        // Le dernier barreau, « OK » en FONT_XTINY, tient des que la boite
        // fait au moins une ligne de FONT_XTINY de haut.
        // ---------------------------------------------------------------
        var ladder = Layout.textLadder();
        var yesText = null;
        var yesFont = null;
        var lineH = 0;
        for (var v = 0; v < yesVariants.size() && yesFont == null; v = v + 1) {
            for (var i = 0; i < ladder.size(); i = i + 1) {
                var f = ladder[i];
                var fh = Graphics.getFontHeight(f);
                if (fh <= boxH && dc.getTextWidthInPixels(yesVariants[v], f) <= bw) {
                    yesText = yesVariants[v];
                    yesFont = f;
                    lineH = fh;
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
            // Centre vertical DANS la boite : c'est ce qui garantit que le
            // libelle est contenu par sa propre cible, sans clamp a posteriori.
            // Dessine avec LA police qu'on vient de mesurer, et non via
            // Layout.drawFit qui en rechoisirait une contre une autre largeur :
            // ce serait re-creer les deux sources qu'on vient de fusionner.
            var yesY = top + (boxH - lineH) / 2;
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(dc.getWidth() / 2, yesY, yesFont, yesText,
                        Graphics.TEXT_JUSTIFY_CENTER);
        }

        Layout.drawBestBox(dc, noY, msgY - noY, noVariants,
                           Layout.textLadder(), Graphics.COLOR_LT_GRAY);

        // ECHELLE DE FORMULATIONS et budget porte de 11 % a 12 % de la hauteur
        // (97 % -> 98 %, le meme plancher de derniere ligne que SessionView).
        // Deux corrections pour un seul defaut : cette ligne etait passee a la
        // mesure par la ligne de base — bien plus etroite — sans recevoir
        // l'echelle courte que toutes les autres lignes ont recue, et avec un
        // budget SOUS le plancher de 12 % etabli par la passe precedente. Le
        // serveur refusait la finalisation et « Moins de 2 sets joues » ou
        // « Echec (500) » n'apparaissaient jamais : appuyer sur START avait
        // l'air sans effet. Verifie au simulateur (fenix5s), pas deduit.
        if (!_msg.equals("")) {
            Layout.drawBestBox(dc, msgY, (h * 98 / 100) - msgY,
                               [_msg, _msgShort],
                               Layout.textLadder(),
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
