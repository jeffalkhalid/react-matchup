package com.pagmatch.wear

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

// Verdict de finalize(), pour ConfirmScreen. Un String? unique (null = ok,
// sinon un message) ne suffit PAS ici : contrairement a drain(), qui peut se
// permettre de rejouer une panne d'infrastructure au battement suivant sans
// que l'utilisateur ne fasse rien, cet ecran attend une decision de LUI --
// "recommencer" n'a de sens que sur une panne, jamais sur un refus metier.
// Trois issues, trois actions differentes :
//   - Success   : le score est valide, l'ecran se ferme.
//   - Refused   : le SERVEUR a tranche (400/403/409 -- no_winner, not_enough_sets,
//                 not_the_scorer...). Rejouer buterait pour toujours sur le
//                 meme refus : l'ecran reste ouvert, message affiche, mais
//                 rien ne suggere de reessayer.
//   - Unreachable : infrastructure (5xx, 401, 404 pendant un rechargement de
//                 cache PostgREST...) OU exception reseau (Bluetooth hors de
//                 portee). Le score n'a PAS ete juge -- on ne sait juste pas
//                 encore. Rejouer peut marcher : le bouton "Oui" reste donc
//                 utile, jamais a confondre avec un refus.
sealed class FinalizeResult {
    object Success : FinalizeResult()
    data class Refused(val message: String) : FinalizeResult()
    data class Unreachable(val message: String) : FinalizeResult()
}

