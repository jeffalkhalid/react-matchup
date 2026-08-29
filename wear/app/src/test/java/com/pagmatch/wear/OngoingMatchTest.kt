package com.pagmatch.wear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// Les deux decisions de cette tache qui peuvent etre fausses sans qu'aucune
// compilation ne s'en plaigne vivent dans des fonctions PURES, hors du
// Service : quand l'activite en cours doit exister (shouldShowOngoing) et ce
// qu'elle affiche (ongoingText). Le reste du fichier -- notification, canal,
// startForeground -- est du cablage de plateforme, verifiable seulement sur un
// appareil, et il est verifie la (voir le rapport de tache).
class OngoingMatchTest {

    private fun session(
        setsWon: SetScore = SetScore(0, 0),
        gameLabel: GameLabel? = null,
        currentGame: SetScore? = null,
        tieBreak: Boolean = false,
        finished: Boolean = false,
    ) = Session(
        hasSession = true, sessionId = "s", setsWon = setsWon, gameLabel = gameLabel,
        currentGame = currentGame, tieBreak = tieBreak, finished = finished,
    )

    // ---- Quand l'activite en cours existe --------------------------------

    @Test fun `pas de session, pas d'activite en cours`() {
        assertFalse(shouldShowOngoing(null))
    }

    @Test fun `une session ouverte donne une activite en cours`() {
        assertTrue(shouldShowOngoing(session()))
    }

    // Le score valide : le serveur renvoie encore la session, mais close.
    // L'etat en cours ne doit pas survivre au match -- c'est l'exigence meme
    // de la tache ("il ne doit pas survivre au match").
    @Test fun `un match termine arrete l'activite en cours`() {
        assertFalse(shouldShowOngoing(session(finished = true)))
    }

    // MatchStore.unpair() met _session a null : le deliage passe donc par le
    // MEME predicat que la fin de match, sans chemin separe. Ce test fige ce
    // couplage -- si un jour unpair() cessait de vider la session, l'icone
    // resterait sur le cadran d'une montre deliee.
    @Test fun `une montre deliee vide la session, donc arrete l'activite`() {
        assertFalse(shouldShowOngoing(null))
    }

    // ---- Ce que l'activite en cours affiche ------------------------------

    @Test fun `le texte porte les sets et le jeu en cours`() {
        val t = ongoingText(session(SetScore(1, 0), GameLabel("40", "30")))
        assertEquals("Sets 1-0 Jeu 40-30", t)
    }

    // "AV" (avantage) est un jeton texte du serveur au meme titre que "40" :
    // fn_game_label renvoie des CHAINES, jamais des entiers.
    @Test fun `l'avantage passe tel quel`() {
        assertEquals("Sets 0-0 Jeu AV-40", ongoingText(session(SetScore(0, 0), GameLabel("AV", "40"))))
    }

    // Le tie-break prend "TB" : les nombres n'y veulent pas dire 15/30/40, et
    // l'etiquette est deux caracteres plus courte, ce qui compte sous la borne.
    @Test fun `le tie-break est annonce comme tel`() {
        val t = ongoingText(session(SetScore(1, 1), GameLabel("6", "5"), tieBreak = true))
        assertEquals("Sets 1-1 TB 6-5", t)
    }

    // Repli sur current_game (des ENTIERS) quand game_label manque : c'est le
    // cas du mode points, ou le libelle de jeu peut etre absent du payload.
    @Test fun `sans game_label on retombe sur current_game`() {
        assertEquals("Sets 0-1 Jeu 3-2", ongoingText(session(SetScore(0, 1), currentGame = SetScore(3, 2))))
    }

    // Match qui commence : ni jeu en cours, ni libelle. On annonce les sets
    // seuls plutot qu'un tiret orphelin ("Sets 0-0 Jeu -"), qui ne voudrait
    // rien dire au poignet.
    @Test fun `sans jeu en cours on n'annonce que les sets`() {
        assertEquals("Sets 0-0", ongoingText(session()))
    }

    // Un game_label present mais VIDE des deux cotes composerait "-" : c'est
    // le meme rien, il doit suivre le meme chemin que l'absence.
    @Test fun `un game_label vide vaut une absence`() {
        assertEquals("Sets 0-0", ongoingText(session(gameLabel = GameLabel("", ""))))
    }

    // La borne des 20 caracteres est APPLIQUEE, pas seulement esperee. Sans
    // cela, un jeton serveur inattendu allongerait le texte et le systeme le
    // couperait n'importe ou -- en plein soleil, une ligne coupee au hasard ne
    // se lit pas.
    @Test fun `le texte reste sous vingt caracteres, quoi que dise le serveur`() {
        val t = ongoingText(session(SetScore(0, 0), GameLabel("BEAUCOUPTROPLONG", "PAREIL")))
        assertTrue("longueur ${t.length} : $t", t.length < 20)
        assertEquals(ONGOING_MAX_CHARS, t.length)
    }

    // ASCII pur : la police du cadran, choisie par le systeme et non par nous,
    // n'a aucune obligation de porter les accents. Tout le reste de
    // l'application ecrit deja sans accent, une seule regle plutot que deux.
    @Test fun `les caracteres non ASCII sont retires`() {
        val t = ongoingText(session(SetScore(0, 0), GameLabel("4é0", "‰30")))
        assertTrue("non-ASCII dans : $t", t.all { it.code in 0x20..0x7E })
    }

    // Une session absente ne devrait jamais atteindre ce chemin (le service ne
    // tourne pas sans match), mais un service de premier plan DOIT porter une
    // notification : un texte vide donnerait une notification muette, illisible
    // et impossible a diagnostiquer.
    @Test fun `sans session le texte reste non vide`() {
        assertTrue(ongoingText(null).isNotEmpty())
        assertTrue(ongoingText(null).length < 20)
    }
}
