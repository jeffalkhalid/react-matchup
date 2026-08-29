package com.pagmatch.wear

import android.util.Log
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

// CONTRAT OBLIGATOIRE pour toute implementation : putString() doit avoir
// persiste de maniere DURABLE avant de retourner (ecriture synchrone). Tout
// le raisonnement d'atomicite de Queue (voir enqueue()) suppose que (a) un
// appel putString() qui est retourne a bien atteint le stockage, et (b) deux
// appels successifs sont appliques dans l'ordre ou ils ont ete emis. Une
// implementation SharedPreferences DOIT utiliser commit(), jamais apply() :
// apply() est asynchrone et peut appliquer les deux ecritures dans le
// desordre, ou perdre l'une des deux sans jamais l'appliquer -- ce qui
// aggrave largement les fenetres de perte que ce fichier existe pour fermer.
interface KeyValueStore {
    fun getString(k: String): String?
    fun putString(k: String, v: String)
}

@Serializable
data class Pending(val sid: String, val type: String, val team: Int, val seq: Long)

// File d'envoi persistante : un appui est enregistre ICI d'abord, envoye
// ensuite. Tant qu'un envoi n'a pas ete acquitte, l'evenement reste en tete et
// sera rejoue — c'est l'idempotence cote serveur (client_seq) qui rend ce
// rejeu sur.
class Queue(private val store: KeyValueStore) {

    private val json = Json { ignoreUnknownKeys = true }

    // Verrou d'exclusion mutuelle entre les operations de CETTE instance de
    // Queue. Chaque methode publique est un cycle lecture-modification-
    // ecriture (items() puis save(), ou lecture de queue_seq puis ecriture) :
    // sans verrou, un enqueue() sur le thread UI et un popHead() sur la
    // coroutine d'envoi peuvent s'entrelacer, et le second a ecrire
    // queue_items ecrase entierement le travail du premier -- perte
    // silencieuse d'un evenement, "dernier ecrivain gagne", sans qu'aucun
    // kill de process ne soit implique.
    //
    // Ce que ce verrou GARANTIT : les appels a push()/nextSeq()/enqueue()/
    // popHead()/clear() sur CETTE instance, depuis des threads DIFFERENTS du
    // MEME process, s'executent un a la fois et voient un etat coherent.
    //
    // Ce que ce verrou NE GARANTIT PAS : il ne rend PAS le store sous-jacent
    // atomique. Il ne protege ni contre un kill du process au milieu d'un
    // appel (tout le raisonnement d'ordre d'ecriture documente plus bas reste
    // necessaire), ni contre un acces au store en dehors de Queue.
    //
    // Il ne protege SURTOUT PAS contre deux instances de Queue distinctes qui
    // enveloppent le meme store : chaque instance a son PROPRE lock (voir
    // ci-dessous), donc ce verrou n'offre alors aucune exclusion mutuelle
    // entre elles -- exactement comme s'il n'existait pas. C'est pourquoi UNE
    // SEULE instance de Queue doit servir a la fois le thread UI et la
    // coroutine d'envoi ; ce n'est pas une preference de style, c'est ce qui
    // fait fonctionner ce verrou. Mesure : 8 threads, chacun avec SA PROPRE
    // instance de Queue sur le meme store, 40 enqueue() chacun (320 au
    // total) -> entre 265 et 280 evenements perdus sur 320 selon
    // l'execution (3 mesures locales : 40, 55 et 41 evenements survivants).
    // Cette contrainte ne peut PAS etre verifiee par un test deterministe :
    // la perte depend de l'entrelacement reel des threads (voir la
    // variance ci-dessus), donc tout seuil fixe dans une assertion serait
    // capricieux -- un test qui pourrait passer par chance sur une
    // machine/CI qui serialise serait pire qu'aucun test. Elle est donc
    // documentee ici en toutes lettres plutot que testee.
    private val lock = Any()

    fun items(): List<Pending> = synchronized(lock) {
        val raw = store.getString(KEY_ITEMS) ?: return@synchronized emptyList()
        try {
            json.decodeFromString(raw)
        } catch (e: Exception) {
            // Fail-open est voulu : mieux vaut une file vide qu'un crash. Mais
            // une file corrompue qui disparait sans un mot peut faire perdre
            // un rally entier sans que personne ne le sache jamais -- on logge
            // donc avant de retomber sur emptyList().
            //
            // Ce catch est aussi, comme popHead()/clear(), un point ou de
            // l'evidence de seq est detruite : les items corrompus emportent
            // avec eux le plus grand seq qu'ils contenaient, et ce chemin ne
            // peut PAS le recuperer (le JSON est illisible par construction).
            // Le filet de securite contre la reutilisation ne repose donc plus
            // ici que sur queue_seq -- lui-meme tenu a jour par popHead(),
            // clear() et enqueue()/nextSeq(). Le seul cas non ferme reste la
            // combinaison de deux pannes independantes (un kill entre les deux
            // ecritures de enqueue(), suivi d'une corruption avant la moindre
            // lecture reussie qui aurait pu rattraper queue_seq) : aucun
            // ordonnancement d'ecritures sur ce store ne peut garantir contre
            // ça, donc on ne pretend pas le faire ici.
            safeLog("File d'envoi corrompue, reinitialisee a vide (fail-open)", e)
            emptyList()
        }
    }

