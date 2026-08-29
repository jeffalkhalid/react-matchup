package com.pagmatch.wear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.concurrent.Callable
import java.util.concurrent.CyclicBarrier
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

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

    // Tue le mutant "clear() sans advanceSeqFloor". Le test ci-dessus
    // (`clear preserve le plancher de sequence`) ne le distingue PAS : ses
    // deux enqueue() se terminent normalement, donc queue_seq vaut deja 2
    // avant l'appel a clear(), et la reponse est 3 avec ou sans le report du
    // plancher dans clear(). Ici, le second enqueue() (B) est tue avant
    // d'ecrire son compteur -- queue_seq reste a 1 alors que B (seq 2) est
    // deja dans la file -- puis clear() est appele normalement. Sans
    // advanceSeqFloor dans clear(), le troisieme enqueue() (C) retomberait
    // sur seq 2, le seq de B deja acquitte par le serveur.
    @Test fun `clear apres un enqueue tue preserve quand meme le plancher`() {
        val store = FakeStore()
        val q1 = Queue(store)
        assertEquals(1L, q1.enqueue("s1", "point_won", 1)) // A, ecriture complete

        val killed = CrashAfterNWritesStore(store, crashAfter = 1)
        assertEquals(2L, Queue(killed).enqueue("s1", "point_won", 2)) // B, compteur jamais ecrit

        // clear() lui-meme n'est PAS tue : c'est bien l'absence du report du
        // plancher dans son code, pas un kill supplementaire, qui est testee.
        Queue(store).clear()

        val seq = Queue(store).enqueue("s1", "point_won", 1) // C, un point different
        assert(seq != 1L && seq != 2L) {
            "clear() n'a pas preserve le plancher : enqueue a reutilise $seq"
        }
        assertEquals(3L, seq)
    }

    @Test fun `un compteur persiste negatif est traite comme zero`() {
        val store = FakeStore()
        store.putString(Queue.KEY_SEQ, "-42")
        assertEquals(1L, Queue(store).nextSeq())
    }

    // Tue le mutant qui revient sur FIX B (nextSeq() qui relit queue_seq
    // seul, sans regarder la file). C'est le test que le round 2 n'avait
    // pas : `un compteur persiste negatif est traite comme zero` passe que
    // le clamp existe ou non, car maxOf(-42, maxQueuedSeq=0) vaut deja 0
    // dans les deux cas -- il ne peut PAS distinguer le clamp seul, qui est
    // du code mathematiquement equivalent tant que maxQueuedSeq reste >= 0
    // (verifie : appliquer UNIQUEMENT ce mutant fait passer les 17 tests).
    // Le mecanisme qui compte reellement est celui-ci : un item deja en
    // file avec un seq eleve doit faire remonter le plancher de nextSeq(),
    // meme si queue_seq lui-meme n'a jamais ete mis a jour pour ce seq.
    @Test fun `push d un seq eleve fait remonter le plancher de nextSeq`() {
        val store = FakeStore()
        val q = Queue(store)
        q.push("s1", "point_won", 1, 5) // item seq=5, queue_seq jamais touche
        assertEquals(6L, q.nextSeq())
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

    // Tue le mutant "popHead() ecrit le plancher APRES avoir retire l item"
    // (l'ordre inverse de celui choisi). A(seq1) est enqueue normalement ;
    // B(seq2) est enqueue mais tue avant l'ecriture de son compteur --
    // queue_seq reste a 1. On popHead() A normalement (n'avance rien, le
    // plancher est deja a 1), puis on popHead() B avec un kill entre les
    // deux ecritures de popHead() lui-meme :
    //  - ordre correct (plancher d'abord) : le kill tombe APRES l'ecriture
    //    du plancher (queue_seq -> 2) et AVANT le retrait de B de la file --
    //    B reste dans items, le plancher est deja a 2, rien n'est perdu ni
    //    reutilisable.
    //  - ordre inverse (retrait d'abord) : le kill tombe APRES le retrait de
    //    B (items redevient []) et AVANT l'ecriture du plancher -- toute
    //    trace du seq de B disparait, queue_seq reste bloque a 1.
    // Dans les deux cas, un enqueue(C) ulterieur revele la difference : 3
    // avec l'ordre correct, 2 (le seq de B, deja acquitte) avec l'ordre
    // inverse.
    @Test fun `un kill entre les deux ecritures de popHead ne fait pas reculer le plancher`() {
        val store = FakeStore()
        val q1 = Queue(store)
        assertEquals(1L, q1.enqueue("s1", "point_won", 1)) // A

        val killedEnqueue = CrashAfterNWritesStore(store, crashAfter = 1)
        assertEquals(2L, Queue(killedEnqueue).enqueue("s1", "point_won", 2)) // B, compteur jamais ecrit

        Queue(store).popHead() // retire A ; n'a rien a avancer (plancher deja a 1)

        val killedPop = CrashAfterNWritesStore(store, crashAfter = 1)
        Queue(killedPop).popHead() // retire B ; kill entre les deux ecritures

        val seq = Queue(store).enqueue("s1", "point_won", 1) // C, un point different
        assert(seq != 1L && seq != 2L) {
            "popHead() n'a pas protege le plancher contre un kill : enqueue a reutilise $seq"
        }
        assertEquals(3L, seq)
    }

    @Test fun `une file corrompue degrade sans crash au lieu de faire disparaitre l app`() {
        val store = FakeStore()
        store.putString(Queue.KEY_ITEMS, "{ceci n'est pas du json valide")
        val q = Queue(store)
        assertEquals(0, q.size())
        assertNull(q.head())
    }

    // Tue le mutant "retire toute synchronisation de Queue" (les
    // synchronized(lock) autour de items()/push()/nextSeq()/enqueue()/
    // popHead()/size()/clear()). 16 threads, une SEULE instance de Queue
    // partagee (exactement le scenario redoute : thread UI + coroutine
    // d'envoi sur la meme Queue), chacun fait 40 enqueue() -- 640 au total.
    //
    // Le CyclicBarrier force les 16 threads a demarrer au meme instant, pour
    // maximiser la contention reelle plutot que de compter sur la chance
    // d'un entrelacement defavorable.
    //
    // Pourquoi ce test ne peut PAS etre capricieux dans le sens PASSANT :
    // avec le verrou en place, synchronized() serialise integralement
    // chaque enqueue() (lecture + deux ecritures) avant que le suivant ne
    // commence, quel que soit l'ordonnancement des threads -- c'est une
    // garantie du langage (exclusion mutuelle + visibilite memoire via le
    // moniteur JVM), pas un resultat probable. Le resultat attendu (640
    // seq distincts, 640 evenements stockes) est donc deterministe, pas
    // "generalement vrai". Le CyclicBarrier ne fait qu'augmenter les
    // chances de tuer le mutant si jamais le verrou disparaissait ; il ne
    // conditionne en rien la reussite du test quand le verrou est present.
    // Le timeout (15s, trois ordres de grandeur au-dessus du temps reel
    // d'execution) protege uniquement contre un blocage si quelqu'un
    // reintroduit un bug de verrouillage plus tard -- il ne participe pas
    // non plus a la reussite normale du test.
    @Test(timeout = 15_000)
    fun `enqueue concurrent depuis plusieurs threads ne perd et ne redouble aucun seq`() {
        val store = FakeStore()
        val q = Queue(store)
        val threadCount = 16
        val perThread = 40
        val expectedTotal = threadCount * perThread

        val barrier = CyclicBarrier(threadCount)
        val pool = Executors.newFixedThreadPool(threadCount)
        try {
            val tasks = (0 until threadCount).map { t ->
                Callable<List<Long>> {
                    barrier.await() // tous les threads demarrent au meme instant
                    (0 until perThread).map { q.enqueue("s1", "point_won", t) }
                }
            }
            val allSeqs = pool.invokeAll(tasks).map { it.get() }.flatten()

            assertEquals(expectedTotal, allSeqs.size)
            assert(allSeqs.toSet().size == expectedTotal) {
                "des client_seq ont ete reutilises sous contention : ${allSeqs.size} valeurs, ${allSeqs.toSet().size} distinctes"
            }
            assert(q.size() == expectedTotal) {
                "des evenements ont disparu de la file sous contention : ${q.size()} au lieu de $expectedTotal"
            }
        } finally {
            pool.shutdownNow()
            pool.awaitTermination(5, TimeUnit.SECONDS)
        }
    }
}
