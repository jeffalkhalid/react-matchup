package com.pagmatch.wear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FakeStore : KeyValueStore {
    private val m = mutableMapOf<String, String>()
    override fun getString(k: String) = m[k]
    override fun putString(k: String, v: String) { m[k] = v }
}

// Simule un kill du process pile apres N ecritures reussies : les
// putString() suivants sont silencieusement avales (jamais appliques au
// store sous-jacent), exactement ce que laisserait un process tue entre les
// deux putString() de Queue.enqueue(). Le store sous-jacent, lui, garde tout
// ce qui a ete ecrit avant le "kill" -- une nouvelle Queue construite
// directement dessus (sans ce wrapper) simule le redemarrage.
class CrashAfterNWritesStore(private val delegate: KeyValueStore, private val crashAfter: Int) : KeyValueStore {
    private var writes = 0
    override fun getString(k: String) = delegate.getString(k)
    override fun putString(k: String, v: String) {
        if (writes >= crashAfter) return
        writes++
        delegate.putString(k, v)
    }
}

class QueueTest {
    @Test fun `la sequence est monotone et jamais reutilisee`() {
        val q = Queue(FakeStore())
        assertEquals(1L, q.nextSeq())
        assertEquals(2L, q.nextSeq())
        assertEquals(3L, q.nextSeq())
    }

    @Test fun `la sequence survit a un redemarrage`() {
        val store = FakeStore()
        Queue(store).nextSeq()
        Queue(store).nextSeq()
        assertEquals(3L, Queue(store).nextSeq())
    }

    @Test fun `les evenements sortent dans l ordre d entree`() {
        val q = Queue(FakeStore())
        q.push("s1", "point_won", 1, 1)
        q.push("s1", "point_won", 2, 2)
        assertEquals(1L, q.head()!!.seq)
        q.popHead()
        assertEquals(2L, q.head()!!.seq)
        q.popHead()
        assertNull(q.head())
    }

    @Test fun `la file survit a un redemarrage`() {
        val store = FakeStore()
        Queue(store).push("s1", "undo", 0, 7)
        val q = Queue(store)
        assertEquals(1, q.size())
        assertEquals("undo", q.head()!!.type)
        assertEquals(7L, q.head()!!.seq)
    }

    @Test fun `depiler une file vide ne casse rien`() {
        val q = Queue(FakeStore())
        q.popHead()
        assertEquals(0, q.size())
    }

    @Test fun `l ordre survit a un redemarrage avec plusieurs evenements`() {
        val store = FakeStore()
        val writer = Queue(store)
        writer.push("s1", "point_won", 1, 1)
        writer.push("s1", "point_won", 2, 2)
        writer.push("s1", "undo", 0, 3)

        // Nouvelle instance construite sur le meme store, comme apres un
        // redemarrage du process suite a un crash.
        val q = Queue(store)
        assertEquals(3, q.size())
        assertEquals(1L, q.head()!!.seq)
        q.popHead()
        assertEquals(2L, q.head()!!.seq)
        q.popHead()
        assertEquals(3L, q.head()!!.seq)
        assertEquals("undo", q.head()!!.type)
        q.popHead()
        assertNull(q.head())
    }

    @Test fun `enqueue stocke l evenement et renvoie son numero de sequence`() {
        val q = Queue(FakeStore())
        val seq = q.enqueue("s1", "point_won", 1)
        assertEquals(1L, seq)
        assertEquals(1, q.size())
        val stored = q.head()!!
        assertEquals("s1", stored.sid)
        assertEquals("point_won", stored.type)
        assertEquals(1, stored.team)
        assertEquals(1L, stored.seq)
    }

    @Test fun `deux enqueue successifs ne renvoient jamais le meme numero`() {
        val q = Queue(FakeStore())
        val first = q.enqueue("s1", "point_won", 1)
        val second = q.enqueue("s1", "point_won", 2)
        assert(first != second) { "enqueue a renvoye deux fois le meme client_seq : $first" }
        assertEquals(2, q.size())
    }

