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
    //
    // Chaque hauteur est aussi le PLANCHER de l'element precedent : l'ecart
    // jusqu'a la suivante est le budget vertical dans lequel l'encre doit
    // tenir (cf. Layout.fitIndex). C'est ce qui manquait — tout se dessinait a
    // sa hauteur sans savoir ou s'arretait le voisin du dessus, et sur les 14
    // familles capturees « 40 - AV » et le message s'ecrivaient PAR-DESSUS les
    // chiffres du score.
    //
    // Les deux equipes recoivent des budgets IDENTIQUES (12 % pour le nom,
    // 24 % pour le score) : ce qui les distingue doit etre leur POSITION, pas
    // leur taille (spec §7).
    // Rythme retenu, en % de la hauteur : 6 de marge haute, puis
    // 12 / 22 / 12 / 22 / 12 / 12. Les deux equipes ont des budgets
    // strictement egaux, et les deux lignes de pied en ont assez pour une
    // ligne de la plus petite police MEME sur le plus petit cadran du parc.
    // C'est ce dernier point qui a ete corrige apres une premiere capture :
    // avec 9 %, le budget du point tombait sous la hauteur de FONT_XTINY sur
    // le fenix5s (218 px) et « 40 - AV » disparaissait de l'ecran alors que la
    // place horizontale ne manquait pas.
    const Y_NAME1_PCT  = 6;
    const Y_SCORE1_PCT = 18;
    const Y_NAME2_PCT  = 40;
    const Y_SCORE2_PCT = 52;
    const Y_POINT_PCT  = 74;
    const Y_MSG_PCT    = 86;
    // Plancher de la derniere ligne. Pas le bas de l'ecran : sur un cadran
    // rond la corde y est deja nulle, et sur un rectangle une ligne collee au
    // bord se lit mal.
    const Y_BOTTOM_PCT = 98;

    hidden var _sid = null;
    hidden var _team1 = "Equipe 1";
    hidden var _team2 = "Equipe 2";
    hidden var _team1Short = "E1";
    hidden var _team2Short = "E2";
    // Score set par set, prêt à dessiner : « 6 4 1 ».
    // _score1/_score2 gardent la forme CHAINE, qui part vers ConfirmView (ou
    // elle est rendue avec une police texte, laquelle a bien un espace).
    // _sets1/_sets2 portent les MEMES sets en FRAGMENTS, un par set : c'est
    // cette forme-la qui est dessinee ici, parce que les polices FONT_NUMBER_*
    // n'ont pas toutes de glyphe d'espace (cf. Layout.drawPartsAt).
    hidden var _score1 = "";
    hidden var _score2 = "";
    hidden var _sets1 = [];
    hidden var _sets2 = [];
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
    // Le message porte DEUX formulations, riche et courte, comme les noms
    // d'equipe : dessine tres bas, il est le premier a manquer de corde sur un
    // cadran rond, et c'est souvent lui qui dit POURQUOI quelque chose a
    // echoue. Les deux sont TOUJOURS posees ensemble (setMsg) : deux champs
    // qu'on pourrait mettre a jour separement finiraient par diverger.
    hidden var _msg = "Chargement...";
    hidden var _msgShort = "Chargement";
    hidden var _timer = null;
    hidden var _inFlight = null;   // client_seq de la requete en vol, null si aucune
    hidden var _inFlightTicks = 0; // chien de garde : ticks depuis le depart
    // Hauteur du Dc relevee au dernier onUpdate. C'est la SEULE hauteur qui
    // decrit ce qui est reellement dessine ; le screenHeight de
    // getDeviceSettings decrit le materiel et peut en differer.
    hidden var _screenH = 0;

    function initialize() { View.initialize(); }

    // Pose les deux formulations du message d'un seul geste.
    hidden function setMsg(text, short) {
        _msg = text;
        _msgShort = (short == null) ? text : short;
    }

    // Le message d'un ETAT qui a deja un libelle dans Api.reasonPair. Trois
    // etats de cette vue nommaient le meme fait qu'une raison serveur, avec
    // leurs propres chaines recopiees a cote : « Fonction desactivee » /
    // feature_disabled, « Match termine » / session_not_live, « Plus le
    // scoreur » / not_the_scorer. Deux libelles pour un meme fait finissent
    // toujours par diverger, et se lisent alors comme deux problemes
    // differents. Une table, un fait, un libelle.
    hidden function setMsgReason(reason) {
        setMsg(Api.reasonText(reason), Api.reasonShort(reason));
    }

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
            if (txt != null) {
                setMsg(txt, Api.reasonShort(reason));
            } else {
                setMsg("Hors ligne (" + responseCode.toString() + ")",
                       "Hors ligne");
            }
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
                setMsgReason("feature_disabled");
            } else {
                setMsg("Aucun match en cours", "Aucun match");
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
        _sets1 = [];
        _sets2 = [];
        if (sets != null && sets.size() > 0) {
            for (var i = 0; i < sets.size(); i = i + 1) {
                var s = sets[i];
                if (i > 0) { _score1 = _score1 + " "; _score2 = _score2 + " "; }
                _score1 = _score1 + s["t1"].toString();
                _score2 = _score2 + s["t2"].toString();
                _sets1.add(s["t1"].toString());
                _sets2.add(s["t2"].toString());
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
            setMsgReason("session_not_live");
        } else if (_decided) {
            // Match joue mais pas encore valide : on indique le geste, sinon
            // personne ne devine qu'un appui long ouvre la validation.
            setMsg(Layout.isTouch() ? "Valider : appui long" : "Valider : HAUT long",
                   "Valider");
        } else if (!_isScorer) {
            // MEME libelle que le refus serveur not_the_scorer : c'est le
            // meme fait, dit par deux chemins (le champ is_scorer et le RAISE
            // du serveur). Il vient donc du meme endroit.
            setMsgReason("not_the_scorer");
        } else if (_hadControl && device != null && device.equals("phone") && Queue.size() == 0) {
            setMsg("Tel a la main", "Telephone");
        } else {
            setMsg("", "");
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
    //   bas possible de l'equipe 1 = Y_NAME2_PCT.
    //     Ce n'est plus une majoration prudente mais une GARANTIE : depuis la
    //     passe visuelle, le score de l'equipe 1 est dessine dans le budget
    //     vertical [Y_SCORE1_PCT, Y_NAME2_PCT] et aucune police plus haute
    //     n'est retenue (Layout.fitPartsIndex). Auparavant on majorait par la
    //     hauteur de FONT_NUMBER_HOT, qui pouvait depasser tres au-dela du
    //     nom de l'equipe 2 et elargissait la bande morte pour rien.
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
        var bottom1 = _screenH * Y_NAME2_PCT / 100;
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
        setMsg("", "");
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
        setMsg("Annulation", "Annule");
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
            setMsg("Match pas termine", "Non fini");
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
            if (txt != null) {
                setMsg(txt, Api.reasonShort(reason));
            } else {
                setMsg("Refuse (" + responseCode.toString() + ")",
                       "R " + responseCode.toString());
            }
        } else {
            setMsg("En attente : " + Queue.size().toString(),
                   "Attente " + Queue.size().toString());
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
        // « reappairer » etait redondant — on vient precisement d'ouvrir
        // l'ecran d'appairage — et portait le message a 26 caracteres, si bien
        // qu'il ne s'affichait sur AUCUN petit cadran rond. Meme paire que
        // Api.reasonPair("token_revoked") : un seul libelle pour un seul
        // fait, dit d'un seul endroit.
        v.setStatus(Api.reasonText("token_revoked"),
                    Api.reasonShort("token_revoked"));
        // PairingDelegate PREND la vue en argument (cf. PagMatchApp).
        WatchUi.switchToView(v, new PairingDelegate(v), WatchUi.SLIDE_IMMEDIATE);
    }

    function onUpdate(dc) {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();
        var h = dc.getHeight();
        _screenH = h;

        if (_sid == null) {
            // DERNIER APPELANT de l'ancien chemin de mesure (drawFit, corde
            // prise au HAUT de l'encre) — le defaut meme corrige partout
            // ailleurs. Inoffensif tant que la ligne est a h/2, ou la corde est
            // maximale ; faux des que ce y bouge d'un pixel vers le bas. On le
            // migre sur drawBestBox : corde a la ligne de base, budget vertical
            // (tout l'espace jusqu'au plancher de derniere ligne) et echelle de
            // formulations, comme partout ailleurs.
            var yFloor = h * Y_BOTTOM_PCT / 100;
            Layout.drawBestBox(dc, h / 2, yFloor - h / 2, [_msg, _msgShort],
                               Layout.textLadder(), Graphics.COLOR_LT_GRAY);
            return;
        }

        // PRIORITE (spec §5) : le score survit toujours, le reste s'efface.
        // Chaque element recoit en plus un BUDGET VERTICAL — l'ecart jusqu'a
        // l'element suivant — et n'est dessine que dans une police dont l'encre
        // tient dedans. Sans ce budget, tout se dessinait a sa hauteur sans
        // savoir ou s'arretait le voisin du dessus : sur les 14 familles
        // capturees, « 40 - AV » et le message s'ecrivaient PAR-DESSUS les
        // chiffres du score, et le nom de l'equipe 2 mordait sur le score de
        // l'equipe 1.
        var tl = Layout.textLadder();
        var nl = Layout.numberLadder();

        var yName1  = h * Y_NAME1_PCT  / 100;
        var yScore1 = h * Y_SCORE1_PCT / 100;
        var yName2  = h * Y_NAME2_PCT  / 100;
        var yScore2 = h * Y_SCORE2_PCT / 100;
        var yPoint  = h * Y_POINT_PCT  / 100;
        var yMsg    = h * Y_MSG_PCT    / 100;
        var yEnd    = h * Y_BOTTOM_PCT / 100;

        var hName1  = yScore1 - yName1;
        var hScore1 = yName2  - yScore1;
        var hName2  = yScore2 - yName2;
        var hScore2 = yPoint  - yScore2;

        // 1. Le score, l'element consulte entre deux points.
        //    LES DEUX EQUIPES A LA MEME TAILLE : on retient la plus petite des
        //    deux polices. Un score deux fois plus gros d'un cote se lirait
        //    comme une hierarchie entre les equipes, alors que seule leur
        //    POSITION doit les distinguer (spec §7).
        //    Le score part en fragments, un par set : cf. Layout.drawPartsAt,
        //    les polices FONT_NUMBER_* n'ont pas toutes de glyphe d'espace.
        //    Le barreau commun est RE-VERIFIE pour les DEUX lignes
        //    (Layout.pairPartsIndex) : commonIndex retenait celui de la ligne
        //    la plus contrainte sans jamais le confronter au budget ni a la
        //    corde de l'autre. Sur un cadran rond c'est le score de l'equipe 2
        //    (52 %, corde plus etroite) qui commande presque toujours, donc
        //    l'equipe 1 qui heritait d'une police jamais mesuree pour son
        //    creneau — et la garantie « le score 1 ne descend pas sous
        //    Y_NAME2_PCT », sur laquelle teamForTapY s'appuie, n'en etait plus
        //    une.
        var iScore = Layout.pairPartsIndex(dc, _sets1, yScore1, hScore1,
                                               _sets2, yScore2, hScore2, nl);
        if (iScore >= 0) {
            Layout.drawPartsAt(dc, yScore1, hScore1, _sets1, nl, iScore, Graphics.COLOR_WHITE);
            Layout.drawPartsAt(dc, yScore2, hScore2, _sets2, nl, iScore, Graphics.COLOR_WHITE);
        } else {
            // DERNIER RECOURS. Le score est le SEUL element que cet ecran ne
            // doit jamais taire (spec §5, priorite 1). C'est aussi le seul
            // endroit ou la re-verification du barreau peut transformer
            // « quelque chose s'est dessine » en « rien ne s'est dessine » :
            // auparavant, commonIndex les aurait au moins dessines hors budget.
            // Si AUCUN barreau ne convient aux deux lignes, on prend le plus
            // petit de l'echelle et on dessine quand meme, quitte a deborder.
            // Un score un peu trop haut se rattrape a l'oeil ; un score absent
            // laisse l'utilisateur sans rien a lire.
            // Les deux equipes restent au MEME barreau : leur egalite de
            // traitement (spec §7) ne se relache pas parce que la place manque.
            var last = nl.size() - 1;
            Layout.drawPartsRaw(dc, yScore1, _sets1, nl, last, Graphics.COLOR_WHITE);
            Layout.drawPartsRaw(dc, yScore2, _sets2, nl, last, Graphics.COLOR_WHITE);
        }

        // 2. Les noms : complets, puis initiales, puis rien — MAIS LES DEUX AU
        //    MEME NIVEAU DE DETAIL ET A LA MEME TAILLE. En essayant chaque nom
        //    de son cote, un seul caractere d'ecart suffisait a afficher
        //    « Alexandre & Christophe » en entier face a « B&D » (vu sur
        //    venusq, fenix6, fenix6xpro) : la dissymetrie se lit comme une
        //    difference de statut entre les equipes.
        //    Barreau commun re-verifie pour les deux lignes, comme les
        //    scores (Layout.pairIndex).
        var n1 = _team1;
        var n2 = _team2;
        var iName = Layout.pairIndex(dc, n1, yName1, hName1,
                                         n2, yName2, hName2, tl);
        if (iName < 0) {
            n1 = _team1Short;
            n2 = _team2Short;
            iName = Layout.pairIndex(dc, n1, yName1, hName1,
                                         n2, yName2, hName2, tl);
        }
        Layout.drawAt(dc, yName1, hName1, n1, tl, iName, Graphics.COLOR_YELLOW);
        Layout.drawAt(dc, yName2, hName2, n2, tl, iName, Graphics.COLOR_YELLOW);

        // 3. Le point en cours — la raison d'etre du mode points.
        var hasPoint = false;
        if (_pointLabel != null) {
            hasPoint = Layout.drawBox(dc, yPoint, yMsg - yPoint, _pointLabel,
                                      tl, Graphics.COLOR_YELLOW);
        }

        // 4. Le message, le moins critique. Remonte a la place du point quand
        //    aucun point ne l'occupe : la corde y est plus large et le budget
        //    vertical double.
        var msgY = hasPoint ? yMsg : yPoint;
        var msgH = yEnd - msgY;
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
            // _msgShort ferme la liste : un dernier barreau, jamais un
            // survivant prioritaire. L'ordre de sacrifice ci-dessus est
            // inchange, on ajoute seulement un repli sous le plus pauvre.
            Layout.drawBestBox(dc, msgY, msgH,
                               [_msg + " +" + _contests.toString() + " cont",
                                contestLabel(),
                                _msg,
                                _msgShort],
                               tl, Graphics.COLOR_ORANGE);
        } else if (_contests > 0) {
            Layout.drawBox(dc, msgY, msgH, contestLabel(),
                           tl, Graphics.COLOR_ORANGE);
        } else {
            Layout.drawBestBox(dc, msgY, msgH, [_msg, _msgShort],
                               tl, Graphics.COLOR_LT_GRAY);
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
