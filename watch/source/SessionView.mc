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

    hidden var _sid = null;
    hidden var _team1 = "Equipe 1";
    hidden var _team2 = "Equipe 2";
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
            _msg = "Match joue - HAUT long = valider";
        } else if (!_isScorer) {
            _msg = "Tu n es plus le scoreur";
        } else if (_hadControl && device != null && device.equals("phone") && Queue.size() == 0) {
            _msg = "Le telephone a repris la main";
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
    function askFinalize() {
        if (_sid == null || !_isScorer || _finished) { return; }
        if (!_decided) {
            _msg = "Match pas termine";
            WatchUi.requestUpdate();
            return;
        }
        var v = new ConfirmView(_sid, _score1 + "  /  " + _score2);
        WatchUi.pushView(v, new ConfirmDelegate(v), WatchUi.SLIDE_LEFT);
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
            _msg = "En attente reseau (" + Queue.size().toString() + ")";
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
        var w = dc.getWidth();
        var h = dc.getHeight();

        if (_sid == null) {
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, h / 2, Graphics.FONT_SMALL, _msg, Graphics.TEXT_JUSTIFY_CENTER);
            return;
        }

        // Disposition verticale (416x416 sur epix2, cadran ROND) : les lignes
        // preexistantes gardent leurs positions d'origine (le cadran retrecit
        // vite en corde horizontale pres du bezel — ne jamais les en
        // rapprocher). La ligne de point vif (mode points) est logee dans
        // l'espace deja libre entre le score equipe 2 et le message, en
        // FONT_SMALL (plus bas que FONT_NUMBER_MILD) pour ne pas mordre sur
        // ses voisines.
        dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 10 / 100, Graphics.FONT_XTINY, _team1, Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 26 / 100, Graphics.FONT_NUMBER_MILD,
                    _score1, Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 50 / 100, Graphics.FONT_XTINY, _team2, Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 64 / 100, Graphics.FONT_NUMBER_MILD,
                    _score2, Graphics.TEXT_JUSTIFY_CENTER);

        if (_pointLabel != null) {
            dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, h * 75 / 100, Graphics.FONT_SMALL, _pointLabel, Graphics.TEXT_JUSTIFY_CENTER);
        }

        if (_contests > 0) {
            dc.setColor(Graphics.COLOR_ORANGE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, h * 84 / 100, Graphics.FONT_XTINY,
                        _contests.toString() + " contestation(s)", Graphics.TEXT_JUSTIFY_CENTER);
        } else if (!_msg.equals("")) {
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, h * 84 / 100, Graphics.FONT_XTINY, _msg, Graphics.TEXT_JUSTIFY_CENTER);
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
}
