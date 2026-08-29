package com.pagmatch.wear.ui

import org.junit.Assert.assertEquals
import org.junit.Test

// Fix round 1 sur ce screen : `val s = session ?: return` faisait
// disparaitre l'ecran de confirmation SANS UN MOT (pas de texte, pas de
// "Non", pas de "Oui") des que la session s'effacait pendant qu'il etait
// ouvert -- ce que le battement de 5 s de MatchStore peut declencher a tout
// instant (le partenaire valide depuis son telephone, ou un essai qui
// semblait avoir echoue avait en realite abouti cote serveur), sans le
// moindre rapport avec la reponse du "Oui" de CET ecran. C'est exactement le
// "ne doit jamais paraitre inerte" que la conception de cet ecran interdit
// pour un refus serveur, atteint ici par une perte de session.
//
// sessionLostText() est la decision testable hors Compose derriere le
// correctif : elle garantit qu'un texte non vide est toujours produit, avec
// priorite au dernier refus/panne connu (toujours vrai, meme apres coup) sur
// le mot generique.
class ConfirmScreenTest {

    @Test fun `session perdue sans refus en attente dit Match termine`() {
        assertEquals("Match termine", sessionLostText(null))
    }

    // Le dernier refus/panne affiche reste vrai meme si la session a
    // disparu depuis (ex: "Deliee" apres un token_revoked) : l'ecraser par
    // un mot generique serait moins informatif, jamais plus.
    @Test fun `session perdue avec un refus en attente le garde`() {
        assertEquals("Montre deliee", sessionLostText("Montre deliee"))
    }
}
