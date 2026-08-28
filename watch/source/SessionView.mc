// watch/source/SessionView.mc
// Écran principal : score du match courant + saisie.
// La montre N'A PAS de moteur de score : elle affiche ce que le serveur
// renvoie (spec §13). Le seul état local est la file d'envoi.
// Chaines AFFICHEES sans accents (polices Garmin).
using Toybox.WatchUi;
using Toybox.Graphics;
using Toybox.Timer;
using Toybox.Lang;

class SessionView extends WatchUi.View {

    // Hauteurs de dessin, en % de la hauteur du Dc. Elles sont ICI et non en
    // dur dans onUpdate parce que la regle de decision du toucher
    // (teamForTapY) doit s'appuyer EXACTEMENT sur les memes nombres que le
    // dessin : deux jeux de valeurs qui derivent l'un de l'autre, et un point
    // part a la mauvaise equipe.
    // L'ordre des equipes est fige : equipe 1 en haut, equipe 2 en bas.
    const Y_NAME1_PCT  = 10;
    const Y_SCORE1_PCT = 26;
    const Y_NAME2_PCT  = 50;
    const Y_SCORE2_PCT = 64;

    hidden var _sid = null;
    hidden var _team1 = "Equipe 1";
    hidden var _team2 = "Equipe 2";
    hidden var _team1Short = "E1";
    hidden var _team2Short = "E2";
    // Score set par set, prêt à dessiner : « 6 4 1 ».
    hidden var _score1 = "";
    hidden var _score2 = "";
    hidden var _setsWon1 = 0;
    hidden var _setsWon2 = 0;
    hidden var _games1 = 0;
    hidden var _games2 = 0;
    hidden var _pointLabel = null;   // "30 - 40" en mode points, null sinon
    hidden var _mode = "games";
    hidden var _contests = 0;
    hidden var _finished = false;   // session cloturee cote serveur (statut <> live)
    hidden var _decided = false;    // match JOUE mais session encore live (spec §9)
    hidden var _isScorer = true;
    hidden var _hadControl = false; // la montre a-t-elle deja eu la main ce match ?
    hidden var _msg = "Chargement...";
    hidden var _timer = null;
    hidden var _inFlight = null;   // client_seq de la requete en vol, null si aucune
    hidden var _inFlightTicks = 0; // chien de garde : ticks depuis le depart
    // Hauteur du Dc relevee au dernier onUpdate. C'est la SEULE hauteur qui
    // decrit ce qui est reellement dessine ; le screenHeight de
    // getDeviceSettings decrit le materiel et peut en differer.
    hidden var _screenH = 0;

    function initialize() { View.initialize(); }

    function onShow() {
        // Passe de verification visuelle : le simulateur n'a ni jeton ni
        // session, on injecte un match type au lieu d'interroger le serveur.
        if (Demo.ENABLED) { apply(Demo.payload()); return; }
        refresh();
        _timer = new Timer.Timer();
        // Renvoi périodique de la file + rafraichissement de l'affichage.
        _timer.start(method(:onTick), 5000, true);
    }

    function onHide() {
        if (_timer != null) { _timer.stop(); _timer = null; }
    }

    function onTick() as Void {
        // Chien de garde : si la plateforme ne rappelle JAMAIS, _inFlight reste
        // pose, sendHead ressort aussitot et onTick ne rafraichit plus (branche
        // else) -> ecran fige sous le doigt. Au bout de ~15 s on relache.
        // Aucun risque de doublon : le rejeu porte le meme client_seq et le
        // serveur est idempotent dessus.
        if (_inFlight != null) {
            _inFlightTicks = _inFlightTicks + 1;
            if (_inFlightTicks >= 3) { _inFlight = null; _inFlightTicks = 0; }
        }
        if (Queue.size() > 0) { sendHead(); } else { refresh(); }
    }

    function sessionId() { return _sid; }
    // Volontairement sur _finished (statut serveur) et NON sur _decided :
    // le telephone autorise « Continuer un set » apres un match joue, la
    // montre doit pouvoir marquer ces jeux-la.
    function isReady() { return _sid != null && !_finished && _isScorer; }
    function isPointMode() { return _mode != null && _mode.equals("points"); }

