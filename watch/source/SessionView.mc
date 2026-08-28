// watch/source/SessionView.mc
// Écran principal : score du match courant + saisie.
// La montre N'A PAS de moteur de score : elle affiche ce que le serveur
// renvoie (spec §13). Le seul état local est la file d'envoi.
// Chaines AFFICHEES sans accents (polices Garmin).
using Toybox.WatchUi;
using Toybox.Graphics;
using Toybox.Timer;
using Toybox.Lang;
using Toybox.System;

class SessionView extends WatchUi.View {

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

    // Enregistre localement PUIS envoie : le poignet ne doit jamais attendre.
    function tap(eventType, team) {
        if (!isReady()) { return; }
        Queue.push(_sid, eventType, team, Queue.nextSeq());
        _msg = "";
        WatchUi.requestUpdate();
        sendHead();
    }

    // Appui long sur HAUT : ouvre la confirmation de validation. On ne propose
    // rien tant que le serveur n'a pas dit que le match etait joue — inutile
    // d'envoyer une demande vouee au refus.
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

        if (_sid == null) {
            Layout.drawFit(dc, h / 2, _msg, Layout.textLadder(), Graphics.COLOR_LT_GRAY);
            return;
        }

        // PRIORITE (spec §5) : le score survit toujours, le reste s'efface.
        // Chaque element est tente a sa hauteur ; s'il ne tient pas, on ne
        // dessine rien plutot qu'un texte rogne.

        // 1. Le score, l'element consulte entre deux points.
        Layout.drawFit(dc, h * 26 / 100, _score1, Layout.numberLadder(), Graphics.COLOR_WHITE);
        Layout.drawFit(dc, h * 64 / 100, _score2, Layout.numberLadder(), Graphics.COLOR_WHITE);

        // 2. Le point en cours — la raison d'etre du mode points.
        var hasPoint = false;
        if (_pointLabel != null) {
            hasPoint = Layout.drawFit(dc, h * 75 / 100, _pointLabel,
                                      Layout.textLadder(), Graphics.COLOR_YELLOW);
        }

        // 3. Les noms : complets, puis initiales, puis rien.
        Layout.drawBest(dc, h * 10 / 100, [_team1, _team1Short],
                        Layout.textLadder(), Graphics.COLOR_YELLOW);
        Layout.drawBest(dc, h * 50 / 100, [_team2, _team2Short],
                        Layout.textLadder(), Graphics.COLOR_YELLOW);

        // 4. Le message, le moins critique. Remonte quand aucun point
        //    n'occupe la place : la corde y est plus large.
        var msgY = hasPoint ? (h * 84 / 100) : (h * 78 / 100);
        if (_contests > 0) {
            Layout.drawFit(dc, msgY, _contests.toString() + " contestation",
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

    // Mapping SPATIAL : les deux equipes sont affichees l'une au-dessus de
    // l'autre, les deux boutons sont l'un au-dessus de l'autre sur le flanc
    // gauche. HAUT marque pour l'equipe du HAUT, BAS pour celle du BAS — le
    // geste suit le regard, il n'y a rien a memoriser.
    // (Avant : SELECT en haut a DROITE pour l'equipe 1 et BAS a gauche pour
    // l'equipe 2 — deux cotes, deux hauteurs, aucun lien avec l'ecran.)
    function onPreviousPage() { _view.tap(scoreEvent(), 1); return true; }  // HAUT
    function onNextPage()     { _view.tap(scoreEvent(), 2); return true; }  // BAS
    function onSelect()       { _view.tap("undo", 0);       return true; }  // START

    // Validation : appui LONG sur HAUT (menu). Geste deliberé, impossible par
    // reflexe, et qui n'entre en conflit avec aucun bouton de saisie.
    function onMenu() {
        _view.askFinalize();
        return true;
    }

    // Sur ecran tactile, le geste suit le regard comme pour les boutons :
    // on touche la MOITIE de l'ecran ou se trouve l'equipe qui a marque.
    // Indispensable sur les montres sans boutons haut/bas (Venu Sq,
    // Vivoactive), ou onNextPage/onPreviousPage ne sont pas atteignables.
    function onTap(clickEvent) {
        var coords = clickEvent.getCoordinates();
        var y = coords[1];
        var mid = System.getDeviceSettings().screenHeight / 2;
        _view.tap(scoreEvent(), y < mid ? 1 : 2);
        return true;
    }

    // Validation tactile : appui LONG sur l'ecran. Meme chemin que onMenu
    // (HAUT long) : on ne duplique pas la logique de askFinalize(), on
    // l'appelle. Geste deliberé, impossible par reflexe, et DISTINCT de
    // l'annulation (onSwipe, ci-dessous) — les deux ne doivent JAMAIS se
    // confondre.
    function onHold(clickEvent) {
        _view.askFinalize();
        return true;
    }

    // Filet d'annulation pour les appareils tactiles sans aucun bouton
    // physique (etrextouch). Meme chemin que onSelect (bouton START) :
    // _view.tap("undo", 0). Ajoute sans condition sur le materiel : sur une
    // montre a boutons, START reste le geste documente et celui-ci ne genera
    // jamais rien.
    function onSwipe(swipeEvent) {
        _view.tap("undo", 0);
        return true;
    }
}