    // Discrimine enqueue() de sa version naive rejetee
    // (`fun enqueue(...) = nextSeq().also { push(..., it) }`) : avec cet
    // ordre-la, le PREMIER putString() (celui de nextSeq(), sur queue_seq)
    // reussit et le SECOND (celui de push(), sur queue_items) est perdu --
    // l'evenement ne survit donc jamais a ce kill. Avec l'ordre choisi ici
    // (items d'abord), c'est l'inverse : le premier putString() qui doit
    // reussir est celui qui ecrit l'evenement.
    @Test fun `un kill entre les deux ecritures de enqueue laisse l evenement recuperable`() {
        val store = FakeStore()
        val killed = CrashAfterNWritesStore(store, crashAfter = 1)
        val seq = Queue(killed).enqueue("s1", "point_won", 1)
        assertEquals(1L, seq)

        // Redemarrage : nouvelle instance sur le MEME store, sans le wrapper
        // qui "tuait" le process.
        val restarted = Queue(store)
        assertEquals(1, restarted.size())
        assertEquals(1L, restarted.head()!!.seq)
    }

    // Reproduit exactement le scenario de reutilisation trouve en review :
    // enqueue(A), puis enqueue(B) tue avant l'ecriture du compteur, puis
    // redemarrage ou A et B sont envoyes et popHead()-es tous les deux, puis
    // un troisieme enqueue(C). Sans le report du plancher dans popHead(),
    // C reutiliserait le seq de B (deja acquitte par le serveur) et
    // disparaitrait silencieusement en tant que "doublon".
    @Test fun `enqueue apres kill puis purge complete de la file ne reutilise pas un seq deja acquitte`() {
        val store = FakeStore()
        val q1 = Queue(store)
        assertEquals(1L, q1.enqueue("s1", "point_won", 1)) // A

        val killed = CrashAfterNWritesStore(store, crashAfter = 1)
        assertEquals(2L, Queue(killed).enqueue("s1", "point_won", 2)) // B, kill avant le compteur

        // Redemarrage : le reseau revient, A et B sont envoyes et acquittes.
        val q3 = Queue(store)
        assertEquals(2, q3.size())
        q3.popHead() // A acquitte
        q3.popHead() // B acquitte
        assertEquals(0, q3.size())

        val seq = q3.enqueue("s1", "point_won", 1) // C, un point different
        assert(seq != 1L && seq != 2L) {
            "enqueue a reutilise un client_seq deja acquitte par le serveur : $seq"
        }
        assertEquals(3L, seq)
    }

    @Test fun `clear preserve le plancher de sequence`() {
        val store = FakeStore()
        val q = Queue(store)
        q.enqueue("s1", "point_won", 1)
        q.enqueue("s1", "point_won", 2)
        q.clear()
        assertEquals(3L, q.enqueue("s1", "point_won", 1))
    }

    @Test fun `un compteur persiste negatif est traite comme zero`() {
        val store = FakeStore()
        store.putString(Queue.KEY_SEQ, "-42")
        assertEquals(1L, Queue(store).nextSeq())
    }

    @Test fun `enqueue sature au lieu de deborder si un seq deja stocke est au maximum`() {
        val store = FakeStore()
        // Injecte directement un item dont le seq est deja au maximum
        // representable : un calcul naif de max(...) + 1 deborderait sur
        // Long.MIN_VALUE (un client_seq negatif).
        val json = kotlinx.serialization.json.Json
        store.putString(Queue.KEY_ITEMS, json.encodeToString(listOf(Pending("s1", "point_won", 1, Long.MAX_VALUE))))

        val seq = Queue(store).enqueue("s1", "point_won", 2)
        assert(seq >= 0) { "enqueue a produit un client_seq negatif (debordement) : $seq" }
        assertEquals(Long.MAX_VALUE, seq)
    }

    @Test fun `une file corrompue degrade sans crash au lieu de faire disparaitre l app`() {
        val store = FakeStore()
        store.putString(Queue.KEY_ITEMS, "{ceci n'est pas du json valide")
        val q = Queue(store)
        assertEquals(0, q.size())
        assertNull(q.head())
    }
}
