package com.pagmatch.wear.ui

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.*
import com.pagmatch.wear.*
import kotlinx.coroutines.launch

// Saisie du code a 6 chiffres, un chiffre a la fois. Chaque chiffre se regle
// avec -/+, et on se deplace entre les chiffres avec </> (le swipe vers la
// droite est reserve au retour systeme Wear OS, donc la navigation arriere
// passe par un bouton explicite, pas un geste).
@Composable
fun PairingScreen(prefs: Prefs, onPaired: () -> Unit) {
    var digits by remember { mutableStateOf(IntArray(6)) }
    var index by remember { mutableStateOf(0) }
    var status by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    // Toute interaction volontaire efface un message d'echec precedent : un
    // "Code invalide" encore affiche pendant que l'utilisateur corrige un
    // chiffre serait trompeur (echec de quel essai, l'ancien ou le nouveau ?).
    fun clearStatus() { if (!busy) status = null }

    Column(
        Modifier.fillMaxSize().padding(8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        // Une seule ligne de texte en haut, dont le CONTENU change plutot que
        // sa presence : la consigne par defaut, remplacee par le message
        // d'echec ("Code invalide", "Pas de reseau"...) quand il y en a un.
        // Un cadran rond de 192dp de diametre laisse tres peu de marge
        // verticale (voir aussi le chiffre actif colore ci-dessous, qui
        // evite une ligne "Chiffre X/6" en plus) : ajouter une DEUXIEME ligne
        // sous les boutons uniquement en cas d'echec faisait remonter cette
        // ligne du haut jusque dans la zone que le verre rond rogne --
        // repere avec une vraie capture ecran, pas en theorie. Hauteur fixe
        // du coup, que le message soit affiche ou non.
        //
        // La consigne par defaut etait "Code affiche dans l app" (23 signes).
        // Sur le petit cadran rond, le systeme decoupe la fenetre au disque a
        // cette hauteur : le "C" et le dernier "p" etaient RABOTES a la
        // verticale, en plein milieu de la lettre (mesure : 254 px de texte
        // pour 206 px de corde). Un decoupage franc, sans point de suspension,
        // exactement comme pour le nom d'equipe de MatchScreen. La consigne
        // est donc raccourcie a "Code dans l app" (15 signes, ~172 px) : elle
        // dit la meme chose et rentre avec de la marge. Le plus long message
        // d'echec de la table Api.reasonPair, "Fonction desactivee"
        // (19 signes, 218 px mesures), passe intact -- verifie par capture,
        // pas suppose. maxLines/Ellipsis empechent en plus qu'un message
        // futur plus long ne se replie sur une DEUXIEME ligne, ce qui
        // ferait remonter tout l'ecran dans la zone rognee (le defaut deja
        // corrige en Task 5, ici referme pour de bon).
        val isFailure = status != null && status != "..."
        Text(status ?: "Code dans l app", textAlign = TextAlign.Center,
             color = if (isFailure) MaterialTheme.colors.error else MaterialTheme.colors.onSurface,
             maxLines = 1, overflow = TextOverflow.Ellipsis,
             style = MaterialTheme.typography.caption2)
        Spacer(Modifier.height(2.dp))
        // Le chiffre en cours d'edition est SOULIGNE plutot que signale par une
        // ligne "Chiffre X/6" separee : meme information, une ligne de texte
        // en moins.
        //
        // Le soulignement, pas la couleur, est ce qui PORTE l'information.
        // Le chiffre actif etait auparavant distingue par sa seule couleur --
        // regle du projet : la couleur decore, elle n'informe jamais (soleil
        // de plein midi, daltonisme, mode ambiant en niveaux de gris : la
        // couleur peut disparaitre, la position du curseur non). Le
        // soulignement se dessine DANS la hauteur de ligne existante : aucune
        // hauteur ajoutee, donc aucun risque de faire remonter la ligne du
        // haut dans la zone que le verre rond rogne. La couleur reste, en
        // renfort.
        Row {
            digits.forEachIndexed { i, d ->
                Text(d.toString(), style = MaterialTheme.typography.display2,
                     textDecoration = if (i == index) TextDecoration.Underline else null,
                     color = if (i == index) MaterialTheme.colors.primary
                             else MaterialTheme.colors.onSurface)
            }
        }
        Spacer(Modifier.height(4.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Button(enabled = !busy, modifier = Modifier.size(46.dp), onClick = {
                clearStatus()
                digits = digits.clone().also { it[index] = (it[index] + 9) % 10 }
            }) { Text("-") }
            Button(enabled = !busy, modifier = Modifier.size(46.dp), onClick = {
                clearStatus()
                digits = digits.clone().also { it[index] = (it[index] + 1) % 10 }
            }) { Text("+") }
        }
        Spacer(Modifier.height(4.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            // Sans ce bouton, une fois arrive au dernier chiffre il etait
            // impossible de revenir corriger un chiffre precedent : le seul
            // recours etait de tuer l'app, sans rien a l'ecran pour le
            // suggerer. Desactive au premier chiffre (rien a quoi revenir).
            Button(enabled = !busy && index > 0, modifier = Modifier.size(46.dp), onClick = {
                clearStatus()
                index--
            }) { Text("<") }
            Button(enabled = !busy, modifier = Modifier.size(46.dp), onClick = {
                if (index < 5) {
                    clearStatus()
                    index++
                } else {
                    busy = true; status = "..."
                    scope.launch {
                        val res = try {
                            Api.redeem(digits.joinToString(""), Config.deviceLabel())
                        } catch (e: Exception) {
                            // Une montre Wear OS n'a le plus souvent pas de reseau
                            // propre : elle passe par le telephone en Bluetooth.
                            // Une IOException ici (hors-portee, telephone eteint,
                            // timeout) est donc courante, pas exotique. Sans ce
                            // catch, Api.post()/execute() la laissait remonter et
                            // l'app plantait purement et simplement -- pire que
                            // l'attente infinie que ce meme ecran evite deja par
                            // ailleurs (busy/status).
                            status = "Pas de reseau"
                            busy = false
                            index = 0
                            return@launch
                        }
                        // redeem_watch_pairing_code repond 200 meme pour un
                        // refus ({"ok":false,"reason":...}) : c'est le corps,
                        // pas le statut, qui porte le verdict ici. Le statut
                        // n'est lu que par la boucle d'envoi (MatchStore).
                        val body = res.body
                        val reason = Api.errorReason(body)
                        if (reason != null) {
                            status = Api.reasonPair(reason)?.first ?: reason
                            busy = false
                            // Le code refuse a peut-etre expire (validite 5 min) :
                            // on replace le curseur au premier chiffre pour qu'un
                            // code entierement nouveau puisse etre saisi tout de
                            // suite, sans devoir remonter chiffre par chiffre avec
                            // "<". Les chiffres saisis restent affiches : si un
                            // seul etait fautif, il n'y a que lui a corriger.
                            index = 0
                        } else {
                            val t = Api.parseToken(body)
                            if (t == null) {
                                status = "Reponse illisible"
                                busy = false
                                index = 0
                            } else {
                                prefs.token = t
                                onPaired()
                            }
                        }
                    }
                }
            }) { Text(if (index < 5) ">" else "OK") }
        }
    }
}
