package com.pagmatch.wear.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.*
import com.pagmatch.wear.MatchStore
import com.pagmatch.wear.Session

// Deux moities tactiles qui remplissent l'ecran, plus un bouton d'annulation
// VISIBLE entre les deux (jamais un geste cache). Toucher une moitie marque
// pour l'equipe qu'elle affiche -- l'ordre d'affichage (equipe 1 en haut,
// equipe 2 en bas) ne change jamais, donc la moitie haute appelle toujours
// store.score(1) et la basse toujours store.score(2) : le geste designe
// l'equipe telle qu'elle est montree, rien a memoriser.
//
// Modifier.clickable ne capture qu'un tapotement (appui + relachement sur
// place), jamais un balayage : le balayage vers la droite reste donc libre
// pour le retour systeme Wear OS, comme l'exige la regle de cet ecran.
@Composable
fun MatchScreen(store: MatchStore, onValidate: () -> Unit) {
    val session by store.session.collectAsState()
    val message by store.message.collectAsState()
    val s = session

    if (s == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text(message ?: "Aucun match en cours", textAlign = TextAlign.Center)
        }
        return
    }

    Column(Modifier.fillMaxSize()) {
        TeamHalf(s, 1, Modifier.weight(1f)) { store.score(1) }
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Bouton d'annulation VISIBLE, jamais un geste cache.
            CompactButton(onClick = { store.undo() }) { Text("<-") }
            // Priorite au message transitoire (accuse de point, refus, panne
            // reseau) ; a defaut, le score du jeu en cours en mode points.
            Text(
                message ?: gameLabelText(s) ?: "",
                style = MaterialTheme.typography.caption2,
                maxLines = 1, overflow = TextOverflow.Ellipsis
            )
            CompactButton(onClick = onValidate, enabled = s.matchDecided) { Text("OK") }
        }
        TeamHalf(s, 2, Modifier.weight(1f)) { store.score(2) }
    }
}

// game_label est un OBJET serveur {t1,t2} de JETONS TEXTE ("0".."40", "AV"),
// jamais une chaine deja composee (cf. fn_game_label, watch_rpcs.sql) :
// c'est au client d'assembler le tiret. Meme composition que la Garmin en
// production (watch/source/SessionView.mc : `g["t1"] + " - " + g["t2"]`),
// pour que les deux montres affichent le meme texte pour le meme match.
private fun gameLabelText(s: Session): String? =
    s.gameLabel?.let { "${it.t1} - ${it.t2}" }

// La couleur ne distingue jamais les equipes : seule leur POSITION le fait.
@Composable
private fun TeamHalf(s: Session, team: Int, modifier: Modifier, onTap: () -> Unit) {
    val name = if (team == 1) s.team1 else s.team2
    // sets_won est un OBJET serveur {t1,t2} (jsonb_build_object cote SQL),
    // jamais un tableau : cf. Session.kt et SessionTest, verifies contre
    // fn_watch_payload et le consommateur Garmin en production, qui indexe
    // explicitement sw["t1"]/sw["t2"].
    val won = if (team == 1) s.setsWon.t1 else s.setsWon.t2
    val line = s.sets.joinToString(" ") { if (team == 1) "${it.t1}" else "${it.t2}" }
    Column(
        modifier.fillMaxWidth().clickable(onClick = onTap).padding(horizontal = 10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text(name, maxLines = 1, overflow = TextOverflow.Ellipsis,
             style = MaterialTheme.typography.caption1)
        Text(if (line.isEmpty()) "$won" else line,
             style = MaterialTheme.typography.display3, maxLines = 1)
    }
}
