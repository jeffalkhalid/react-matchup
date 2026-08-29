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
import java.util.concurrent.atomic.AtomicInteger

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
    @Volatile private var clock = 100_000L

    // Faux serveur -------------------------------------------------------
    private val sent = mutableListOf<Long>()      // toute tentative d'envoi
    private val accepted = mutableListOf<Pending>() // celles qui ont abouti
    @Volatile private var gate: CompletableDeferred<Unit>? = null       // bloque UN envoi
    @Volatile private var fetchGate: CompletableDeferred<Unit>? = null  // bloque UN refresh
    @Volatile private var finalizeGate: CompletableDeferred<Unit>? = null // bloque UN finalize
    // Le battement reprend sur un autre thread apres son delay : ce compteur
    // se lit donc depuis le thread du test ET depuis celui du battement.
    private val fetchCalls = AtomicInteger(0)
    @Volatile private var respond: (Pending) -> Api.ApiResponse = { ok() }
    @Volatile private var fetch: () -> Api.ApiResponse = { ok() }
    @Volatile private var finalizeResponse: () -> Api.ApiResponse = { ok() }
    private val finalizeCalls = AtomicInteger(0)

    private fun newStore(tickMs: Long = MatchStore.TICK_MS) = MatchStore(
        prefs = prefs,
        scope = CoroutineScope(Dispatchers.Unconfined),
        fetchSession = {
            fetchCalls.incrementAndGet()
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
        finalizeSession = { _, _ ->
            finalizeCalls.incrementAndGet()
            finalizeGate?.let { g -> finalizeGate = null; g.await() }
            finalizeResponse()
        },
        now = { clock },
        tickMs = tickMs,
    )

    // Un store deja "en match" : la session est chargee, sinon score() et
    // undo() ne font rien (garde is_scorer/finished).
    private fun startedStore(tickMs: Long = MatchStore.TICK_MS): MatchStore {
        val s = newStore(tickMs)
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

    // 400 et non 403 : fn_watch_link (watch_rpcs.sql:20) fait un RAISE
    // EXCEPTION nu, donc SQLSTATE P0001, que PostgREST rend en 400. Le test
    // doit epingler le statut REEL, sinon il passe aussi bien contre une
    // version qui ne regarde pas le statut du tout.
    @Test fun `token_revoked delie la montre et vide la file`() {
        val s = startedStore()
        s.startPolling()
        respond = { err(400, """{"code":"P0001","message":"token_revoked"}""") }

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

        assertEquals(1, fetchCalls.get())
        g.complete(Unit)
    }

    // ---- I3 : une file bloquee se voit ------------------------------------

    @Test fun `une file bloquee finit par le dire`() {
        val s = startedStore()
        val before = fetchCalls.get()
        respond = { throw IOException("lien coupe") }

        s.score(1)
        assertEquals("En attente : 1", s.message.value)

        clock += MatchStore.STALL_MS      // le lien reste coupe 15 s
        s.drain()

        assertEquals("Bloque : 1", s.message.value)
        assertTrue("le score doit continuer d etre rafraichi malgre le blocage",
            fetchCalls.get() > before)
    }

    // FIX 4 : le seuil est du TEMPS, pas un compte de tentatives. drain() est
    // appele par chaque tapotement autant que par le battement, donc trois
    // appuis en une seconde suffisaient a afficher "Bloque" -- pendant qu'un
    // hoquet Bluetooth de deux secondes n'est rien.
    @Test fun `trois tapotements rapides ne crient pas au blocage`() {
        val s = startedStore()
        respond = { throw IOException("hoquet bluetooth") }

        s.score(1); s.score(2); s.undo()   // trois appuis, meme seconde

        assertEquals("En attente : 3", s.message.value)
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


    // ---- FIX 1 : le battement repart apres un reappairage ------------------

    @Test fun `le battement repart apres un reappairage`() {
        val s = startedStore(tickMs = 5)
        s.startPolling()
        respond = { err(400, """{"code":"P0001","message":"token_revoked"}""") }
        s.score(1)                        // le telephone a delie la montre
        assertTrue(s.unpaired.value)

        // L'utilisateur ressaisit un code : PairingScreen pose le jeton puis
        // appelle onPaired(). L'activite n'est PAS redemarree -- se reappairer
        // est une bascule d'etat Compose -- donc onStart() ne repassera pas.
        // Si onPaired() ne relance pas le battement, plus rien n'interroge le
        // serveur : l'ecran de match reste fige sur un vieux score jusqu'a ce
        // que l'utilisateur eteigne et rallume l'ecran.
        prefs.token = "nouveau-jeton"
        val before = fetchCalls.get()
        s.onPaired()

        assertTrue("le battement doit BATTRE, pas faire un seul coup",
            waitUntil { fetchCalls.get() >= before + 3 })
        s.stopPolling()
    }

    // ---- FIX 2 : delier la montre se decide aussi sur le statut ------------

    @Test fun `un token_revoked sur un statut d infrastructure ne delie pas`() {
        val s = startedStore()
        // Meme corps qu'un vrai refus, mais sur un 500 : c'est le mode de
        // panne de C2, sur l'action la plus destructrice du fichier, puisque
        // unpair() VIDE la file.
        respond = { err(500, """{"message":"token_revoked"}""") }

        s.score(1); s.score(2); s.undo()

        assertEquals("les trois evenements restent en file", 3, s.pending)
        assertNotNull("le jeton reste valable", prefs.token)
        assertTrue("la montre reste appairee", !s.unpaired.value)
        assertNotNull(s.session.value)
    }

    // ---- FIX 3 : effacer le match passe par le meme numero d'ordre ---------

    @Test fun `un has_session false en retard n efface pas le match en cours`() {
        val s = startedStore()
        val g = CompletableDeferred<Unit>()
        fetchGate = g
        fetch = { Api.ApiResponse(200, """{"has_session":false}""") }

        s.refresh()                       // parti en premier (generation G)
        respond = { ok(team1 = "EN COURS") }
        s.score(1)                        // parti apres (G+1), arrive avant
        assertEquals("EN COURS", s.session.value!!.team1)

        g.complete(Unit)                  // la vieille reponse atterrit enfin

        assertNotNull("l ecran ne doit pas se vider sur une reponse perimee",
            s.session.value)
        assertEquals("EN COURS", s.session.value!!.team1)
    }

    // ---- Task 7 : le verdict de finalize() ---------------------------------
    // Quatre issues, quatre lectures differentes pour l'utilisateur. Le
    // brouillon initial de MatchStore.finalize (voir le brief) lisait
    // errorReason(body) seul : un refus METIER et une panne
    // d'INFRASTRUCTURE portent tous les deux un "message" et sont donc
    // indistinguables sur le seul corps -- exactement le defaut que
    // isDefinitiveRefusal() ferme ailleurs dans ce fichier (drain, refresh).
    // Ces quatre tests epinglent que finalize() applique la MEME regle.

    @Test fun `finalize reussi rapporte Success`() {
        val s = startedStore()
        finalizeResponse = { ok() }
        var result: FinalizeResult? = null

        s.finalize { result = it }

        assertEquals(FinalizeResult.Success, result)
    }

    // Refus METIER definitif (400/403/409) : le serveur a tranche sur le fond
    // (ici, moins de deux sets joues). Rejouer buterait pour toujours sur le
    // meme refus -- l'ecran ne doit jamais suggerer de reessayer.
    @Test fun `un refus metier definitif de finalize est un Refused`() {
        val s = startedStore()
        finalizeResponse = { err(400, """{"code":"P0001","message":"not_enough_sets"}""") }
        var result: FinalizeResult? = null

        s.finalize { result = it }

        assertEquals(FinalizeResult.Refused("Moins de 2 sets"), result)
    }

    // Panne d'INFRASTRUCTURE (ici un 500, meme corps qu'un refus metier --
    // "message" seul ne les distingue pas, cf. le commentaire de
    // isDefinitiveRefusal dans Api.kt). Le score n'a pas ete juge : ce n'est
    // JAMAIS un Refused, quoi que porte le corps.
    @Test fun `une panne d infrastructure pendant finalize n est jamais un refus`() {
        val s = startedStore()
        finalizeResponse = { err(500, """{"code":"57014","message":"canceling statement due to statement timeout"}""") }
        var result: FinalizeResult? = null

        s.finalize { result = it }

        assertTrue(
            "le score n a pas ete juge sur le fond, donc pas un Refused",
            result is FinalizeResult.Unreachable
        )
        assertEquals("Aucun refus metier a en tirer", "Hors ligne 500", (result as FinalizeResult.Unreachable).message)
    }

    // Exception RESEAU (Bluetooth hors de portee, telephone eteint) : la
    // requete n'a meme pas abouti, donc a fortiori pas de verdict metier.
    // Meme famille de resultat que la panne d'infrastructure ci-dessus :
    // dans les deux cas "on ne sait pas", jamais "c'est refuse".
    @Test fun `une exception reseau pendant finalize n est jamais un refus`() {
        val s = startedStore()
        finalizeResponse = { throw java.io.IOException("pas de reseau") }
        var result: FinalizeResult? = null

        s.finalize { result = it }

        assertEquals(FinalizeResult.Unreachable("Pas de reseau"), result)
    }

    // Fix round 1 : finalize() n'avait pas l'equivalent du verrou `sending`
    // de drain(). Ca ne causait rien d'observable AUJOURD'HUI -- le serveur
    // (fn_finalize_live_session_as) prend un verrou de ligne et renvoie le
    // meme match_id de facon idempotente sur un second appel -- mais cette
    // garantie ne vit que cote serveur, et rien ne l'exprimait cote client.
    @Test fun `un second appel de finalize pendant que le premier est en vol est ignore`() {
        val s = startedStore()
        val g = CompletableDeferred<Unit>()
        finalizeGate = g

        var firstResult: FinalizeResult? = null
        var secondCalled = false

        s.finalize { firstResult = it }           // part, reste en vol
        assertEquals(1, finalizeCalls.get())

        s.finalize { secondCalled = true }        // NE DOIT PAS relancer un appel
        assertEquals("le second Oui ne doit pas doubler la requete", 1, finalizeCalls.get())

        g.complete(Unit)                          // la reponse du premier arrive enfin

        assertEquals(FinalizeResult.Success, firstResult)
        assertTrue(
            "le second appel est simplement ignore, jamais mis en file ni rejoue",
            !secondCalled
        )
    }

    // ---- Faux serveur : corps de reponse ----------------------------------

    // Attente BORNEE, pour observer un battement qui vit sur un vrai timer.
    // Elle rend la main des que la condition est vraie : en pratique quelques
    // dizaines de millisecondes, jamais les 2 s du plafond.
    private fun waitUntil(timeoutMs: Long = 2000, cond: () -> Boolean): Boolean {
        val end = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < end) {
            if (cond()) return true
            Thread.sleep(2)
        }
        return cond()
    }

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