    function refresh() {
        Api.currentSession(method(:onSession));
    }

    function onSession(responseCode as Lang.Number, data as Lang.Dictionary or Lang.String or Null) as Void {
        if (responseCode != 200) {
            var reason = Api.errorReason(data);
            // Lien revoque depuis le telephone : sans ca l'app resterait bloquee
            // sur une erreur generique, sans aucun chemin de retour (F4).
            if (reason != null && reason.equals("token_revoked")) { unpair(); return; }
            var txt = Api.reasonText(reason);
            _msg = txt != null ? txt : "Hors ligne (" + responseCode.toString() + ")";
            WatchUi.requestUpdate();
            return;
        }
        // Le serveur renvoie TOUJOURS un objet (jamais null) : Connect IQ
        // rejetterait un `null` par -400. `has_session` porte donc l'absence
        // de match. On garde le test `data == null` en filet pour un serveur
        // pas encore migre.
        if (data == null || data instanceof Lang.String || data["has_session"] != true) {
            _sid = null;
            // Interrupteur global coupe depuis le Panel Arbitre : on le dit,
            // au lieu de laisser croire qu'aucun match n'est en cours.
            if (data != null && !(data instanceof Lang.String) && data["disabled"] == true) {
                _msg = "Fonction desactivee";
            } else {
                _msg = "Aucun match en cours";
            }
            WatchUi.requestUpdate();
            return;
        }
        apply(data);
    }

    hidden function apply(d) {
        _sid      = d["session_id"];
        _team1    = d["team1"];
        _team2    = d["team2"];
        _team1Short = d["team1_short"];
        _team2Short = d["team2_short"];
        _mode     = d["scoring_mode"];
        _contests = d["contest_count"];
        _finished = d["finished"];
        _isScorer = d["is_scorer"];
        // Serveur pas encore migre (cle absente) -> on ne suppose rien.
        _decided = d["match_decided"] == true;

        var sw = d["sets_won"];
        _setsWon1 = sw["t1"];
        _setsWon2 = sw["t2"];

        // Ligne de score SET PAR SET, une colonne par set, exactement comme la
        // carte de match du téléphone : « 6 4 1 ». L'ancien format « sets - jeux »
        // (« 2 - 1 ») se lisait spontanément comme un score de 2 à 1 alors qu'il
        // voulait dire « 2 sets gagnés, 1 jeu en cours » — illisible au poignet.
        var sets = d["sets"];
        _score1 = "";
        _score2 = "";
        if (sets != null && sets.size() > 0) {
            for (var i = 0; i < sets.size(); i = i + 1) {
                var s = sets[i];
                if (i > 0) { _score1 = _score1 + " "; _score2 = _score2 + " "; }
                _score1 = _score1 + s["t1"].toString();
                _score2 = _score2 + s["t2"].toString();
            }
            var last = sets[sets.size() - 1];
            _games1 = last["t1"];
            _games2 = last["t2"];
        }

        _pointLabel = null;
        if (d["game_label"] != null) {
            var g = d["game_label"];
            _pointLabel = g["t1"] + " - " + g["t2"];
        }

        var device = d["input_device"];
        // Memoire locale : « le telephone a REPRIS la main » n'a de sens que si la
        // montre l'a effectivement eue. input_device_at ne suffit pas : il bouge
        // aussi quand le telephone marque, donc des le premier jeu du match.
        if (device != null && device.equals("watch")) { _hadControl = true; }

        if (_finished) {
            // Session close cote serveur : plus rien a faire au poignet.
            _msg = "Match termine";
        } else if (_decided) {
            // Match joue mais pas encore valide : on indique le geste, sinon
            // personne ne devine qu'un appui long ouvre la validation.
            _msg = Layout.isTouch() ? "Valider : appui long" : "Valider : HAUT long";
        } else if (!_isScorer) {
            _msg = "Plus scoreur";
        } else if (_hadControl && device != null && device.equals("phone") && Queue.size() == 0) {
            _msg = "Tel a la main";
        } else {
            _msg = "";
        }
        WatchUi.requestUpdate();
    }

