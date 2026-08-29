package com.pagmatch.wear

import android.util.Log
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

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

    fun items(): List<Pending> {
        val raw = store.getString(KEY_ITEMS) ?: return emptyList()
        return try {
            json.decodeFromString(raw)
        } catch (e: Exception) {
            // Fail-open est voulu : mieux vaut une file vide qu'un crash. Mais
            // une file corrompue qui disparait sans un mot peut faire perdre
            // un rally entier sans que personne ne le sache jamais -- on logge
            // donc avant de retomber sur emptyList(). android.util.Log n'est
            // pas mocke dans les tests unitaires JVM (pas de runtime Android)
            // et leve ; on avale cette erreur-la specifiquement pour ne pas
            // casser les tests qui exercent ce chemin.
            try {
                Log.e(TAG, "File d'envoi corrompue, reinitialisee a vide (fail-open)", e)
            } catch (loggingUnavailable: Throwable) {
                // Pas de runtime Android (tests JVM) : rien a faire.
            }
            emptyList()
        }
    }

    private fun save(a: List<Pending>) {
        store.putString(KEY_ITEMS, json.encodeToString(a))
    }

    // client_seq monotone, JAMAIS reutilise : c'est la cle d'idempotence.
    fun nextSeq(): Long {
        val s = (store.getString(KEY_SEQ)?.toLongOrNull() ?: 0L) + 1L
        store.putString(KEY_SEQ, s.toString())
        return s
    }

    fun push(sessionId: String, eventType: String, team: Int, seq: Long) {
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
    // Le store sous-jacent n'ecrit qu'une cle a la fois : il n'y a pas de
    // vraie transaction a deux cles. On choisit donc l'ORDRE des deux
    // ecritures avec soin :
    //   1) l'evenement est ecrit dans queue_items D'ABORD.
    //   2) le compteur queue_seq est mis a jour ENSUITE.
    // Un kill entre les deux laisse l'evenement deja dans la file -- il sera
    // envoye et rejoue normalement, rien n'est perdu. C'est l'inverse de
    // l'ordre actuel de nextSeq()+push() (compteur d'abord), qui est
    // precisement le trou decrit ci-dessus.
    //
    // Cet ordre ouvre en retour un risque plus etroit : si le kill survient
    // juste apres l'ecriture de l'evenement mais avant celle du compteur,
    // queue_seq reste en retard d'un cran. Un nextSeq()/enqueue() naif qui ne
    // lirait QUE queue_seq recalculerait alors le MEME numero pour un
    // evenement different -- deux evenements distincts porteraient le meme
    // client_seq, et le serveur, qui deduplique sur (session_id,
    // watch_link_id, client_seq), rejetterait a tort le second comme un
    // doublon : un point different disparaitrait en silence. On neutralise
    // ce risque en ne faisant jamais confiance au seul compteur : le prochain
    // seq est le max entre queue_seq et le plus grand seq deja present dans
    // la file, plus un. Avec ca, un kill entre les deux ecritures ne peut
    // plus jamais causer de reutilisation -- au pire queue_seq reste
    // brievement en retard, sans consequence, jusqu'au prochain enqueue().
    fun enqueue(sessionId: String, eventType: String, team: Int): Long {
        val existing = items()
        val persistedSeq = store.getString(KEY_SEQ)?.toLongOrNull() ?: 0L
        val maxQueuedSeq = existing.maxOfOrNull { it.seq } ?: 0L
        val seq = maxOf(persistedSeq, maxQueuedSeq) + 1L

        save(existing + Pending(sessionId, eventType, team, seq)) // 1) evenement
        store.putString(KEY_SEQ, seq.toString())                   // 2) compteur

        return seq
    }

    fun head(): Pending? = items().firstOrNull()

    fun popHead() {
        val a = items()
        if (a.isEmpty()) return
        save(a.drop(1))
    }

    fun size(): Int = items().size

    fun clear() = save(emptyList())

    companion object {
        const val KEY_ITEMS = "queue_items"
        const val KEY_SEQ = "queue_seq"
        private const val TAG = "PagMatchQueue"
    }
}