    private fun save(a: List<Pending>) {
        store.putString(KEY_ITEMS, json.encodeToString(a))
    }

    // android.util.Log n'est pas mocke dans les tests unitaires JVM (pas de
    // runtime Android) et leve ; on avale cette erreur-la specifiquement pour
    // ne pas casser les tests qui exercent les chemins qui journalisent.
    private fun safeLog(message: String, e: Throwable? = null) {
        try {
            if (e != null) Log.e(TAG, message, e) else Log.e(TAG, message)
        } catch (loggingUnavailable: Throwable) {
            // Pas de runtime Android (tests JVM) : rien a faire.
        }
    }

    // Plancher partage par nextSeq() et enqueue() : le prochain seq n'est
    // JAMAIS lu depuis queue_seq seul. C'est le coeur de la defense contre la
    // reutilisation, donc lisez ce commentaire avant de le modifier.
    //
    // Le store n'ecrit qu'une cle a la fois : il n'y a pas de vraie
    // transaction a deux cles. enqueue() choisit donc un ORDRE d'ecriture
    // (l'evenement dans queue_items D'ABORD, le compteur queue_seq ENSUITE)
    // pour qu'un kill entre les deux laisse l'evenement deja dans la file --
    // recuperable, rejoue normalement -- plutot que perdu (l'inverse, qui
    // ecrirait le compteur en premier, est precisement le trou d'origine :
    // seq consomme, evenement jamais ecrit, ni envoye ni recuperable).
    //
    // Mais cet ordre a lui seul NE SUFFIT PAS et ne suffira jamais avec ce
    // genre de store : si le kill survient juste apres l'ecriture de
    // l'evenement mais avant celle du compteur, queue_seq reste en retard
    // d'un cran. Tant que l'evenement reste dans la file, ce retard est
    // inoffensif car ce plancher regarde aussi le contenu de la file
    // (maxOfOrNull { it.seq }) -- mais popHead() et clear() RETIRENT cette
    // evidence de la file. Sans precaution, purger un evenement dont le seq
    // n'a jamais ete reporte sur queue_seq efface la seule trace qui empechait
    // sa reutilisation : un enqueue() ulterieur recalculerait le MEME numero
    // pour un evenement DIFFERENT, et le serveur, qui deduplique sur
    // (session_id, watch_link_id, client_seq), rejetterait a tort ce nouvel
    // evenement comme un doublon de l'ancien deja acquitte -- un point
    // different disparaitrait en silence en plein match. (Scenario verifie :
    // enqueue(A) seq1 ; enqueue(B) seq2 puis kill avant l'ecriture du
    // compteur ; redemarrage, A et B sont envoyes et popHead() les retire
    // tous les deux ; un enqueue(C) naif retomberait alors sur seq2.)
    //
    // C'est pourquoi popHead() et clear() reportent le seq de ce qu'ils
    // s'appretent a retirer sur queue_seq AVANT de le retirer : l'evidence est
    // sauvegardee avant d'etre detruite, pas apres. Avec ca, ce plancher tient
    // dans la duree : au pire queue_seq reste brievement en retard d'un
    // enqueue() (fenetre qui n'a jamais cause de perte ni de reutilisation
    // tant que rien n'a encore ete purge), jamais durablement.
    //
    // La seule breche non fermee par ce fichier : si la file se corrompt
    // (voir items()) exactement pendant cette fenetre de retard, avant tout
    // popHead()/clear()/lecture reussie qui l'aurait rattrapee, l'evidence du
    // seq de l'evenement en cours est perdue avec le JSON illisible. Deux
    // pannes independantes doivent se produire pour ça ; aucun ordre
    // d'ecriture sur un store a une cle a la fois ne peut s'en proteger, donc
    // on ne le pretend pas.
    private fun nextSeqGiven(existing: List<Pending>): Long {
        val persistedSeq = (store.getString(KEY_SEQ)?.toLongOrNull() ?: 0L).coerceAtLeast(0L)
        val maxQueuedSeq = existing.maxOfOrNull { it.seq.coerceAtLeast(0L) } ?: 0L
        val floor = maxOf(persistedSeq, maxQueuedSeq)
        // Garde contre le DEBORDEMENT ARITHMETIQUE, PAS contre la perte de
        // points. Si un seq stocke atteint deja Long.MAX_VALUE (donnee
        // corrompue ou de test), floor + 1 deborderait silencieusement sur
        // Long.MIN_VALUE -- un client_seq negatif, encore pire a
        // diagnostiquer. On sature donc a Long.MAX_VALUE au lieu de deborder.
        //
        // Mais saturer n'evite PAS la perte : une fois ce plafond atteint,
        // TOUT appel suivant -- y compris apres un clear(), qui avance aussi
        // le plancher jusqu'a MAX_VALUE -- renvoie de nouveau Long.MAX_VALUE,
        // pour toujours. Chaque nouvel evenement entre alors en collision
        // avec le precedent et disparait en silence cote serveur : un etat
        // permanent, total, dont rien dans ce fichier ne peut sortir.
        // Inatteignable en pratique (il faudrait des quintillions de points),
        // mais on journalise bruyamment des qu'on l'atteint pour que l'etat
        // soit au moins diagnosticable si ça arrive jamais.
        val next = if (floor == Long.MAX_VALUE) Long.MAX_VALUE else floor + 1L
        if (next == Long.MAX_VALUE) {
            safeLog("Plafond de client_seq atteint (Long.MAX_VALUE) : tout nouvel evenement va desormais entrer en collision avec le precedent et etre perdu en silence cote serveur. Etat permanent, non recuperable.")
        }
        return next
    }