    // A quelle equipe attribuer un toucher a la hauteur y ? 1, 2, ou 0 =
    // AUCUNE, on ignore le toucher.
    //
    // Pourquoi ce n'est pas « au-dessus de la moitie = equipe 1 » :
    // Layout.drawFit appelle drawText avec TEXT_JUSTIFY_CENTER SEUL, sans
    // TEXT_JUSTIFY_VCENTER. Le y qu'on lui donne est donc le HAUT de la boite
    // de glyphe, pas son centre. Le score de l'equipe 1 est pose a
    // Y_SCORE1_PCT et DESCEND de toute la hauteur de sa police ; rien ne
    // garantit qu'il s'arrete avant la mi-hauteur. Couper a h/2 creditait
    // l'equipe 2 quand on touchait le bas des chiffres de l'equipe 1 — la
    // cible la plus naturelle.
    //
    // Regle, et non valeur reglee a l'oeil :
    //   bas possible de l'equipe 1 = Y_SCORE1_PCT + hauteur de FONT_NUMBER_HOT
    //     (la police la plus haute de numberLadder, donc le pire cas ; si
    //     drawFit a du descendre l'echelle, le vrai bas est plus haut encore)
    //   haut de l'equipe 2         = Y_NAME2_PCT (son nom, son premier element)
    // La bande morte va du plus petit au plus grand des deux : ils peuvent se
    // croiser sur un ecran ou FONT_NUMBER_HOT est tres haute, et la formule
    // reste juste dans les deux sens. On l'elargit d'une demi-ligne de la plus
    // petite police du parc de chaque cote : c'est le plus petit pas vertical
    // que cette interface sait dessiner, et un doigt est au moins aussi
    // imprecis que ca.
    //
    // Enfin on la BORNE aux deux lignes de score : la ligne de score d'une
    // equipe est le seul element qui lui appartient sans discussion possible,
    // elle ne doit jamais tomber dans la bande morte — sinon, sur un ecran ou
    // FONT_NUMBER_HOT serait enorme, viser les chiffres de l'equipe 2 ne ferait
    // plus rien du tout et la montre deviendrait inutilisable au toucher.
    //
    // Un toucher dans la bande ne fait RIEN. C'est le compromis voulu : un
    // toucher sans effet se rattrape d'un second toucher, un point credite a
    // la mauvaise equipe se paie en pleine partie.
    function teamForTapY(y) {
        // Jamais dessine : on ne connait pas la mise en page, on ne devine pas.
        if (_screenH <= 0) { return 0; }
        var score1Top = _screenH * Y_SCORE1_PCT / 100;
        var score2Top = _screenH * Y_SCORE2_PCT / 100;
        var bottom1 = score1Top + Graphics.getFontHeight(Graphics.FONT_NUMBER_HOT);
        var top2 = _screenH * Y_NAME2_PCT / 100;
        var guard = Graphics.getFontHeight(Graphics.FONT_XTINY) / 2;
        var bandTop    = (bottom1 < top2 ? bottom1 : top2) - guard;
        var bandBottom = (bottom1 > top2 ? bottom1 : top2) + guard;
        if (bandTop < score1Top)    { bandTop = score1Top; }
        if (bandBottom > score2Top) { bandBottom = score2Top; }
        if (bandBottom < bandTop)   { bandBottom = bandTop; }
        if (y < bandTop)    { return 1; }
        if (y > bandBottom) { return 2; }
        return 0;
    }

    // "1 contestation", "2 contestations". L'accord se fait ici et nulle part
    // ailleurs : la chaine est lue par deux appelants (la variante composee du
    // message et la branche contestation seule), et un pluriel faux sur l'un
    // des deux serait exactement le genre de divergence qu'on traque.
    // 16 caracteres au pire ("10 contestations"), ASCII, sans accent.
    hidden function contestLabel() {
        if (_contests > 1) { return _contests.toString() + " contestations"; }
        return "1 contestation";
    }

