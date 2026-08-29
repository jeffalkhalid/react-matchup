package com.pagmatch.wear

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

// La politique de RETRAIT de la file (quand un evenement quitte la file, et
// lequel) vivait dans une fonction de 30 lignes que rien ne testait. C'est
// pourtant la seule chose qui decide si un point marque au poignet arrive ou
// disparait. Ces tests l'exercent hors Android grace aux deux lambdas reseau
// de MatchStore : un faux serveur qu'on fait echouer, refuser, ou repondre a
// contretemps a volonte.
//
// Le scope est Dispatchers.Unconfined : chaque coroutine s'execute
// immediatement sur le thread du test jusqu'a sa premiere suspension, donc
// tout est deterministe. La suspension, elle, est provoquee A LA DEMANDE par
// un "portillon" (CompletableDeferred) : c'est ce qui permet de reproduire
// une requete EN VOL, l'etat exact ou vivaient les trois defauts corriges.
class MatchStoreTest {

    private val prefs = FakeTokenStore()
    private var clock = 100_000L

    // Faux serveur -------------------------------------------------------
    private val sent = mutableListOf<Long>()      // toute tentative d'envoi
    private val accepted = mutableListOf<Pending>() // celles qui ont abouti
    private var gate: CompletableDeferred<Unit>? = null       // bloque UN envoi
    private var fetchGate: CompletableDeferred<Unit>? = null  // bloque UN refresh
    private var fetchCalls = 0
    private var respond: (Pending) -> Api.ApiResponse = { ok() }
    private var fetch: () -> Api.ApiResponse = { ok() }

    private fun newStore() = MatchStore(
        prefs = prefs,
        scope = CoroutineScope(Dispatchers.Unconfined),
        fetchSession = {
            fetchCalls++
            fetchGate?.let { g -> fetchGate = null; g.await() }
            fetch()
        },
        sendEvent = { _, e ->
            sent += e.seq
            gate?.let { g -> gate = null; g.await() }
            val r = respond(e)
            if (r.status == 200) accepted += e
            r
        },
        now = { clock },
    )

    // Un store deja "en match" : la session est chargee, sinon score() et
    // undo() ne font rien (garde is_scorer/finished).
    private fun startedStore(): MatchStore {
        val s = newStore()
        s.refresh()
        assertNotNull("la session de depart doit etre chargee", s.session.value)
        return s
    }

    // ---- C1 : un seul envoi en vol, et on ne retire que ce qu'on a envoye --

    @Test fun `un seul envoi en vol a la fois`() {
        val s = startedStore()
        val g = CompletableDeferred<Unit>()
        gate = g

        s.score(1)                        // seq 1 part, puis reste en vol
        assertEquals(listOf(1L), sent)
        s.score(2)                        // le tapotement suivant NE DOIT PAS
        // relancer un envoi pendant que le premier est en vol : c'est ce
        // doublon qui faisait lire la meme tete de file a deux coroutines,
        // puis retirer a chacune "la tete courante" -- pas celle qu'elle avait
        // envoyee.
        assertEquals(listOf(1L), sent)

        g.complete(Unit)                  // la reponse de seq 1 arrive enfin
        // La meme boucle enchaine sur seq 2, dans l'ordre, une seule fois.
        assertEquals(listOf(1L, 2L), sent)
        assertEquals(listOf(1L, 2L), accepted.map { it.seq })
        assertEquals(0, s.pending)
    }

    @Test fun `une reponse orpheline ne retire rien`() {
        val s = startedStore()
        val g = CompletableDeferred<Unit>()
        gate = g

        s.score(1)   // seq 1 en vol
        s.score(2)   // seq 2 en file derriere

        // Pendant que seq 1 est en vol, la file change SOUS l'envoi (ici :
        // retire ailleurs, comme le ferait un vidage). La tete n'est donc plus
        // seq 1 quand la reponse arrive.
        Queue(prefs).popHead()
        g.complete(Unit)

        // Sans la garde d'orphelin, le 200 de seq 1 retirait la TETE COURANTE,
        // c'est-a-dire seq 2 -- jamais envoye, jamais applique, et plus en
        // file. Un point disparu sans un mot.
        assertEquals(1, s.pending)
        assertEquals(2L, Queue(prefs).head()!!.seq)
        assertEquals(listOf(1L), sent)
    }

