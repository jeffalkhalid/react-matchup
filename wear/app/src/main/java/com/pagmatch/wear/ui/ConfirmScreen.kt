package com.pagmatch.wear.ui

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.*
import com.pagmatch.wear.FinalizeResult
import com.pagmatch.wear.MatchStore

// Ecran de confirmation avant de valider le score depuis la montre.
// Siblings : watch/source/ConfirmView.mc (Garmin, en prod) pour le PROPOS de
// l'ecran -- action irreversible, deux appuis distincts, refus serveur lu en
// clair -- mais pas pour la mecanique tactile : la Garmin dessine sa propre
// cible de toucher a la main (pas de Wear Compose la-bas), ici les deux
// Button() de androidx.wear.compose.material la remplacent.
//
// ATTEINDRE cet ecran est deja deliberate : MatchScreen n'active son bouton
// "OK" que si `s.matchDecided` (le serveur a lui-meme un vainqueur et assez de
// sets). CONFIRMER l'est aussi : deux boutons distincts ("Non" a gauche,
// facile et sans danger ; "Oui" a droite), jamais un appui reflexe qui vaudrait
// validation.
//
// Aucun geste ne remplace "Non" : ni pointerInput, ni draggable, ni
// BackHandler ne sont poses ici (voir PairingScreen, meme regle) --
// le balayage vers la droite reste la propriete du systeme Wear OS.

// Texte affiche quand la session s'est videe PENDANT que cet ecran etait
// ouvert : le partenaire a valide depuis son telephone, ou un essai qui
// semblait avoir echoue (panne reseau, timeout) a en realite abouti cote
// serveur. watch_current_session ne renvoie une session que tant que le
// match est "live" (voir le commentaire de tete de MatchStore.finalize) : le
// battement de 5 s peut donc faire disparaitre la session A TOUT MOMENT,
// y compris pendant que cet ecran est affiche, sans le moindre rapport avec
// l'appel a finalize() lance depuis ICI.
//
// FONCTION PURE, testee hors Compose (ConfirmScreenTest) : c'est elle qui
// garantit que l'ecran ne reste JAMAIS silencieux dans ce cas -- avant ce
// correctif, `val s = session ?: return` faisait disparaitre le texte, les
// boutons ET le message en attente d'un coup, sans le moindre mot ni le
// moindre moyen de sortir autrement que par le balayage systeme. C'est
// exactement le "ne doit jamais paraitre inerte" que la conception de cet
// ecran interdit pour une reponse serveur, atteint ici par une perte de
// session plutot que par une reponse.
//
// Un refus/une panne DEJA affiche (`pendingError`) reste prioritaire sur le
// mot generique : il reste vrai (le dernier essai a bien echoue) meme si la
// session a disparu depuis, et le perdre serait moins informatif que le
// garder.
fun sessionLostText(pendingError: String?): String = pendingError ?: "Match termine"

// Largeur maximale accordee a la LIGNE DE STATUT ("Envoi...", refus, panne),
// en fraction de la largeur utile de l'ecran.
//
// Cette ligne est la seule dont la PRESENCE est conditionnelle : elle
// s'ajoute au bas d'une colonne centree verticalement, donc elle pousse tout
// le reste vers le haut ET se place elle-meme tout en bas, la ou la corde du
// cadran rond est courte. Sans contrainte de largeur elle se mesurait sur les
// 344 px de la colonne, alors que le verre n'en offre que 322 a la hauteur ou
// elle tombe : mesure sur le 384 rond, un motif serveur inconnu affiche tel
// quel ("watch_session_already_finalized", 31 signes) se repliait sur deux
// lignes dont la seconde ATTEIGNAIT le bord (marge -0.3 px, 5 pixels peints
// hors du disque) -- exactement le defaut que PairingScreen dit avoir referme
// pour de bon : une ligne conditionnelle qui pousse une colonne centree dans
// le biseau.
//
// 0.70 x 344 = 241 px : assez pour que le PLUS LONG libelle de la table
// Api.reasonPair ("Fonction desactivee", 19 signes, 224 px mesures) tienne
// encore sur UNE seule ligne -- donc aucun message connu ne se replie, et
// seul un motif inconnu peut encore prendre deux lignes, qui rentrent alors
// toutes les deux dans le disque (marge minimale mesuree 12.8 px).
// Regle de FORME, comme dans MatchScreen : sur un carre, aucun bord ne mord.
@Composable
private fun statusWidthFraction(): Float =
    if (LocalConfiguration.current.isScreenRound) 0.70f else 1f

// Meme raison pour le SCORE, une ligne plus haut. Il est deja centre
// verticalement, mais la ligne de statut le POUSSE vers le haut quand elle
// apparait, donc sa corde depend de ce qui s'affiche en dessous. Cas le pire
// mesure sur le 384 rond : un match en cinq sets ("6 6 6 6 6 / 6 6 6 6 6")
// PLUS un motif serveur inconnu sur deux lignes -- le score remontait a
// 86 px du centre, ou le verre n'offre plus que 343 px, et ses 328 px de
// chiffres laissaient 8.8 px au coin superieur gauche. 0.86 x 344 = 296 px
// ramene ce coin a ~21 px. Un score de deux ou trois sets, lui, ne bouge pas
// d'un pixel : il tient largement dans les 296 px et garde sa taille title1.
@Composable
private fun scoreWidthFraction(): Float =
    if (LocalConfiguration.current.isScreenRound) 0.86f else 1f