    // Enregistre localement PUIS envoie : le poignet ne doit jamais attendre.
    function tap(eventType, team) {
        if (!isReady()) { return; }
        Queue.push(_sid, eventType, team, Queue.nextSeq());
        _msg = "";
        WatchUi.requestUpdate();
        sendHead();
    }

    // Annulation du dernier evenement. Passe par tap() comme n'importe quel
    // autre evenement, mais elle s'ANNONCE : tap() efface _msg, si bien que le
    // seul signe d'une annulation etait le score qui bougeait tout seul apres
    // l'aller-retour serveur. Personne ne fixe l'ecran a cet instant-la, et une
    // annulation est destructrice.
    // Le message suit la convention de _msg, sans nouveau mecanisme : il tient
    // jusqu'a la prochaine reponse du serveur (apply, via onSent ou le refresh
    // periodique de onTick), qui le remplace normalement.
    function undo() {
        if (!isReady()) { return; }
        tap("undo", 0);
        _msg = "Annulation";
        WatchUi.requestUpdate();
    }

    // Ouvre la confirmation de validation. DEUX chemins y menent : appui LONG
    // sur HAUT (comportement MENU) et, sur une montre tactile, appui LONG sur
    // l'ecran (onHold). On ne propose rien tant que le serveur n'a pas dit que
    // le match etait joue — inutile d'envoyer une demande vouee au refus.
    //
    // Le score part sur ConfirmView en PLUSIEURS formulations (riche -> pauvre) :
    // ConfirmView.onUpdate les tente avec Layout.drawBest et dessine la premiere
    // qui tient. Sans ca, un Layout.drawFit sur la version longue se serait
    // contente de ne RIEN dessiner sur un petit ecran rond — l'utilisateur
    // validerait un score qu'il n'a jamais vu. La derniere variante ("647/465",
    // sans aucun espace) est volontairement compacte au point qu'il est
    // implausible qu'elle ne tienne nulle part.
    function askFinalize() {
        if (_sid == null || !_isScorer || _finished) { return; }
        if (!_decided) {
            _msg = "Match pas termine";
            WatchUi.requestUpdate();
            return;
        }
        var scoreVariants = [
            _score1 + "  /  " + _score2,
            _score1 + " / " + _score2,
            stripSpaces(_score1) + "/" + stripSpaces(_score2)
        ];
        var v = new ConfirmView(_sid, scoreVariants);
        WatchUi.pushView(v, new ConfirmDelegate(v), WatchUi.SLIDE_LEFT);
    }

    // "6 4 7" -> "647". Sert uniquement a batir la variante la plus compacte
    // du score pour ConfirmView (cf. askFinalize) : _score1/_score2 separent
    // deja chaque set par un espace, on l'enleve pour la formulation la plus
    // serree qui reste sans ambiguite grace au "/" entre les deux equipes.
    hidden function stripSpaces(s) {
        var out = "";
        var chars = s.toCharArray();
        for (var i = 0; i < chars.size(); i = i + 1) {
            if (chars[i] != ' ') { out = out + chars[i].toString(); }
        }
        return out;
    }

    function sendHead() {
        // Une seule requete a la fois : sans ce verrou, une reponse tardive
        // retirerait de la file un evenement jamais acquitte.
        if (_inFlight != null) { return; }
        var e = Queue.head();
        if (e == null) { return; }
        _inFlight = e["seq"];
        _inFlightTicks = 0;
        Api.applyEvent(e["sid"], e["type"], e["team"], e["seq"], method(:onSent));
    }