    // ---- Mode avion : la promesse centrale de la fonctionnalite ------------
    // Remplace l'essai manuel sur montre (trois points hors reseau, puis
    // reconnexion) : ici il tourne a chaque build.

    @Test fun `trois points hors reseau arrivent dans l ordre une seule fois`() {
        val s = startedStore()
        var calls = 0
        respond = { if (++calls <= 3) throw IOException("mode avion") else ok() }

        s.score(1)   // 30-0 pour l'equipe du haut
        s.score(2)   // riposte
        s.undo()     // et on annule le dernier

        // Hors reseau : rien n'est parti, mais rien n'est perdu non plus.
        assertEquals(3, s.pending)
        assertTrue(accepted.isEmpty())

        s.drain()    // le reseau revient (ce que fait le battement de 5 s)

        assertEquals(0, s.pending)
        assertEquals(listOf(1L, 2L, 3L), accepted.map { it.seq })
        assertEquals(
            listOf("point_won" to 1, "point_won" to 2, "undo" to 0),
            accepted.map { it.type to it.team }
        )
    }

    // ---- C2 : ce qui est jete, et ce qui ne l'est jamais -------------------

    @Test fun `une panne d infrastructure ne jette pas le point`() {
        val s = startedStore()
        // Sous charge, PostgREST renvoie ceci avec un statut 500. Le corps
        // porte un "message", exactement comme un RAISE metier : seul le
        // statut les distingue.
        respond = { err(500, """{"code":"57014","message":"canceling statement due to statement timeout"}""") }

        s.score(1)

        assertEquals("le point reste en file pour etre rejoue", 1, s.pending)
    }

    @Test fun `un jeton d API expire ne vide pas la file entiere`() {
        val s = startedStore()
        respond = { err(401, """{"message":"JWT expired"}""") }

        s.score(1); s.score(2); s.undo()

        // L'ancienne boucle faisait `continue` sur tout corps porteur d'un
        // message : les trois evenements etaient retires en UNE passe.
        assertEquals(3, s.pending)
        assertTrue(accepted.isEmpty())
    }

    @Test fun `un 404 de rechargement du cache de schema ne jette pas le point`() {
        val s = startedStore()
        // Nos propres migrations declenchent NOTIFY pgrst : pendant le
        // rechargement, la RPC est introuvable quelques secondes.
        respond = { err(404, """{"message":"Could not find the function public.watch_apply_event"}""") }
        s.score(1)
        assertEquals(1, s.pending)
    }

    @Test fun `un refus metier definitif retire l evenement`() {
        val s = startedStore()
        respond = { err(400, """{"code":"P0001","message":"not_the_scorer"}""") }

        s.score(1)

        assertEquals("rejouer buterait pour toujours sur le meme refus", 0, s.pending)
        assertEquals("Plus le scoreur", s.message.value)
    }

    // ---- I4 : le telephone a delie la montre ------------------------------

    @Test fun `token_revoked delie la montre et vide la file`() {
        val s = startedStore()
        s.startPolling()
        respond = { err(403, """{"code":"P0001","message":"token_revoked"}""") }

        s.score(1); s.score(2)

        assertNull("le jeton ne vaut plus rien", prefs.token)
        assertEquals(0, s.pending)
        assertNull(s.session.value)
        assertTrue("l ecran doit revenir a l appairage", s.unpaired.value)
        assertEquals("Montre deliee", s.message.value)
    }

    // ---- I1 : un corps illisible n'efface jamais le match ------------------

    @Test fun `un corps illisible ne dit pas qu il n y a plus de match`() {
        val s = startedStore()
        fetch = { Api.ApiResponse(200, "<html>502 Bad Gateway</html>") }

        s.refresh()

        assertNotNull("le score doit rester lisible pendant le hoquet", s.session.value)
        assertEquals("Reponse illisible", s.message.value)
    }