// Un appui est enregistre dans la file (Queue.enqueue, ATOMIQUE) avant d'etre
// envoye. drain() la vide en respectant l'ordre ; un evenement non acquitte
// reste en tete et sera rejoue, ce que l'idempotence serveur (client_seq)
// rend sur.
//
// UNE SEULE instance de MatchStore existe par PROCESSUS (voir get() dans le
// companion) : c'est elle qui porte l'unique Queue. Voir le commentaire
// d'enqueue() dans Queue.kt : 8 threads, chacun avec SA PROPRE Queue sur le
// meme store, ont perdu entre 265 et 280 evenements sur 320 -- le verrou
// interne de Queue ne protege que les appels faits SUR LA MEME instance.
// `remember` dans un Composable ne suffisait PAS : Wear OS termine l'activite
// au balayage vers la droite et le manifeste ne declare aucun configChanges,
// donc rouvrir l'app construisait une DEUXIEME MatchStore -- donc une deuxieme
// Queue -- pendant qu'un envoi de la premiere etait encore en vol, sur le meme
// SharedPreferences. Exactement le scenario mesure : dernier ecrivain gagne,
// un point en file disparait. La duree de vie de la file est celle de SES
// DONNEES (le disque), pas celle d'un ecran : ce store vit donc aussi
// longtemps que le processus, et un envoi commence survit a l'activite qui
// l'a declenche au lieu d'etre double par une seconde instance.
class MatchStore(
    private val prefs: TokenStore,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Main),
    // Point d'injection reseau. Toute la politique de retrait de la file vit
    // dans drain() et rien ne la testait ; ces deux lambdas rendent le serveur
    // remplacable, donc drain() exercable hors Android (cf. MatchStoreTest,
    // qui rejoue notamment le mode avion : trois points hors reseau, puis
    // reconnexion, tous les trois arrives dans l'ordre une seule fois).
    private val fetchSession: suspend (String) -> Api.ApiResponse = { t -> Api.currentSession(t) },
    private val sendEvent: suspend (String, Pending) -> Api.ApiResponse =
        { t, e -> Api.applyEvent(t, e.sid, e.type, e.team, e.seq) },
    // Meme seam que fetchSession/sendEvent, pour la meme raison : finalize()
    // a sa propre politique de retrait (voir plus bas) et rien ne la testait
    // avant ConfirmScreen. Signature volontairement identique a Api.finalize
    // (token, sessionId) -> ApiResponse.
    private val finalizeSession: suspend (String, String) -> Api.ApiResponse =
        { t, sid -> Api.finalize(t, sid) },
    private val now: () -> Long = { System.currentTimeMillis() },
    // Periode du battement. Injectee pour que les tests puissent verifier que
    // le battement BAT VRAIMENT (et repart apres un reappairage) en
    // millisecondes plutot qu'en secondes d'horloge murale.
    private val tickMs: Long = TICK_MS,
) {
    private val queue = Queue(prefs)

    private val _session = MutableStateFlow<Session?>(null)
    val session: StateFlow<Session?> = _session

    // Message court affiche sous les deux moities. Porte aussi bien l'accuse
    // de reception d'un point ("Point K&A") qu'un refus serveur ("Plus le
    // scoreur") qu'une panne reseau ("Pas de reseau") -- jamais deux a la
    // fois, et surtout jamais confondus : un refus serveur DEFINITIF retire la
    // tete de file (la rejouer buterait pour toujours sur le meme refus) ; une
    // panne reseau ou d'infrastructure NE LA RETIRE PAS (on rejouera). Le
    // libelle affiche est ce qui permet a l'utilisateur de distinguer les
    // deux : "il faut que je fasse autre chose" contre "il faut juste
    // attendre".
    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message

    // Variante COURTE du meme message, quand il en existe une (Api.reasonPair
    // en fournit une par motif). Le store ne choisit PAS : il publie les deux
    // et laisse l'ecran trancher, parce que lui seul connait la place
    // reellement disponible -- "Plus dans ce match" tient en entier sur un
    // grand cadran rond et pas du tout sur le carre 180 dp. Choisir ici
    // reviendrait a appauvrir le grand cadran pour sauver le petit ; choisir
    // la-bas ne coute qu'une mesure (voir fitLabel dans ui/Fit.kt).
    // Toujours ecrit et efface EN MEME TEMPS que _message : les deux ne
    // peuvent pas se desynchroniser, il n'y a qu'un seul chemin d'ecriture.
    private val _messageShort = MutableStateFlow<String?>(null)
    val messageShort: StateFlow<String?> = _messageShort

    // Passe a VRAI quand le telephone a delie la montre (token_revoked) :
    // MainActivity y renvoie l'ecran d'appairage. Sans ce chemin de retour,
    // fn_watch_link leve token_revoked pour toujours et l'app n'est plus bonne
    // qu'a reinstaller (meme raison que unpair() sur la Garmin).
    private val _unpaired = MutableStateFlow(false)
    val unpaired: StateFlow<Boolean> = _unpaired

    val pending: Int get() = queue.size()

    // ---- Envoi : un seul en vol a la fois ---------------------------------
    // Sans ce verrou, drain() etait lance par score(), par undo() ET par le
    // battement de 5 s -- donc precisement pendant qu'un envoi precedent
    // etait en vol. Deux coroutines lisaient la MEME tete de file et
    // l'envoyaient toutes les deux ; chacune retirait ensuite LA TETE
    // COURANTE, pas l'evenement qu'elle avait envoye. File [A,B] : drain#1
    // envoie A ; drain#2 envoie A aussi ; drain#1 recoit 200, retire A, envoie
    // B ; la reponse de A arrive a drain#2, qui retire B -- non acquitte, plus
    // en file, jamais applique. Un point disparu, sans un mot.
    // Second mode du meme defaut : deux evenements en vol peuvent atteindre le
    // serveur DANS LE DESORDRE (il numerote a l'insertion), et [point, point,
    // undo] applique dans le mauvais ordre credite la mauvaise equipe.
    // L'idempotence serveur protege des doublons, pas de l'ordre.
    private val sending = AtomicBoolean(false)
    // Un appui survenu PENDANT un envoi ne doit pas etre oublie jusqu'au
    // prochain battement : on note qu'il faudra repasser.
    private val sendAgain = AtomicBoolean(false)
    private val refreshing = AtomicBoolean(false)

    // Garde de reentrance de finalize() : un seul appel en vol a la fois.
    // fn_finalize_live_session_as (le RPC derriere Api.finalize) prend un
    // verrou de ligne et renvoie le MEME match_id de facon idempotente sur un
    // second appel -- deux "Oui" rapproches sur un lien lent sont donc deja
    // sans danger cote SERVEUR aujourd'hui. Mais cette garantie ne vit que
    // dans la RPC : rien ici ne l'exprime ni ne la verifie, et un futur
    // changement de fn_finalize_live_session_as pourrait la retirer sans que
    // ce fichier ne le sache. Le client ne doit pas dependre d'une invariante
    // qu'il ne peut pas voir se rompre -- meme principe que `sending`
    // ci-dessus pour drain(), en plus simple : pas de file a rejouer ici,
    // juste un second appel a refuser tant que le premier n'est pas revenu.
    private val finalizing = AtomicBoolean(false)

    // Numero d'ordre des requetes qui rapportent un etat de match. La reponse
    // d'une requete PARTIE AVANT une autre deja appliquee est ignoree : sur un
    // lien lent, un refresh parti avant un envoi pouvait atterrir apres lui et
    // faire RECULER le score a l'ecran.
    private val reqGen = AtomicLong(0)
    private var appliedGen = 0L

    // Chien de garde d'affichage : DEPUIS QUAND la meme tete de file echoue.
    // Au-dela de STALL_MS le libelle change pour dire que la file est bloquee
    // et non simplement en retard -- sans quoi une tete coincee figeait le
    // score affiche indefiniment, sans que rien a l'ecran n'indique qu'il
    // etait perime.
    //
    // Le seuil est du TEMPS, pas un nombre de tentatives : drain() est appele
    // par score() et undo() autant que par le battement, donc trois
    // tapotements en une seconde avec le lien coupe suffisaient a afficher le
    // mot alarmant "Bloque" -- alors qu'un hoquet Bluetooth de deux secondes
    // en plein echange n'est rien. "Bloque" doit vouloir dire ce qu'il dit.
    private var stallSeq = -1L
    private var stallSince = 0L

    // ---- Message : lisible avant d'etre efface ----------------------------
    // Quand le message a ete pose. Un accuse ("Point K&A") efface par le
    // rafraichissement suivant quelques millisecondes plus tard n'a jamais ete
    // lu : c'est la regle "aucun point ne s'ajoute en silence" annulee par un
    // effet de bord. Un message vit donc au moins MIN_MESSAGE_MS.
    private var msgAt = 0L
    private var msgGen = 0L

    private var ticker: Job? = null

    // Date de la derniere reponse serveur COMPRISE (voir applySession).
    // @Volatile : ecrit sur le scope du store, lu par le service depuis sa
    // propre boucle.
    @Volatile private var sessionAt = 0L

    private fun setMessage(text: String?, short: String? = null) {
        _message.value = text
        _messageShort.value = short
        msgAt = now()
        msgGen++
    }

    // Pose un refus/une panne dont le motif figure dans Api.reasonPair : le
    // libelle riche ET sa variante courte, d'un seul geste. `fallback` sert
    // quand le motif est inconnu de la table (aucune variante courte alors).
    private fun setReasonMessage(reason: String?, fallback: String) {
        val pair = Api.reasonPair(reason)
        setMessage(pair?.first ?: fallback, pair?.second)
    }

    // Efface l'accuse UNE FOIS QU'IL A PU ETRE LU, et seulement si la file est
    // vide : en mode points, la ligne du milieu est le SEUL endroit ou le score
    // du jeu en cours apparait (MatchScreen affiche `message ?: gameLabel`),
    // donc la laisser occupee par "Point K&A" jusqu'au prochain
    // rafraichissement cache le score. Si le temps de lecture n'est pas encore
    // ecoule, on programme l'effacement pile a la fin de la fenetre.
    private fun clearMessageWhenRead() {
        if (queue.size() > 0 || _message.value == null) return
        val remaining = MIN_MESSAGE_MS - (now() - msgAt)
        if (remaining <= 0) { _message.value = null; _messageShort.value = null; return }
        val gen = msgGen
        scope.launch {
            delay(remaining)
            // Un message plus recent est arrive entre-temps : ce n'est plus le
            // notre, on n'y touche pas.
            if (msgGen == gen && queue.size() == 0) {
                _message.value = null
                _messageShort.value = null
            }
        }
    }

    // Prend un Session NULLABLE a dessein : effacer le match est un ecrit
    // comme un autre, et il doit passer par le MEME numero d'ordre. La branche
    // has_session:false l'ecrivait directement et faisait en plus RECULER
    // appliedGen -- une reponse "pas de match" partie avant un envoi qui, lui,
    // avait deja rapporte un match en cours, atterrissait apres lui et vidait
    // l'ecran. Le symptome de I1, atteint par une autre porte.
    private fun applySession(s: Session?, gen: Long) {
        if (gen < appliedGen) return
        appliedGen = gen
        _session.value = s
        // Horodatage de la DERNIERE affirmation du serveur, pas de la derniere
        // TENTATIVE : seul ce chemin est atteint quand une reponse a ete lue et
        // comprise. Une requete qui part et n'aboutit pas ne rajeunit rien --
        // c'est exactement ce que sessionAgeMs doit pouvoir dire.
        sessionAt = now()
    }

    // Depuis combien de temps le serveur n'a-t-il pas confirme ce qu'on
    // affiche ? Lu par OngoingMatch, qui affiche le score a quelqu'un QUI
    // N'EST PAS DANS L'APPLICATION : sur l'ecran, un score fige est entoure du
    // message "Pas de reseau" et l'utilisateur voit qu'il regarde une photo ;
    // sur le cadran, la pastille est lue d'un coup d'oeil, sans aucun indice
    // qu'elle puisse dater. Passe un certain age, elle doit devenir plus
    // grossiere plutot que rester precise et fausse.
    // 0 tant que rien n'a jamais ete confirme : un age enorme au demarrage
    // ferait degrader le tout premier affichage sans raison.
    val sessionAgeMs: Long get() = if (sessionAt == 0L) 0L else now() - sessionAt

    // Le battement tourne-t-il ? OngoingMatch s'en sert pour ne PAS doubler
    // les requetes de l'activite quand elle est au premier plan : elle
    // interroge deja toutes les 5 s, le service n'a rien a ajouter.
    val isPolling: Boolean get() = ticker?.isActive == true

    // ---- Battement, cale sur le CYCLE DE VIE ------------------------------
    // Demarre par MainActivity.onStart, arrete par onStop : quand l'ecran
    // s'eteint on cesse d'interroger le serveur. Un envoi deja en vol, lui,
    // n'est pas annule -- il vit sur le scope du store, pas sur ce Job : un
    // point tape juste avant l'extinction part quand meme.
    // Le premier battement est IMMEDIAT (tick() avant le premier delay) : a
    // l'ouverture de l'ecran comme au retour d'un reappairage, on ne fait pas
    // attendre 5 s pour afficher le score.
    fun startPolling() {
        if (ticker?.isActive == true) return
        ticker = scope.launch {
            while (isActive) {
                tick()
                delay(tickMs)
            }
        }
    }

    fun stopPolling() {
        ticker?.cancel()
        ticker = null
    }

    // PUBLIQUE, et c'est le correctif : le service de premier plan doit pouvoir
    // provoquer un battement quand l'activite n'est plus au premier plan.
    // Sans cela, `session` ne pouvait plus changer du tout une fois l'ecran
    // quitte (seuls un battement ou unpair() la font bouger), donc le service
    // ne pouvait plus voir has_session:false, donc son stopSelf() etait
    // inatteignable : la pastille survivait au match pendant des heures.
    // On expose tick() et non refresh() pour garder UNE seule definition de ce
    // qu'est un battement -- vider la file d'abord, interroger ensuite --
    // plutot qu'une regle au premier plan et une autre en arriere-plan.
    fun tick() {
        if (prefs.token == null) return
        if (queue.size() > 0) drain() else refresh()
    }

    // Appele quand l'appairage vient de reussir : le store est un singleton de
    // processus, il doit oublier l'etat "deliee" de l'appairage precedent.
    //
    // Et il doit RELANCER LE BATTEMENT. unpair() l'arrete (le jeton est mort,
    // continuer a interroger le serveur n'a pas de sens), mais rien ne le
    // redemarrait : MainActivity ne le lance que depuis onStart(), qui ne
    // repasse pas -- se reappairer est une bascule d'etat Compose, pas un
    // redemarrage d'activite. L'ecran de match restait donc muet cote serveur
    // jusqu'a ce que l'utilisateur eteigne et rallume l'ecran, et cela pile
    // sur le chemin que unpair() existe pour ouvrir. Le premier battement
    // rafraichit immediatement (voir startPolling), donc il n'y a pas de
    // refresh() separe a faire ici : un seul chemin, pas deux.
    fun onPaired() {
        _unpaired.value = false
        setMessage(null)
        startPolling()
    }

    fun refresh() {
        val t = prefs.token ?: return
        // Un envoi en vol rapporte un etat PLUS FRAIS que celui-ci (il inclut
        // l'evenement qu'il vient d'appliquer) : inutile de courir contre lui.
        if (sending.get()) return
        // Sur un lien plus lent que le battement de 5 s, plusieurs
        // rafraichissements etaient en vol en meme temps et le dernier arrive
        // gagnait -- le score pouvait reculer a l'ecran. Un seul a la fois.
        if (!refreshing.compareAndSet(false, true)) return
        val gen = reqGen.incrementAndGet()
        scope.launch {
            try {
                val res = try {
                    fetchSession(t)
                } catch (e: Exception) {
                    if (e is CancellationException) throw e
                    // Montre reliee au telephone par Bluetooth : hors de portee
                    // ou telephone eteint est une panne ROUTINE, pas une
                    // exception a laisser remonter (cf. PairingScreen, qui a
                    // appris cela a ses depens ; on attrape Exception et non la
                    // seule IOException, car OkHttp remonte aussi des
                    // IllegalStateException/SocketException hors de cette
                    // famille). On la dit sans jamais effacer la derniere
                    // session connue : le score doit rester lisible pendant la
                    // coupure. Et si des evenements attendent, leur propre
                    // libelle ("En attente : N") dit deja la meme panne en
                    // disant EN PLUS combien de points sont en jeu : on ne
                    // l'ecrase pas.
                    if (queue.size() == 0) setMessage("Pas de reseau", "Hors ligne")
                    return@launch
                }
                val reason = Api.errorReason(res.body)
                if (res.status != 200) {
                    // Meme gate que dans drain() : le corps seul ne suffit pas
                    // a delier la montre (voir le commentaire la-bas).
                    if (reason == "token_revoked" && Api.isDefinitiveRefusal(res.status)) {
                        unpair(); return@launch
                    }
                    setReasonMessage(reason, "Hors ligne ${res.status}")
                    return@launch
                }
                val s = parseSession(res.body)
                when {
                    s != null -> {
                        applySession(s, gen)
                        clearMessageWhenRead()
                    }
                    // SEULE affirmation du serveur qui autorise a effacer le
                    // match affiche (voir serverSaysNoSession dans Session.kt).
                    serverSaysNoSession(res.body) -> applySession(null, gen)
                    // Corps illisible : on ne sait pas, donc on ne touche a
                    // rien. Annoncer "Aucun match en cours" en plein match sur
                    // une page HTML 502 du edge etait le pire des deux choix.
                    else -> if (queue.size() == 0) setMessage("Reponse illisible", "Illisible")
                }
            } finally {
                refreshing.set(false)
            }
        }
    }

    fun score(team: Int) {
        val s = _session.value ?: return
        if (!s.isScorer || s.finished) return
        val type = if (s.scoringMode == "points") "point_won" else "game_won"
        // enqueue() genere le client_seq ET stocke l'evenement en un seul
        // appel atomique (voir le commentaire d'enqueue() dans Queue.kt) :
        // jamais nextSeq() puis push() separement, ce qui laisserait un
        // point disparaitre pour de bon si le process meurt entre les deux.
        queue.enqueue(s.sessionId, type, team)
        // Accuse de reception IMMEDIAT, avant tout aller-retour reseau : en
        // mode avion l'envoi peut prendre des minutes a aboutir, mais aucun
        // point ne doit jamais s'ajouter en silence (regle de cet ecran).
        // "Point " + jusqu'a 8 signes = 14 signes, soit ~145 px : plus que les
        // ~128 px que la rangee du milieu laisse sur le carre 180 dp, ou
        // l'accuse le PLUS FREQUENT de l'application devenait "Point Moh...".
        // La variante courte remplace le mot par le signe "+", qui dit la meme
        // chose (un point vient d'etre ajoute) en quatre signes de moins, et
        // garde entiere la seule partie variable : l'equipe creditee.
        val who = shortOf(s, team)
        setMessage("Point $who", "+ $who")
        drain()
    }

    fun undo() {
        val s = _session.value ?: return
        if (!s.isScorer || s.finished) return
        queue.enqueue(s.sessionId, "undo", 0)
        setMessage("Annulation", "Annule")
        drain()
    }

    private fun shortOf(s: Session, team: Int): String =
        (if (team == 1) s.team1Short else s.team2Short).take(8)

    // Valide le score final. Action IRREVERSIBLE, appelee une seule fois par
    // pression sur "Oui" (ConfirmScreen porte sa propre garde `busy`) -- donc
    // pas de file, pas de retard tolere : on attend la reponse et on la
    // qualifie pour l'ecran, qui doit pouvoir dire a l'utilisateur laquelle
    // des trois choses vient de se passer (voir FinalizeResult).
    //
    // MEME GATE QUE drain()/refresh() : le corps seul ne dit jamais si un
    // "message" est un refus metier ou une panne d'infrastructure, seul le
    // statut HTTP le fait (voir isDefinitiveRefusal, Api.kt). Le brouillon
    // initial de cette methode lisait errorReason(body) seul et traitait tout
    // "message" non nul comme un refus -- un 500 "statement timeout" ou un
    // 401 "JWT expired" pendant la finalisation se serait donc affiche
    // exactement comme "Pas de vainqueur", et l'utilisateur aurait cru son
    // score REJETE SUR LE FOND alors que le serveur n'a rien tranche du tout.
    fun finalize(onDone: (FinalizeResult) -> Unit) {
        // Voir le commentaire de `finalizing` : garde purement CLIENT, la
        // dependance au serveur n'est pas ecrite ailleurs que dans ce
        // commentaire-la. Posee AVANT tout return anticipe (jeton/session
        // absents) : ces chemins-la aussi doivent liberer la garde, sinon un
        // premier appel sans jeton bloquerait tous les suivants pour de bon.
        if (!finalizing.compareAndSet(false, true)) return
        val t = prefs.token
        if (t == null) {
            finalizing.set(false)
            return onDone(FinalizeResult.Refused(Api.reasonPair("token_revoked")?.first ?: "Montre deliee"))
        }
        val s = _session.value
        if (s == null) {
            finalizing.set(false)
            return onDone(FinalizeResult.Refused("Aucun match"))
        }
        scope.launch {
            try {
                val res = try {
                    finalizeSession(t, s.sessionId)
                } catch (e: Exception) {
                    if (e is CancellationException) throw e
                    // Panne reseau (Bluetooth hors de portee, telephone
                    // eteint) : le score n'a pas ete juge, seulement pas
                    // envoye.
                    onDone(FinalizeResult.Unreachable("Pas de reseau"))
                    return@launch
                }

                if (res.status == 200) {
                    // Le match vient de sortir de l'etat "live" cote serveur :
                    // watch_current_session ne le renverra plus au prochain
                    // refresh (voir le commentaire de tete de cette methode et
                    // sessionLostText dans ConfirmScreen.kt). On ne laisse PAS
                    // le seul battement de 5 s s'en charger : sans ce refresh
                    // immediat, MatchScreen ré-affichait le match DECIDE mis
                    // en cache (donc son bouton "OK" toujours actif) pendant
                    // jusqu'a 5 s apres un "Oui" reussi, invitant a une
                    // seconde confirmation confuse d'un score deja valide.
                    refresh()
                    onDone(FinalizeResult.Success)
                    return@launch
                }

                val reason = Api.errorReason(res.body)
                // Meme raison que dans drain() : un refus "token_revoked" ne
                // deliee la montre que sur un statut de refus definitif,
                // jamais sur une panne d'infrastructure qui porterait le
                // meme mot par coincidence.
                if (reason == "token_revoked" && Api.isDefinitiveRefusal(res.status)) {
                    unpair()
                    onDone(FinalizeResult.Refused(Api.reasonPair(reason)?.first ?: "Montre deliee"))
                    return@launch
                }

                if (Api.isDefinitiveRefusal(res.status)) {
                    // Refus METIER definitif (no_winner, not_enough_sets,
                    // not_the_scorer...) : le serveur a tranche, rejouer
                    // buterait pour toujours sur le meme refus.
                    onDone(FinalizeResult.Refused(Api.reasonPair(reason)?.first ?: reason ?: "Refuse ${res.status}"))
                    return@launch
                }

                // TOUT LE RESTE est de l'infrastructure (5xx, 401, 404
                // pendant un rechargement de cache PostgREST...) : le score
                // n'a pas ete juge, "Oui" reste une action valide a
                // retenter.
                onDone(FinalizeResult.Unreachable(Api.reasonPair(reason)?.first ?: "Hors ligne ${res.status}"))
            } finally {
                finalizing.set(false)
            }
        }
    }

    // Vide la file en respectant l'ordre, UN envoi a la fois. Ne retire un
    // evenement QUE sur un acquittement (200) ou un refus metier definitif
    // (400/403/409), et JAMAIS un evenement autre que celui qu'elle vient
    // d'envoyer.
    fun drain() {
        if (prefs.token == null) return
        if (!sending.compareAndSet(false, true)) {
            // Un envoi est deja en vol : on ne double pas la requete, on note
            // qu'il faudra repasser des qu'il sera fini.
            sendAgain.set(true)
            return
        }
        scope.launch {
            var progressed = false
            try {
                progressed = drainLoop()
            } finally {
                sending.set(false)
            }
            // On ne repasse que si le tour precedent a AVANCE : sinon c'est le
            // reseau ou le serveur qui bloque, et reessayer aussitot en boucle
            // ne ferait que vider la batterie -- le battement de 5 s s'en
            // charge.
            if (sendAgain.getAndSet(false) && progressed && queue.head() != null) {
                drain()
            } else if (!progressed && isStalled()) {
                // File bloquee : le battement n'appelle que drain() tant qu'il
                // reste des evenements, donc plus rien ne rafraichirait le
                // score. On va le chercher quand meme, pour que l'ecran ne soit
                // pas fige en plus d'etre en retard.
                refresh()
            }
        }
    }

    // Renvoie VRAI si au moins un evenement a quitte la file pendant ce tour.
    private suspend fun drainLoop(): Boolean {
        val t = prefs.token ?: return false
        var progressed = false
        while (true) {
            val h = queue.head() ?: break
            val sent = h.seq
            val gen = reqGen.incrementAndGet()
            val res = try {
                sendEvent(t, h)
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                // Panne reseau, pas un refus : rien n'est perdu, seulement
                // retarde. On ne retire RIEN et on dit combien attendent.
                noteStall(sent)
                break
            }

            // REPONSE ORPHELINE : la tete de file n'est plus celle qu'on a
            // envoyee (unpair() a vide la file, un autre chemin l'a modifiee).
            // Ne RIEN retirer, sinon on jette un evenement jamais acquitte --
            // c'est le pop aveugle "retire la tete courante" qui faisait
            // disparaitre un point. Meme garde que la Garmin (SessionView.mc,
            // onSent).
            val head = queue.head()
            if (head == null || head.seq != sent) break

            if (res.status == 200) {
                queue.popHead()
                progressed = true
                clearStall()
                // Le corps du 200 porte l'etat du match ; illisible, il ne
                // remet PAS la session a null (meme raison que dans refresh()),
                // et l'evenement reste acquitte : il a bien ete applique.
                parseSession(res.body)?.let { applySession(it, gen) }
                clearMessageWhenRead()
                continue
            }

            val reason = Api.errorReason(res.body)
            // Lien revoque depuis le telephone : le jeton ne vaut plus rien.
            // GATE SUR LE STATUT, comme tout le reste de cette boucle. La
            // Garmin decide sur le seul corps (SessionView.mc:441) et c'est
            // precisement le mode de panne que ce commit ferme partout
            // ailleurs : un corps d'infrastructure porteur d'un "message" est
            // indistinguable d'un refus metier. Ici la sanction est la pire de
            // toutes -- unpair() VIDE LA FILE -- donc un 500 portant
            // "token_revoked" effacerait tout le retard accumule d'un coup.
            // fn_watch_link (supabase/migrations/watch_rpcs.sql:20) fait un
            // RAISE EXCEPTION nu, sans ERRCODE : SQLSTATE P0001, que PostgREST
            // rend en 400. Le vrai token_revoked passe donc toujours ce gate ;
            // s'il arrivait un jour sur un autre statut, on le rejouerait au
            // lieu de delier -- on garderait les points, l'ecran dirait
            // "Bloque : N", et c'est le bon sens de l'echec.
            if (reason == "token_revoked" && Api.isDefinitiveRefusal(res.status)) {
                unpair()
                return progressed
            }

            if (Api.isDefinitiveRefusal(res.status)) {
                // Refus METIER definitif : le rejouer buterait pour toujours
                // sur le meme refus.
                queue.popHead()
                progressed = true
                clearStall()
                setReasonMessage(reason, "Refuse ${res.status}")
                continue
            }

            // TOUT LE RESTE est de l'infrastructure et le rejeu marchera : un
            // 500 "canceling statement due to statement timeout", un 401 "JWT
            // expired", un 404 pendant un rechargement du cache de schema
            // PostgREST. Les jeter parce que leur corps contient un "message"
            // effacait de vrais points -- et, avec le `continue` d'alors, la
            // file ENTIERE en une seule passe.
            noteStall(sent)
            break
        }
        return progressed
    }

    private fun noteStall(seq: Long) {
        // Nouvelle tete : le chronometre repart de zero. C'est bien la duree
        // de blocage DE CET EVENEMENT-LA qu'on mesure.
        if (seq != stallSeq) { stallSeq = seq; stallSince = now() }
        val n = queue.size()
        if (isStalled()) setMessage("Bloque : $n", "Bloque $n")
        else setMessage("En attente : $n", "Attente $n")
    }

    private fun isStalled(): Boolean =
        stallSeq != -1L && now() - stallSince >= STALL_MS

    private fun clearStall() {
        stallSeq = -1L
        stallSince = 0L
    }

    // Retour a l'ecran d'appairage. SEUL chemin de retour apres un
    // "Delier ma montre" depuis le telephone : sans lui, fn_watch_link leve
    // token_revoked pour toujours et l'app est bonne a reinstaller. La file est
    // videe : ses evenements visent une session que cette montre n'a plus le
    // droit de toucher. Le battement s'arrete aussi, sinon il continuerait a
    // interroger le serveur avec un jeton mort.
    private fun unpair() {
        prefs.token = null
        queue.clear()
        clearStall()
        stopPolling()
        _session.value = null
        setReasonMessage("token_revoked", "Montre deliee")
        _unpaired.value = true
    }

    companion object {
        const val TICK_MS = 5000L
        // 15 s sans qu'une seule tete de file passe : la meme duree que le
        // chien de garde de la Garmin (SessionView.mc, onTick : 3 ticks de
        // 5 s), mais mesuree en temps et non en tentatives.
        const val STALL_MS = 15_000L
        const val MIN_MESSAGE_MS = 2000L

        @Volatile private var instance: MatchStore? = null

        // UNE instance par processus. Voir le commentaire de classe : une
        // seconde MatchStore, c'est une seconde Queue sur le meme
        // SharedPreferences, et la mesure de Queue.kt dit ce que cela coute.
        fun get(prefs: TokenStore): MatchStore =
            instance ?: synchronized(this) {
                instance ?: MatchStore(prefs).also { instance = it }
            }
    }
}