    // Avance queue_seq au moins jusqu'a `atLeast`, jamais en arriere. Utilise
    // par popHead()/clear() pour reporter l'evidence d'un seq sur le point
    // d'etre retire de la file, AVANT de le retirer (voir nextSeqGiven()).
    // Helper prive, toujours appele depuis une methode publique deja
    // synchronized(lock) -- pas besoin de son propre verrou.
    private fun advanceSeqFloor(atLeast: Long) {
        val current = (store.getString(KEY_SEQ)?.toLongOrNull() ?: 0L).coerceAtLeast(0L)
        if (atLeast > current) {
            store.putString(KEY_SEQ, atLeast.toString())
        }
    }

    // client_seq monotone, JAMAIS reutilise : c'est la cle d'idempotence.
    // Passe par le meme plancher que enqueue() (voir nextSeqGiven()) : un
    // push(seq = N) suivi d'un nextSeq() ne doit jamais renvoyer N, meme si
    // rien n'a encore ete ecrit dans queue_seq pour ce N.
    fun nextSeq(): Long = synchronized(lock) {
        val s = nextSeqGiven(items())
        store.putString(KEY_SEQ, s.toString())
        s
    }

    // Primitif bas niveau : stocke un evenement au seq DEJA DECIDE par
    // l'appelant. N'avance pas queue_seq lui-meme -- ce n'est pas necessaire
    // pour rester sur : nextSeq()/enqueue() relisent toujours la file
    // (nextSeqGiven) et voient donc ce que push() vient d'y deposer.
    fun push(sessionId: String, eventType: String, team: Int, seq: Long) = synchronized(lock) {
        save(items() + Pending(sessionId, eventType, team, seq))
    }

    // Chemin atomique : genere le client_seq ET stocke l'evenement en une
    // seule operation. nextSeq() + push() a la suite laisse un trou : si le
    // process meurt entre les deux appels, le numero de sequence est
    // consomme mais l'evenement n'a jamais ete ecrit -- ni envoye, ni
    // recuperable. C'est le seul point que cette classe existe pour
    // empecher, donc TOUT appelant doit passer par enqueue(), jamais par la
    // paire nextSeq()+push(). Ne "simplifiez" pas ceci en deux appels.
    //
    // Le raisonnement complet sur l'ordre des deux ecritures et sur la
    // reutilisation de seq est documente au-dessus de nextSeqGiven() : lisez
    // ce commentaire-la avant de toucher a celui-ci.
    fun enqueue(sessionId: String, eventType: String, team: Int): Long = synchronized(lock) {
        val existing = items()
        val seq = nextSeqGiven(existing)

        save(existing + Pending(sessionId, eventType, team, seq)) // 1) evenement
        store.putString(KEY_SEQ, seq.toString())                   // 2) compteur

        seq
    }

    fun head(): Pending? = synchronized(lock) { items().firstOrNull() }

    fun popHead() = synchronized(lock) {
        val a = items()
        if (a.isEmpty()) return@synchronized
        // Cet evenement va disparaitre de la file : on fixe son seq dans le
        // compteur persiste AVANT de le retirer, sinon enqueue()/nextSeq()
        // perdent leur seule trace de ce numero une fois la file videe (voir
        // nextSeqGiven()).
        advanceSeqFloor(a.first().seq)
        save(a.drop(1))
    }

    fun size(): Int = synchronized(lock) { items().size }

    fun clear() = synchronized(lock) {
        // Meme raisonnement que popHead() : la file entiere va disparaitre,
        // on reporte le plus grand seq qu'elle contenait sur le compteur
        // persiste avant de la vider.
        val maxSeq = items().maxOfOrNull { it.seq.coerceAtLeast(0L) } ?: 0L
        advanceSeqFloor(maxSeq)
        save(emptyList())
    }

    companion object {
        const val KEY_ITEMS = "queue_items"
        const val KEY_SEQ = "queue_seq"
        private const val TAG = "PagMatchQueue"
    }
}
