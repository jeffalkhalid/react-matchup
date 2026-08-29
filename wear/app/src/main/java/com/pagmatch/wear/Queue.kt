package com.pagmatch.wear

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
        return try { json.decodeFromString(raw) } catch (e: Exception) { emptyList() }
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
    }
}