@Composable
fun ConfirmScreen(store: MatchStore, onCancel: () -> Unit, onDone: () -> Unit) {
    val session by store.session.collectAsState()
    var busy by remember { mutableStateOf(false) }
    // Verdict une fois la reponse connue (refus ou panne). Pendant l'envoi,
    // c'est `busy` seul qui pilote le texte affiche ("Envoi...") : les deux
    // ne sont jamais confondus, sinon un ancien refus resterait visible,
    // colore comme une erreur, pendant qu'un DEUXIEME essai est en cours.
    var error by remember { mutableStateOf<String?>(null) }
    val s = session

    if (s == null) {
        // Voir sessionLostText ci-dessus : dire quelque chose de vrai, et
        // laisser un moyen de sortir. "OK" plutot que "Non" -- il n'y a plus
        // rien a annuler, seulement a quitter un ecran devenu sans objet.
        // onCancel (jamais onDone) : on ne pretend pas avoir valide quoi que
        // ce soit depuis CET ecran.
        Column(
            Modifier.fillMaxSize().padding(10.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Text(
                sessionLostText(error), textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(statusWidthFraction()),
                style = MaterialTheme.typography.caption1,
                maxLines = 2, overflow = TextOverflow.Ellipsis
            )
            Spacer(Modifier.height(8.dp))
            Button(onClick = onCancel) { Text("OK") }
        }
        return
    }

    val score1 = s.sets.joinToString(" ") { "${it.t1}" }
    val score2 = s.sets.joinToString(" ") { "${it.t2}" }

    Column(
        Modifier.fillMaxSize().padding(10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text("Valider le score ?", style = MaterialTheme.typography.caption1)
        Spacer(Modifier.height(4.dp))
        // title1 plutot que title3 : sur l'ecran d'une action IRREVERSIBLE,
        // la chose a verifier avant d'appuyer est le score, pas la question.
        // En title3 (16sp) il ne depassait la question (caption1, 14sp gras)
        // que de deux points -- la question pesait visuellement autant que ce
        // qu'elle demande de relire. La regle "le score est l'element le plus
        // gros" vaut ici aussi, pas seulement sur l'ecran de match.
        // FittedScore, pas un Text tronque : `maxLines = 1` + Ellipsis etait la
        // MAUVAISE politique de debordement sur le seul element que cet ecran
        // existe pour faire relire. Un score coupe ("6 6 6 6 6 / 6...") n'est
        // pas une abreviation signalee, c'est un score FAUX presente comme
        // celui qu'on s'apprete a valider irreversiblement. Il retrecit donc
        // au lieu d'etre coupe (voir ui/Fit.kt).
        FittedScore("$score1  /  $score2", Modifier.fillMaxWidth(scoreWidthFraction()))
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            // Facile, sans risque, toujours actif : annuler ne doit jamais
            // etre bloque par `busy`, un envoi en vol peut prendre du temps
            // sur un lien Bluetooth lent et l'utilisateur doit pouvoir sortir
            // de cet ecran a tout moment sans que cela ne valide quoi que ce
            // soit (voir MatchStore.finalize : onCancel ne parle jamais au
            // serveur).
            Button(onClick = onCancel) { Text("Non") }
            Button(enabled = !busy, onClick = {
                busy = true
                error = null
                // finalize() ne connait que trois issues (voir FinalizeResult
                // dans MatchStore) : succes, refus METIER du serveur (le
                // score ne vaut rien, rejouer ne changerait rien), ou panne
                // d'infrastructure/reseau (le score n'a pas ete juge, rejouer
                // peut marcher). Confondre les deux dernieres ferait croire a
                // un rejet sur le fond la ou le serveur n'a simplement pas pu
                // etre joint -- exactement le piege que le brouillon initial
                // de cette tache reproduisait en lisant le corps seul.
                store.finalize { result ->
                    busy = false
                    when (result) {
                        is FinalizeResult.Success -> onDone()
                        is FinalizeResult.Refused -> error = result.message
                        is FinalizeResult.Unreachable -> error = result.message
                    }
                }
            }) { Text("Oui") }
        }
        // Une seule ligne, dont le CONTENU (jamais la couleur seule) porte le
        // sens : "Envoi..." pendant l'envoi (couleur neutre -- ce n'est pas
        // une erreur), sinon le message renvoye par MatchStore.finalize
        // (couleur d'erreur, simple mise en avant visuelle : le texte lui-
        // meme distingue deja un refus METIER d'une panne, jamais la couleur
        // seule). Meme regle de gabarit que Api.reasonPair : ASCII, court, ne
        // jamais rogner sur le plus petit cadran.
        val shown = if (busy) "Envoi..." else error
        if (shown != null) {
            Spacer(Modifier.height(4.dp))
            Text(
                shown,
                modifier = Modifier.fillMaxWidth(statusWidthFraction()),
                color = if (busy) MaterialTheme.colors.onSurface else MaterialTheme.colors.error,
                style = MaterialTheme.typography.caption2, textAlign = TextAlign.Center,
                maxLines = 2, overflow = TextOverflow.Ellipsis
            )
        }
    }
}