    function onSent(responseCode as Lang.Number, data as Lang.Dictionary or Lang.String or Null) as Void {
        var sent = _inFlight;
        _inFlight = null;
        _inFlightTicks = 0;

        var head = Queue.head();
        // Reponse orpheline : la tete de file n'est plus celle qu'on a envoyee.
        // Ne RIEN retirer, sinon on jette un evenement non acquitte.
        if (head == null || sent == null || head["seq"] != sent) {
            WatchUi.requestUpdate();
            return;
        }

        if (responseCode == 200) {
            Queue.popHead();
            if (data != null) { apply(data); }
            if (Queue.size() > 0) { sendHead(); } // on vide la file d'affilee
            return;
        }
        var reason = Api.errorReason(data);
        // Lien revoque : le jeton ne vaut plus rien, on repart de l'appairage.
        if (reason != null && reason.equals("token_revoked")) { unpair(); return; }

        // On ne jette QUE sur un refus metier definitif. Le reste de la bande
        // 4xx est de l'infrastructure et le rejeu marchera : 404 = cache de
        // schema PostgREST en cours de rechargement (nos propres NOTIFY pgrst
        // le provoquent), 408/429 = temporisation du edge. Les y jeter
        // effacerait un vrai point. Les codes de transport Connect IQ, negatifs,
        // tombent aussi ici : rejeu, jamais de retrait.
        if (responseCode == 400 || responseCode == 403 || responseCode == 409) {
            Queue.popHead();
            var txt = Api.reasonText(reason);
            _msg = txt != null ? txt : "Refuse (" + responseCode.toString() + ")";
        } else {
            _msg = "En attente : " + Queue.size().toString();
        }
        WatchUi.requestUpdate();
    }

    // Retour a l'ecran d'appairage. SEUL chemin de retour apres un
    // « Delier ma montre » depuis le telephone : sans lui, fn_watch_link leve
    // token_revoked pour toujours et l'app est bonne a reinstaller.
    // La file est videe : ses evenements visent une session que cette montre
    // n'a plus le droit de toucher.
    hidden function unpair() {
        Api.clearToken();
        Queue.clear();
        _inFlight = null;
        if (_timer != null) { _timer.stop(); _timer = null; }
        var v = new PairingView();
        v.setStatus("Montre deliee - reappairer");
        // PairingDelegate PREND la vue en argument (cf. PagMatchApp).
        WatchUi.switchToView(v, new PairingDelegate(v), WatchUi.SLIDE_IMMEDIATE);
    }

    function onUpdate(dc) {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();
        var h = dc.getHeight();
        _screenH = h;

        if (_sid == null) {
            Layout.drawFit(dc, h / 2, _msg, Layout.textLadder(), Graphics.COLOR_LT_GRAY);
            return;
        }

        // PRIORITE (spec §5) : le score survit toujours, le reste s'efface.
        // Chaque element est tente a sa hauteur ; s'il ne tient pas, on ne
        // dessine rien plutot qu'un texte rogne.

        // 1. Le score, l'element consulte entre deux points.
        Layout.drawFit(dc, h * Y_SCORE1_PCT / 100, _score1, Layout.numberLadder(), Graphics.COLOR_WHITE);
        Layout.drawFit(dc, h * Y_SCORE2_PCT / 100, _score2, Layout.numberLadder(), Graphics.COLOR_WHITE);

        // 2. Le point en cours — la raison d'etre du mode points.
        var hasPoint = false;
        if (_pointLabel != null) {
            hasPoint = Layout.drawFit(dc, h * 75 / 100, _pointLabel,
                                      Layout.textLadder(), Graphics.COLOR_YELLOW);
        }

        // 3. Les noms : complets, puis initiales, puis rien.
        Layout.drawBest(dc, h * Y_NAME1_PCT / 100, [_team1, _team1Short],
                        Layout.textLadder(), Graphics.COLOR_YELLOW);
        Layout.drawBest(dc, h * Y_NAME2_PCT / 100, [_team2, _team2Short],
                        Layout.textLadder(), Graphics.COLOR_YELLOW);

        // 4. Le message, le moins critique. Remonte quand aucun point
        //    n'occupe la place : la corde y est plus large.
        var msgY = hasPoint ? (h * 84 / 100) : (h * 78 / 100);
        if (_contests > 0 && !_msg.equals("")) {
            // Les DEUX faits comptent : une contestation ouverte, ET ce que _msg
            // a a dire. Cette branche montrait autrefois la contestation A LA
            // PLACE de _msg, si bien qu'une annulation par balayage n'affichait
            // RIEN tant qu'une contestation etait ouverte.
            //
            // ORDRE DE SACRIFICE, et il compte. On a d'abord essaye
            // [compose, _msg] : faux, parce que _msg n'est PAS toujours
            // transitoire. apply() le repose a chaque rafraichissement sur des
            // etats DURABLES ("Match termine", "Valider : appui long",
            // "Plus scoreur", "Tel a la main"...). Dans ces etats la forme
            // composee depasse la largeur, drawBest retombait sur _msg seul, et
            // le compteur de contestations disparaissait POUR TOUJOURS : on
            // pouvait valider un score conteste sans que rien ne le signale.
            //
            // L'ordre juste est donc compose -> contestation seule -> _msg :
            //   - annulation ("Annulation +1 cont", 18 car.) : la forme
            //     composee tient, l'accuse s'affiche ;
            //   - etat durable ("Valider : appui long" + suffixe = 28 car.) :
            //     elle ne tient pas, et c'est la CONTESTATION qui survit.
            // C'est le bon survivant : une contestation ouverte doit etre
            // visible avant une validation irreversible, alors que
            // "Valider : appui long" ne fait que rappeler un geste que
            // l'utilisateur est de toute facon en train de faire.
            Layout.drawBest(dc, msgY,
                            [_msg + " +" + _contests.toString() + " cont",
                             contestLabel(),
                             _msg],
                            Layout.textLadder(), Graphics.COLOR_ORANGE);
        } else if (_contests > 0) {
            Layout.drawFit(dc, msgY, contestLabel(),
                           Layout.textLadder(), Graphics.COLOR_ORANGE);
        } else {
            Layout.drawFit(dc, msgY, _msg, Layout.textLadder(), Graphics.COLOR_LT_GRAY);
        }
    }
}

