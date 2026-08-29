// watch/source/PairingView.mc
// Saisie du code à 6 chiffres, un chiffre à la fois. Les gestes passent par les
// comportements (onPreviousPage / onNextPage / onSelect / onBack), donc chaque
// modèle les reçoit par ses propres entrées : HAUT/BAS et SELECT sur une montre
// à boutons, un balayage et un toucher sur une montre tactile. Voir le texte
// d'aide dans onUpdate, qui s'adapte via Layout.isTouch().
// Chaines AFFICHEES sans accents (polices Garmin).
using Toybox.WatchUi;
using Toybox.Graphics;

class PairingView extends WatchUi.View {

    hidden var _digits = [0, 0, 0, 0, 0, 0];
    hidden var _pos = 0;
    // Le statut porte DEUX formulations, riche et courte, comme la consigne et
    // les noms d'equipe : c'est la seule ligne de cet ecran qui dise POURQUOI
    // un code a ete refuse, et elle ne doit jamais etre muette (cf. onUpdate).
    hidden var _status = "";
    hidden var _statusShort = "";

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

    // Deux arguments : la formulation riche et son repli court. Passer null
    // (ou la meme chaine) en second quand la premiere est deja tres courte.
    function setStatus(s, short) {
        _status = s;
        _statusShort = (short == null) ? s : short;
        WatchUi.requestUpdate();
    }

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
        // 98 % et non 96 % : le budget de la ligne de statut passe de 11 % a
        // 13 % de la hauteur. En dessous de 12 %, le budget tombe sous la
        // hauteur de FONT_XTINY sur le plus petit cadran du parc et la ligne
        // disparait alors meme que la place horizontale ne manque pas — c'est
        // le plancher etabli par la passe visuelle precedente (cf.
        // SessionView, ou le meme defaut avait fait disparaitre « 40 - AV »).
        // 98 % est le meme plancher de derniere ligne que SessionView :
        // ni le bord du cadran (corde nulle), ni une ligne collee au bord.
        var yEnd   = h * 98 / 100;

        // Formulations de la plus riche a la plus pauvre, comme les noms
        // d'equipe de l'ecran de match. Sans ce garde-fou, la consigne
        // disparaissait purement et simplement des le fenix5s : mesuree a la
        // corde de sa LIGNE DE BASE elle ne tenait plus, et la regle du module
        // est de ne rien dessiner plutot que de rogner. Une consigne plus
        // courte vaut mieux qu'aucune consigne.
        Layout.drawBestBox(dc, yHint, yCode - yHint,
                           ["Code dans l app", "Code app", "Code"],
                           tl, Graphics.COLOR_LT_GRAY);

        var g1 = "";
        var g2 = "";
        for (var i = 0; i < 6; i = i + 1) {
            if (i < 3) { g1 = g1 + _digits[i].toString(); }
            else       { g2 = g2 + _digits[i].toString(); }
        }
        var parts = [g1, g2];
        var nl = Layout.numberLadder();
        var hCode = yPos - yCode;
        Layout.drawPartsAt(dc, yCode, hCode, parts, nl,
                           Layout.fitPartsIndex(dc, parts, yCode, hCode, nl),
                           Graphics.COLOR_YELLOW);

        Layout.drawBox(dc, yPos, yHow - yPos, "Chiffre " + (_pos + 1) + "/6",
                       tl, Graphics.COLOR_WHITE);
        // LA CONSIGNE NOMME LE GESTE QUE CETTE MONTRE-LA SAIT FAIRE.
        //
        // Cette ligne enoncait « HAUT/BAS puis SELECT » sur les 53 modeles.
        // Or cinq d'entre eux n'ont pas ces boutons : les quatre variantes de
        // vivoactive3 n'ont qu'une touche `enter`, et etrextouch n'en a aucune.
        // L'ecran y EST manoeuvrable — PairingDelegate.onPreviousPage /
        // onNextPage recoivent un balayage et onSelect le toucher, exactement
        // comme ils recevraient HAUT, BAS et SELECT — mais rien ne le disait.
        // Sur ces cinq modeles, le tout
        // premier ecran de l'application demandait donc d'appuyer sur des
        // boutons inexistants, et l'appairage ne pouvait pas aboutir.
        // SessionView et ConfirmView branchent deja sur Layout.isTouch() ;
        // c'est la meme branche, avec la meme echelle de formulations.
        //
        // Formulation tactile tracee sur le delegate de CET ecran, pas
        // supposee : un balayage change le chiffre courant, un toucher valide
        // et passe au suivant. La DIRECTION du balayage n'est volontairement
        // pas nommee, car elle differe d'un modele a l'autre : epix2 associe
        // swipeDown/swipeUp aux deux comportements, etrextouch y associe
        // swipeRight/swipeLeft. « Balayer » est donc vrai partout, la ou
        // « balayer vers le haut » serait faux sur le seul modele sans boutons.
        var howVariants = Layout.isTouch()
            ? ["Balayer puis toucher", "Balayer + toucher", "Balayer"]
            : ["HAUT/BAS puis SELECT", "HAUT/BAS + SELECT", "HAUT/BAS"];
        Layout.drawBestBox(dc, yHow, yStat - yHow, howVariants,
                           tl, Graphics.COLOR_WHITE);

        // ECHELLE DE FORMULATIONS, comme toutes les autres lignes de cet ecran.
        // Elle avait ete oubliee ici, et c'est la ligne qui la merite le plus :
        // mesuree a la corde de sa LIGNE DE BASE, elle ne dispose plus que
        // d'environ 88 px sur un fenix5s (218 px) contre 126 auparavant, soit
        // une dizaine de caracteres. « Code invalide » (13 car.), « Code
        // refuse » (11) et « Code deja utilise » (17) n'etaient donc plus
        // dessines DU TOUT : l'utilisateur tapait un mauvais code, appuyait sur
        // SELECT, et l'ecran revenait a « 000 000 / Chiffre 1/6 » sans le
        // moindre mot d'explication. Verifie au simulateur, pas deduit.
        if (!_status.equals("")) {
            Layout.drawBestBox(dc, yStat, yEnd - yStat, [_status, _statusShort],
                               tl, Graphics.COLOR_RED);
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
            _view.setStatus("Envoi...", "Envoi");
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
        var reason = Api.errorReason(data);
        var txt = Api.reasonText(reason);
        if (txt != null) { _view.setStatus(txt, Api.reasonShort(reason)); return; }
        if (responseCode == 200 || responseCode == 400 || responseCode == 404) {
            _view.setStatus("Code refuse", "Refuse");
            return;
        }
        // Le code de reponse est l'information, on le garde dans les DEUX
        // formulations : « Err 500 » reste actionnable, « Erreur » ne l'est pas.
        _view.setStatus("Erreur " + responseCode.toString(),
                        "Err " + responseCode.toString());
    }
}
