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
    hidden var _setsWon1 = 0;
    hidden var _setsWon2 = 0;
    hidden var _games1 = 0;
    hidden var _games2 = 0;
    hidden var _pointLabel = null;   // "30 - 40" en mode points, null sinon
    hidden var _mode = "games";
    hidden var _contests = 0;
    hidden var _finished = false;
    hidden var _isScorer = true;
    hidden var _msg = "Chargement...";
    hidden var _timer = null;
    hidden var _inFlight = null;   // client_seq de la requete en vol, null si aucune

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
        if (Queue.size() > 0) { sendHead(); } else { refresh(); }
    }

    function sessionId() { return _sid; }
    function isReady() { return _sid != null && !_finished && _isScorer; }
    function isPointMode() { return _mode != null && _mode.equals("points"); }

    function refresh() {
        Api.currentSession(method(:onSession));
    }

    function onSession(responseCode as Lang.Number, data as Lang.Dictionary or Lang.String or Null) as Void {
        if (responseCode != 200) {
            _msg = "Hors ligne (" + responseCode.toString() + ")";
            WatchUi.requestUpdate();
            return;
        }
        if (data == null) {
            _sid = null;
            _msg = "Aucun match en cours";
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

        var sw = d["sets_won"];
        _setsWon1 = sw["t1"];
        _setsWon2 = sw["t2"];

        // Set en cours = dernier élément du tableau des sets.
        var sets = d["sets"];
        if (sets != null && sets.size() > 0) {
            var last = sets[sets.size() - 1];
            _games1 = last["t1"];
            _games2 = last["t2"];
        }

        _pointLabel = null;
        if (d["game_label"] != null) {
            var g = d["game_label"];
            _pointLabel = g["t1"] + " - " + g["t2"];
        }

        if (_finished) {
            _msg = "Match termine - valide sur le tel";
        } else if (!_isScorer) {
            _msg = "Tu n es plus le scoreur";
        } else if (d["input_device"].equals("phone") && Queue.size() == 0) {
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

    function sendHead() {
        // Une seule requete a la fois : sans ce verrou, une reponse tardive
        // retirerait de la file un evenement jamais acquitte.
        if (_inFlight != null) { return; }
        var e = Queue.head();
        if (e == null) { return; }
        _inFlight = e["seq"];
        Api.applyEvent(e["sid"], e["type"], e["team"], e["seq"], method(:onSent));
    }

    function onSent(responseCode as Lang.Number, data as Lang.Dictionary or Lang.String or Null) as Void {
        var sent = _inFlight;
        _inFlight = null;

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
        // 4xx = refus metier definitif : rejouer ne servirait a rien et
        // bloquerait la file pour toujours. On jette et on previent.
        if (responseCode >= 400 && responseCode < 500) {
            Queue.popHead();
            _msg = "Refuse (" + responseCode.toString() + ")";
        } else {
            _msg = "En attente reseau (" + Queue.size().toString() + ")";
        }
        WatchUi.requestUpdate();
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

        // Disposition verticale (416x416 sur epix2) : deux blocs equipe
        // resserres pour degager de la place a la ligne de point vif
        // (mode points uniquement) sans chevaucher la ligne de message.
        dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 8 / 100, Graphics.FONT_XTINY, _team1, Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 22 / 100, Graphics.FONT_NUMBER_MILD,
                    _setsWon1.toString() + " - " + _games1.toString(), Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 38 / 100, Graphics.FONT_XTINY, _team2, Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 52 / 100, Graphics.FONT_NUMBER_MILD,
                    _setsWon2.toString() + " - " + _games2.toString(), Graphics.TEXT_JUSTIFY_CENTER);

        if (_pointLabel != null) {
            dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, h * 70 / 100, Graphics.FONT_NUMBER_MILD, _pointLabel, Graphics.TEXT_JUSTIFY_CENTER);
        }

        if (_contests > 0) {
            dc.setColor(Graphics.COLOR_ORANGE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, h * 90 / 100, Graphics.FONT_XTINY,
                        _contests.toString() + " contestation(s)", Graphics.TEXT_JUSTIFY_CENTER);
        } else if (!_msg.equals("")) {
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, h * 90 / 100, Graphics.FONT_XTINY, _msg, Graphics.TEXT_JUSTIFY_CENTER);
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

    function onSelect()       { _view.tap(scoreEvent(), 1); return true; }
    function onNextPage()     { _view.tap(scoreEvent(), 2); return true; }
    function onPreviousPage() { _view.tap("undo", 0);       return true; }
}