class SessionDelegate extends WatchUi.BehaviorDelegate {

    hidden var _view;

    function initialize(view) {
        BehaviorDelegate.initialize();
        _view = view;
    }

    // Le type d'evenement depend de la granularite choisie au demarrage.
    hidden function scoreEvent() {
        return _view.isPointMode() ? "point_won" : "game_won";
    }

    // ------------------------------------------------------------------
    // POURQUOI CES TROIS COMPORTEMENTS RENVOIENT false
    //
    // Doc SDK, WatchUi.BehaviorDelegate : « If a BehaviorDelegate returns true
    // for a function (indicating the input was used) then the InputDelegate
    // function that corresponds to the behavior will not be called. »
    // Or un comportement n'est PAS un bouton :
    //   onSelect       = KEY_ENTER *ou* un CLICK_TYPE_TAP sur ecran tactile
    //   onNextPage     = KEY_DOWN  *ou* un SWIPE_UP *ou* un SWIPE_LEFT
    //   onPreviousPage = KEY_UP    *ou* un SWIPE_DOWN
    // La doc SDK ne cite que SWIPE_UP pour onNextPage ; le cablage reel de
    // l'epix2 (%APPDATA%/Garmin/ConnectIQ/Devices/epix2/simulator.json, entree
    // display.behaviors) y ajoute swipeLeft. C'est par LA que passe
    // l'annulation par balayage vers la gauche : sans ce fait, on ne comprend
    // pas pourquoi elle aboutit dans onSwipe.
    // Tant qu'ils renvoyaient true, onTap et onSwipe n'etaient JAMAIS appeles :
    // toucher l'ecran ANNULAIT le point precedent (onSelect etait cable sur
    // undo), et balayer vers le haut MARQUAIT un point pour l'equipe 2.
    //
    // On renvoie donc false, ce qui fait appeler la fonction InputDelegate
    // correspondante (onKey pour un bouton, onTap/onSwipe pour un geste), et on
    // reprend les boutons un par un dans onKey ci-dessous. Le trajet des
    // boutons physiques est identique a ce qu'il etait : HAUT -> equipe 1,
    // BAS -> equipe 2, START -> undo (via undo(), qui l'affiche en plus).
    //
    // onMenu reste a true : il n'a pas d'equivalent tactile a liberer ici.
    // ------------------------------------------------------------------
    function onPreviousPage() { return false; }  // HAUT  / SWIPE_DOWN
    function onNextPage()     { return false; }  // BAS   / SWIPE_UP
    function onSelect()       { return false; }  // START / toucher

