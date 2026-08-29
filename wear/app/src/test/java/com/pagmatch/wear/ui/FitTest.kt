package com.pagmatch.wear.ui

import org.junit.Assert.assertEquals
import org.junit.Test

// Les deux decisions de mise en page qui dependent de la PLACE REELLE sont
// des fonctions pures : elles se testent ici, sans emulateur et sans Compose.
// La fonction de mesure est remplacee par une largeur fixe par signe, ce qui
// suffit a verifier la DECISION (le vrai TextMeasurer, lui, mesure la police
// exacte a l'execution).
class FitTest {

    // ~9.4 px par signe : la mesure faite sur l'emulateur carre 180 dp pour
    // caption2 (12sp a la densite 2). "Plus le scoreur" = 15 signes = 141 px,
    // "Plus dans ce match" = 18 signes = 169 px, pour ~128 px disponibles.
    private val perChar = 9.4
    private fun w(s: String): Int = Math.round(s.length * perChar).toInt()

    @Test fun `le libelle riche est garde quand il tient`() {
        assertEquals(
            "Plus dans ce match",
            fitLabel("Plus dans ce match", "Hors match", 300, ::w)
        )
    }

    // Le defaut corrige : sur le carre, "Plus le scoreur" et
    // "Plus dans ce match" devenaient tous les deux une bouillie tronquee
    // impossible a distinguer. Leurs variantes courtes, elles, tiennent et
    // disent chacune sa chose.
    @Test fun `la variante courte prend le relais quand le riche ne tient pas`() {
        assertEquals("Hors match", fitLabel("Plus dans ce match", "Hors match", 128, ::w))
        assertEquals("Pas toi", fitLabel("Plus le scoreur", "Pas toi", 128, ::w))
    }

    // Deux messages differents restent deux textes differents : c'est tout
    // l'objet du correctif, la troncature les confondait.
    @Test fun `deux motifs differents restent distinguables sur un ecran etroit`() {
        val a = fitLabel("Plus dans ce match", "Hors match", 128, ::w)
        val b = fitLabel("Plus le scoreur", "Pas toi", 128, ::w)
        assertEquals(false, a == b)
    }

    // Pas de variante courte (ex : "Bloque : 3" avant qu'on lui en donne une,
    // ou le score du jeu en cours) : on rend le texte tel quel et c'est
    // l'ellipse de Compose qui prend le relais. Jamais de repli invente.
    @Test fun `sans variante courte on garde le texte tel quel`() {
        assertEquals("Reponse illisible", fitLabel("Reponse illisible", null, 40, ::w))
        assertEquals("Reponse illisible", fitLabel("Reponse illisible", "", 40, ::w))
    }

    // Largeur pas encore connue (contrainte non bornee, premiere mesure) : on
    // ne se rabat pas "au cas ou", ce serait perdre du texte sans mesure.
    @Test fun `largeur inconnue garde le libelle riche`() {
        assertEquals("Plus dans ce match", fitLabel("Plus dans ce match", "Hors match", 0, ::w))
        assertEquals(
            "Plus dans ce match",
            fitLabel("Plus dans ce match", "Hors match", Int.MAX_VALUE, ::w)
        )
    }

    // ---- Taille du score de l'ecran de confirmation -----------------------

    // ~18.6 px par signe a 20sp : mesure faite sur le carre 180 dp, ou
    // "6 3 6  /  4 6 2" (15 signes) occupait 279 px. La largeur utile de
    // l'ecran de confirmation y est de 360 - 2 x 10.dp = 320 px.
    private val confirmWidth = 320
    private fun ws(s: String, sp: Float): Int =
        Math.round(s.length * 18.6 * (sp / 20.0)).toInt()

    @Test fun `un score court garde la plus grande taille`() {
        assertEquals(20f, fitFontSizeSp("6 3  /  4 6", SCORE_SIZES_SP, confirmWidth, ::ws))
    }

    // Le cas qui justifie le correctif : un match en cinq sets sur le cadran
    // le plus etroit. En title1 il depasse -- tronque, il aurait affiche un
    // SCORE FAUX sur l'ecran d'une validation irreversible.
    @Test fun `un score de cinq sets retrecit au lieu d etre tronque`() {
        val score = "6 6 6 6 6  /  6 6 6 6 6"
        assertEquals("en title1 il deborde", true, ws(score, 20f) > confirmWidth)
        val sp = fitFontSizeSp(score, SCORE_SIZES_SP, confirmWidth, ::ws)
        assertEquals(true, sp < 20f)
        assertEquals("le score ENTIER tient a la taille choisie",
            true, ws(score, sp) <= confirmWidth)
    }

    // Meme sans palier suffisant, on rend le plus petit : l'ellipse de
    // l'appelant reste le garde-fou, mais on a d'abord tout essaye.
    @Test fun `aucun palier ne tient rend le plus petit`() {
        assertEquals(12f, fitFontSizeSp("6 6 6 6 6  /  6 6 6 6 6", SCORE_SIZES_SP, 30, ::ws))
    }
}
