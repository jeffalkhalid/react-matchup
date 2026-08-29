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
    private val now: () -> Long = { System.currentTimeMillis() },
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

    // Numero d'ordre des requetes qui rapportent un etat de match. La reponse
    // d'une requete PARTIE AVANT une autre deja appliquee est ignoree : sur un
    // lien lent, un refresh parti avant un envoi pouvait atterrir apres lui et
    // faire RECULER le score a l'ecran.
    private val reqGen = AtomicLong(0)
    private var appliedGen = 0L

    // Chien de garde d'affichage : combien de tentatives d'affilee ont echoue
    // sur LA MEME tete de file. Au-dela de STALL_ATTEMPTS le libelle change
    // pour dire que la file est bloquee et non simplement en retard -- sans
    // quoi une tete coincee figeait le score affiche indefiniment, sans que
    // rien a l'ecran n'indique qu'il etait perime.
    private var stallSeq = -1L
    private var stallCount = 0

    // ---- Message : lisible avant d'etre efface ----------------------------
    // Quand le message a ete pose. Un accuse ("Point K&A") efface par le
    // rafraichissement suivant quelques millisecondes plus tard n'a jamais ete
    // lu : c'est la regle "aucun point ne s'ajoute en silence" annulee par un
    // effet de bord. Un message vit donc au moins MIN_MESSAGE_MS.
    private var msgAt = 0L
    private var msgGen = 0L

    private var ticker: Job? = null

    private fun setMessage(text: String?) {
        _message.value = text
        msgAt = now()
        msgGen++
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
        if (remaining <= 0) { _message.value = null; return }
        val gen = msgGen
        scope.launch {
            delay(remaining)
            // Un message plus recent est arrive entre-temps : ce n'est plus le
            // notre, on n'y touche pas.
            if (msgGen == gen && queue.size() == 0) _message.value = null
        }
    }

    private fun applySession(s: Session, gen: Long) {
        if (gen < appliedGen) return
        appliedGen = gen
        _session.value = s
    }

    // ---- Battement, cale sur le CYCLE DE VIE ------------------------------
    // Demarre par MainActivity.onStart, arrete par onStop : quand l'ecran
    // s'eteint on cesse d'interroger le serveur. Un envoi deja en vol, lui,
    // n'est pas annule -- il vit sur le scope du store, pas sur ce Job : un
    // point tape juste avant l'extinction part quand meme.
    fun startPolling() {
        if (ticker?.isActive == true) return
        ticker = scope.launch {
            while (isActive) {
                tick()
                delay(TICK_MS)
            }
        }
    }

    fun stopPolling() {
        ticker?.cancel()
        ticker = null
    }

    private fun tick() {
        if (prefs.token == null) return
        if (queue.size() > 0) drain() else refresh()
    }

    // Appele quand l'appairage vient de reussir : le store est un singleton de
    // processus, il doit oublier l'etat "deliee" de l'appairage precedent.
    fun onPaired() {
        _unpaired.value = false
        setMessage(null)
        refresh()
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
                    if (queue.size() == 0) setMessage("Pas de reseau")
                    return@launch
                }
                val reason = Api.errorReason(res.body)
                if (res.status != 200) {
                    if (reason == "token_revoked") { unpair(); return@launch }
                    setMessage(Api.reasonPair(reason)?.first ?: "Hors ligne ${res.status}")
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
                    serverSaysNoSession(res.body) -> {
                        appliedGen = gen
                        _session.value = null
                    }
                    // Corps illisible : on ne sait pas, donc on ne touche a
                    // rien. Annoncer "Aucun match en cours" en plein match sur
                    // une page HTML 502 du edge etait le pire des deux choix.
                    else -> if (queue.size() == 0) setMessage("Reponse illisible")
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
        setMessage("Point ${shortOf(s, team)}")
        drain()
    }

    fun undo() {
        val s = _session.value ?: return
        if (!s.isScorer || s.finished) return
        queue.enqueue(s.sessionId, "undo", 0)
        setMessage("Annulation")
        drain()
    }

    private fun shortOf(s: Session, team: Int): String =
        (if (team == 1) s.team1Short else s.team2Short).take(8)

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
            } else if (!progressed && stallCount >= STALL_ATTEMPTS) {
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
            if (reason == "token_revoked") { unpair(); return progressed }

            if (Api.isDefinitiveRefusal(res.status)) {
                // Refus METIER definitif : le rejouer buterait pour toujours
                // sur le meme refus.
                queue.popHead()
                progressed = true
                clearStall()
                setMessage(Api.reasonPair(reason)?.first ?: "Refuse ${res.status}")
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
        if (seq != stallSeq) { stallSeq = seq; stallCount = 0 }
        stallCount++
        val n = queue.size()
        setMessage(if (stallCount >= STALL_ATTEMPTS) "Bloque : $n" else "En attente : $n")
    }

    private fun clearStall() {
        stallSeq = -1L
        stallCount = 0
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
        setMessage(Api.reasonPair("token_revoked")?.first ?: "Montre deliee")
        _unpaired.value = true
    }

    companion object {
        const val TICK_MS = 5000L
        // Trois tentatives d'affilee sans progres, soit ~15 s au rythme du
        // battement : meme seuil que le chien de garde de la Garmin
        // (SessionView.mc, onTick).
        const val STALL_ATTEMPTS = 3
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
