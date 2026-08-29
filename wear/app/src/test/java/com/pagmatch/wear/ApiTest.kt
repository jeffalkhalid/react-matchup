package com.pagmatch.wear

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ApiTest {
    @Test fun `lit le message d un RAISE postgrest`() {
        assertEquals("not_the_scorer",
            Api.errorReason("""{"code":"P0001","message":"not_the_scorer"}"""))
    }

    @Test fun `lit le reason d un refus d appairage`() {
        assertEquals("code_invalid",
            Api.errorReason("""{"ok":false,"reason":"code_invalid"}"""))
    }

    @Test fun `renvoie null quand il n y a pas de refus`() {
        assertNull(Api.errorReason("""{"ok":true,"token":"abc"}"""))
        assertNull(Api.errorReason(null))
        assertNull(Api.errorReason("pas du json"))
    }

    @Test fun `chaque raison connue porte une forme riche et une forme courte`() {
        val p = Api.reasonPair("not_the_scorer")!!
        assertEquals("Plus le scoreur", p.first)
        assertEquals("Pas toi", p.second)
    }

    @Test fun `une raison inconnue ne casse rien`() {
        assertNull(Api.reasonPair("raison_jamais_vue"))
        assertNull(Api.reasonPair(null))
    }

    @Test fun `lit le token d un appairage reussi`() {
        assertEquals("abc123", Api.parseToken("""{"token":"abc123"}"""))
    }

    @Test fun `renvoie null sur un refus sans token`() {
        assertNull(Api.parseToken("""{"ok":false,"reason":"invalid_code"}"""))
    }

    @Test fun `renvoie null sur un corps illisible`() {
        assertNull(Api.parseToken("pas du json"))
        assertNull(Api.parseToken(""))
    }

    @Test fun `renvoie null quand il n y a pas de corps`() {
        assertNull(Api.parseToken(null))
    }
}
