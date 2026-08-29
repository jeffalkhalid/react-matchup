package com.pagmatch.wear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// Payload reconstruit fidelement depuis fn_watch_payload
// (supabase/migrations/watch_team_initials.sql), verifie contre trois
// sources : le SQL lui-meme, les types LiveState/SetScore de
// lib/liveScore.ts, et le consommateur Garmin de production
// (watch/source/SessionView.mc), qui indexe explicitement sw["t1"]/sw["t2"]
// et g["t1"]/g["t2"] -- confirmant que sets_won ET game_label sont des
// OBJETS {t1,t2}, jamais un tableau ni une chaine preformatee.
//
// Scenario : 3e manche points d'un match 2v2, 1 set partout, jeu en cours a
// 30-15 pour l'equipe 1, la montre a la main.
class SessionTest {
    private val payload = """
    {"has_session":true,"session_id":"11111111-1111-1111-1111-111111111111",
     "scoring_mode":"points","is_scorer":true,"input_device":"watch",
     "team1":"Karim & Ali","team2":"Youssef & Omar",
     "team1_short":"K&A","team2_short":"Y&O",
     "sets":[{"t1":6,"t2":4},{"t1":4,"t2":6},{"t1":0,"t2":0}],
     "sets_won":{"t1":1,"t2":1},
     "current_game":{"t1":2,"t2":1},"game_label":{"t1":"30","t2":"15"},
     "golden_point":true,"tie_break":false,
     "match_decided":false,"finished":false,"contest_count":0}
    """

    @Test fun `lit une session complete`() {
        val s = parseSession(payload)!!
        assertEquals("points", s.scoringMode)
        assertEquals("Karim & Ali", s.team1)
        assertEquals("K&A", s.team1Short)
        assertEquals(3, s.sets.size)
        assertEquals(6, s.sets[0].t1)
        assertEquals(4, s.sets[0].t2)
        // sets_won est un OBJET {t1,t2} (jsonb_build_object cote SQL), pas un
        // tableau [1,1] : c'est le point que ce test existe pour verrouiller.
        assertEquals(1, s.setsWon.t1)
        assertEquals(1, s.setsWon.t2)
        assertEquals(2, s.currentGame?.t1)
        assertEquals(1, s.currentGame?.t2)
        // game_label est lui aussi un OBJET {t1,t2} de texte ("0".."40","AV"),
        // pas une chaine "30 - 15" deja composee : c'est la montre (Garmin)
        // qui assemble le tiret, cote client.
        assertEquals("30", s.gameLabel?.t1)
        assertEquals("15", s.gameLabel?.t2)
        assertTrue(s.isScorer)
        assertTrue(s.goldenPoint)
        assertFalse(s.tieBreak)
        assertFalse(s.matchDecided)
        assertFalse(s.finished)
    }

    @Test fun `absence de session renvoie null`() {
        assertNull(parseSession("""{"has_session":false}"""))
        assertNull(parseSession(null))
        assertNull(parseSession("pas du json"))
    }

    @Test fun `une cle manquante ne fait pas planter`() {
        val s = parseSession("""{"has_session":true,"session_id":"x","team1":"A","team2":"B"}""")!!
        assertEquals("x", s.sessionId)
        assertTrue(s.sets.isEmpty())
        assertNull(s.gameLabel)
        assertEquals(0, s.setsWon.t1)
        assertEquals(0, s.setsWon.t2)
        assertNull(s.currentGame)
    }
}