    // Validation : appui LONG sur HAUT (menu). Geste delibere, impossible par
    // reflexe, et qui n'entre en conflit avec aucun bouton de saisie.
    function onMenu() {
        _view.askFinalize();
        return true;
    }

    // Boutons physiques. Mapping SPATIAL, inchange : les deux equipes sont
    // affichees l'une au-dessus de l'autre, les deux boutons sont l'un au-dessus
    // de l'autre sur le flanc gauche. HAUT marque pour l'equipe du HAUT, BAS
    // pour celle du BAS — le geste suit le regard, il n'y a rien a memoriser.
    //
    // Ce qui n'est pas liste ici renvoie false, DELIBEREMENT : c'est ce qui
    // laisse RETOUR (KEY_ESC) sortir de l'application. Consommer les touches
    // inconnues enfermerait l'utilisateur dans l'ecran de match.
    function onKey(keyEvent) {
        var k = keyEvent.getKey();
        if (k == WatchUi.KEY_UP)   { _view.tap(scoreEvent(), 1); return true; }
        if (k == WatchUi.KEY_DOWN) { _view.tap(scoreEvent(), 2); return true; }
        // KEY_START est accepte a cote de KEY_ENTER : selon les modeles, le
        // bouton START/STOP remonte l'un ou l'autre. Les deux font undo, donc
        // aucune ambiguite possible.
        if (k == WatchUi.KEY_ENTER || k == WatchUi.KEY_START) {
            _view.undo();
            return true;
        }
        return false;
    }

    // Toucher = marquer, pour l'equipe de la moitie d'ecran touchee : le geste
    // suit le regard, comme pour les boutons.
    // La frontiere n'est pas h/2 mais une bande morte calculee par la vue (cf.
    // teamForTapY) : un toucher ambigu ne marque RIEN plutot que de marquer
    // pour la mauvaise equipe.
    function onTap(clickEvent) {
        var coords = clickEvent.getCoordinates();
        var team = _view.teamForTapY(coords[1]);
        if (team == 0) { return true; }
        _view.tap(scoreEvent(), team);
        return true;
    }

    // Appui LONG sur l'ecran = valider. Meme chemin que HAUT-long (onMenu) : on
    // appelle askFinalize(), on ne duplique pas sa logique. Geste delibere et
    // DISTINCT de l'annulation (onSwipe) — les deux ne doivent jamais se
    // confondre.
    function onHold(clickEvent) {
        _view.askFinalize();
        return true;
    }

    // Balayage vers la GAUCHE, et LUI SEUL, annule.
    //
    // Trois directions cablees sur une action destructrice, juste a cote d'une
    // bande morte calculee sur les metriques de police pour proteger UN point
    // d'un toucher errant, etait incoherent. Une manche qui glisse ou une main
    // qui essuie la sueur produit surtout des trainees LE LONG DU BRAS, donc
    // verticales a l'ecran : ce sont precisement celles qu'on ne veut pas
    // cabler. Reste l'horizontale, et la droite est prise (voir plus bas).
    //
    // HAUT et BAS sont absorbes sans rien faire (return true). On ne renvoie
    // pas false : ce serait rendre la main au comportement par defaut de
    // nextPage / previousPage, et rien ne documente ce qu'il ferait ici. Ne
    // rien faire, explicitement, est verifiable ; parier ne l'est pas.
    //
    // SWIPE_RIGHT est EXCLU et laisse passer (return false). Doc SDK,
    // BehaviorDelegate.onBack : « Some devices interpret SWIPE_RIGHT
    // SwipeEvents as KEY_ESC events. » C'est le geste de RETOUR du systeme, et
    // SessionView est la vue racine : il sort de l'application. Sur un appareil
    // tactile depourvu de bouton RETOUR, c'est la seule sortie possible — le
    // detourner enfermerait l'utilisateur dans l'ecran de match. On n'y touche
    // pas.
    function onSwipe(swipeEvent) {
        var dir = swipeEvent.getDirection();
        if (dir == WatchUi.SWIPE_RIGHT) { return false; }
        if (dir == WatchUi.SWIPE_LEFT)  { _view.undo(); return true; }
        return true;
    }
}
