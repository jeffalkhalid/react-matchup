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

    // Le deliage n'a PAS de test a lui ici, et c'est voulu : unpair() met
    // _session a null, donc il emprunte exactement le predicat ci-dessus. Le
    // maillon qui pourrait casser -- "unpair() vide bien la session" -- n'est
    // pas dans ce fichier : il est fige par MatchStoreTest, "token_revoked
    // delie la montre et vide la file" (assertNull(s.session.value)). Un test
    // de plus ici n'aurait reaffirme que `shouldShowOngoing(null) == false`,
    // deja couvert, en pretendant couvrir autre chose.

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

    // ASCII pur : la police du cadran, choisie par le systeme et non par nous,
    // n'a aucune obligation de porter les accents. Tout le reste de
    // l'application ecrit deja sans accent, une seule regle plutot que deux.
    @Test fun `les caracteres non ASCII sont retires`() {
        val t = ongoingText(session(SetScore(0, 0), GameLabel("4é0", "‰30")))
        assertTrue("non-ASCII dans : $t", t.all { it.code in 0x20..0x7E })
    }

    // ---- Debordement : on perd le jeu, jamais le score --------------------

    // Tronquer l'assemblage rognait par la DROITE, donc dans le score
    // ("Sets 10-10 Jeu 40-3"). La pastille se mettait a mentir sur la seule
    // chose qu'elle existe pour dire.
    @Test fun `un texte trop long perd la clause du jeu, pas des chiffres du score`() {
        val t = ongoingText(session(SetScore(0, 0), GameLabel("BEAUCOUPTROPLONG", "PAREIL")))
        assertEquals("Sets 0-0", t)
        assertTrue(t.length < 20)
    }

    // ---- Un cote vide n'est pas un score ---------------------------------

    // Le garde-fou testait la chaine assemblee (`!= "-"`), donc ne voyait que
    // le cas ou les DEUX cotes manquaient. Un seul cote vide donnait "Jeu -5" :
    // un texte qui ressemble a un score sans en etre un.
    @Test fun `un game_label a moitie vide ne s'affiche pas`() {
        assertEquals("Sets 0-0", ongoingText(session(gameLabel = GameLabel("", "5"))))
        assertEquals("Sets 0-0", ongoingText(session(gameLabel = GameLabel("40", ""))))
    }

    // ---- Degradation honnete quand le serveur se tait ---------------------

    // Le jeu en cours bouge toutes les 30 s : passe trois minutes sans
    // confirmation, "40-30" est tres probablement faux. Les sets, eux,
    // vieillissent bien. Grossier et vrai plutot que precis et faux.
    @Test fun `apres le seuil de peremption on cesse d'annoncer le jeu`() {
        val s = session(SetScore(1, 0), GameLabel("40", "30"))
        assertEquals("Sets 1-0 Jeu 40-30", ongoingText(s, ONGOING_STALE_MS - 1))
        assertEquals("Sets 1-0", ongoingText(s, ONGOING_STALE_MS))
    }

    // Une seule requete perdue ne doit rien degrader : le seuil vaut trois
    // battements lents, pas un.
    @Test fun `un age nul ou faible n'altere rien`() {
        val s = session(SetScore(1, 0), GameLabel("40", "30"))
        assertEquals("Sets 1-0 Jeu 40-30", ongoingText(s, 0L))
        assertEquals("Sets 1-0 Jeu 40-30", ongoingText(s, OngoingMatch.SLOW_TICK_MS))
    }

    // ---- Echec de publication : on perd la pastille, jamais le match ------

    // Un service qui ne rappelle pas startForeground() dans les cinq secondes
    // est tue par le systeme AVEC son processus -- donc avec l'application qui
    // compte les points. Jamais devenu premier plan, il doit se retirer lui-meme.
    @Test fun `un refus avant tout affichage fait renoncer le service`() {
        assertTrue(shouldGiveUpOnPostFailure(false))
    }

    // Deja au premier plan, l'echec ne concerne qu'une MISE A JOUR : la
    // notification precedente est encore affichee et encore a peu pres vraie.
    // La retirer echangerait une perte de fraicheur contre la panne complete.
    @Test fun `un refus de mise a jour ne retire pas une pastille qui marche`() {
        assertFalse(shouldGiveUpOnPostFailure(true))
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
