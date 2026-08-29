package com.pagmatch.wear

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.io.IOException

// Un appui est enregistre dans la file (Queue.enqueue, ATOMIQUE) avant d'etre
// envoye. drain() la vide en respectant l'ordre ; un evenement non acquitte
// reste en tete et sera rejoue, ce que l'idempotence serveur (client_seq)
// rend sur.
//
// UNE SEULE instance de Queue doit exister pour toute la duree de vie de
// l'ecran de match, partagee entre le thread UI (score()/undo(), appeles
// depuis les tapotements) et la boucle d'envoi (drain()) : c'est CETTE
// instance, construite ICI UNE SEULE FOIS. Voir le commentaire d'enqueue()
// dans Queue.kt : 8 threads, chacun avec SA PROPRE Queue sur le meme store,
// ont perdu entre 265 et 280 evenements sur 320 -- le verrou interne de
// Queue ne protege que les appels faits SUR LA MEME instance. C'est pourquoi
// MatchStore lui-meme doit etre cree UNE SEULE fois (dans MainActivity, via
// `remember`), jamais recree a chaque recomposition ou a chaque appel
// d'ecran : une seconde instance ouvrirait une seconde Queue sur le meme
// store, exactement le scenario mesure.
class MatchStore(private val prefs: Prefs) {
    private val queue = Queue(prefs)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    private val _session = MutableStateFlow<Session?>(null)
    val session: StateFlow<Session?> = _session

    // Message court affiche sous les deux moities. Porte aussi bien l'accuse
    // de reception d'un point ("Point K&A") qu'un refus serveur ("Plus le
    // scoreur") qu'une panne reseau ("Pas de reseau") -- jamais deux a la
    // fois, et surtout jamais confondus : un refus serveur est DEFINITIF (la
    // tete de file est retiree, la rejouer boucderait pour toujours sur le
    // meme refus): une panne reseau NE L'EST PAS (la tete de file reste, on
    // rejouera des que le reseau revient). Le libelle affiche a l'ecran est
    // ce qui permet a l'utilisateur de distinguer les deux : "il faut que je
    // fasse autre chose" contre "il faut juste attendre".
    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message

    val pending: Int get() = queue.size()

    fun refresh() {
        val t = prefs.token ?: return
        scope.launch {
            val body = try {
                Api.currentSession(t)
            } catch (e: IOException) {
                // Montre reliee au telephone par Bluetooth : hors de portee ou
                // telephone eteint est une panne ROUTINE, pas une exception a
                // laisser remonter (cf. PairingScreen, qui a appris ça a ses
                // depens). On la dit sans jamais effacer la derniere session
                // connue : le score doit rester lisible pendant la coupure.
                _message.value = "Pas de reseau"
                return@launch
            }
            val reason = Api.errorReason(body)
            if (reason != null) {
                _message.value = Api.reasonPair(reason)?.first ?: reason
            } else {
                val s = parseSession(body)
                _session.value = s
                if (s != null) _message.value = null
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
        _message.value = "Point ${shortOf(s, team)}"
        drain()
    }

    fun undo() {
        val s = _session.value ?: return
        if (!s.isScorer || s.finished) return
        queue.enqueue(s.sessionId, "undo", 0)
        _message.value = "Annulation"
        drain()
    }

    private fun shortOf(s: Session, team: Int): String =
        (if (team == 1) s.team1Short else s.team2Short).take(8)

    // Vide la file en respectant l'ordre. S'arrete SANS RIEN RETIRER sur la
    // premiere panne reseau : l'evenement en tete reste, il sera rejoue au
    // prochain drain() (appel explicite ou refresh periodique). Un refus
    // metier, lui, est retire -- voir le commentaire sur _message plus haut.
    fun drain() {
        val t = prefs.token ?: return
        scope.launch {
            while (true) {
                val h = queue.head() ?: break
                val body = try {
                    Api.applyEvent(t, h.sid, h.type, h.team, h.seq)
                } catch (e: IOException) {
                    // Panne reseau, pas un refus : rien n'est perdu, seulement
                    // retarde. On dit combien reste en file pour que l'appui
                    // suivant en mode avion (le point n'est jamais perdu, mais
                    // l'utilisateur doit savoir qu'il s'accumule) ne soit pas
                    // pris pour un ecran fige.
                    _message.value = "En attente : ${queue.size()}"
                    break
                }
                val reason = Api.errorReason(body)
                if (reason != null) {
                    // Refus METIER, definitif : le rejouer boucderait pour
                    // toujours sur le meme refus, contrairement a une panne
                    // reseau (voir le catch ci-dessus).
                    _message.value = Api.reasonPair(reason)?.first ?: reason
                    queue.popHead()
                    continue
                }
                val s = parseSession(body)
                if (s == null) break // reponse illisible : on rejouera plus tard
                _session.value = s
                queue.popHead()
            }
        }
    }
}