    @Test fun `has_session false efface bien le match`() {
        val s = startedStore()
        fetch = { Api.ApiResponse(200, """{"has_session":false}""") }

        s.refresh()

        assertNull(s.session.value)
    }

    // ---- I2 : le score ne recule jamais ------------------------------------

    @Test fun `un rafraichissement en retard ne fait pas reculer le score`() {
        val s = startedStore()
        val g = CompletableDeferred<Unit>()
        fetchGate = g
        fetch = { ok(team1 = "ANCIEN") }

        s.refresh()                       // parti en premier, encore en vol
        respond = { ok(team1 = "NOUVEAU") }
        s.score(1)                        // parti apres, arrive avant
        assertEquals("NOUVEAU", s.session.value!!.team1)

        g.complete(Unit)                  // la vieille reponse atterrit enfin

        assertEquals("NOUVEAU", s.session.value!!.team1)
    }

    @Test fun `un seul rafraichissement en vol a la fois`() {
        val s = newStore()
        val g = CompletableDeferred<Unit>()
        fetchGate = g

        s.refresh()
        s.refresh()
        s.refresh()

        assertEquals(1, fetchCalls)
        g.complete(Unit)
    }

    // ---- I3 : une file bloquee se voit ------------------------------------

    @Test fun `une file bloquee finit par le dire`() {
        val s = startedStore()
        val before = fetchCalls
        respond = { throw IOException("lien coupe") }

        s.score(1)
        assertEquals("En attente : 1", s.message.value)
        s.drain()
        assertEquals("En attente : 1", s.message.value)
        s.drain()

        assertEquals("Bloque : 1", s.message.value)
        assertTrue("le score doit continuer d etre rafraichi malgre le blocage",
            fetchCalls > before)
    }

    // ---- I5 : l'accuse laisse revenir le score du jeu ----------------------

    @Test fun `l accuse de point s efface une fois lu`() {
        val s = startedStore()
        val g = CompletableDeferred<Unit>()
        gate = g

        s.score(1)
        assertEquals("aucun point ne s ajoute en silence", "Point K&A", s.message.value)

        clock += 3000                     // le temps de le lire
        g.complete(Unit)

        assertNull("la ligne du milieu doit rendre la main au score du jeu",
            s.message.value)
    }

    @Test fun `l accuse de point n est pas efface avant d avoir ete lu`() {
        val s = startedStore()
        val g = CompletableDeferred<Unit>()
        gate = g

        s.score(1)
        g.complete(Unit)                  // reponse quasi immediate

        assertEquals("Point K&A", s.message.value)
    }

    // ---- C3 : une seule instance par processus -----------------------------

    @Test fun `get renvoie toujours la meme instance`() {
        val a = MatchStore.get(FakeTokenStore())
        val b = MatchStore.get(FakeTokenStore())
        assertTrue("deux instances = deux Queue sur le meme store", a === b)
    }

    // ---- Faux serveur : corps de reponse ----------------------------------

    private fun ok(team1: String = "K&A") = Api.ApiResponse(200, payload(team1))
    private fun err(status: Int, body: String) = Api.ApiResponse(status, body)

    private fun payload(team1: String) = """
        {"has_session":true,"session_id":"s1","scoring_mode":"points",
         "is_scorer":true,"input_device":"watch",
         "team1":"$team1","team2":"B&C","team1_short":"K&A","team2_short":"B&C",
         "sets":[],"sets_won":{"t1":0,"t2":0},
         "game_label":{"t1":"0","t2":"0"},
         "match_decided":false,"finished":false}
    """.trimIndent()
}

// Prefs a besoin d'un Context Android ; TokenStore est exactement ce que
// MatchStore exige, et rien de plus.
class FakeTokenStore : TokenStore {
    private val m = mutableMapOf<String, String>()
    override fun getString(k: String) = m[k]
    override fun putString(k: String, v: String) { m[k] = v }
    override var token: String? = "jeton-de-test"
}
