package com.pagmatch.wear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FakeStore : KeyValueStore {
    private val m = mutableMapOf<String, String>()
    override fun getString(k: String) = m[k]
    override fun putString(k: String, v: String) { m[k] = v }
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
}
