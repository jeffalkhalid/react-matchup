package com.pagmatch.wear.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
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
        // padding : sans lui ce texte touchait les deux bords. Il est au
        // CENTRE vertical, donc sur la corde la plus large d'un cadran rond --
        // le cas le moins expose de l'ecran, mais un message plus long
        // (Api.reasonPair) n'avait aucune marge pour grandir.
        Box(Modifier.fillMaxSize().padding(horizontal = 12.dp), contentAlignment = Alignment.Center) {
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
            //
            // weight(1f) N'EST PAS DECORATIF. Sans lui ce Text se mesurait a sa
            // largeur INTRINSEQUE : un message long ("Plus dans ce match",
            // "Fonction desactivee") depassait la place laissee par les deux
            // boutons, SpaceBetween n'avait plus d'espace a distribuer, et le
            // texte passait litteralement PAR-DESSUS le bouton "OK" -- vu sur
            // une capture (small_07_match_long_msg), pas devine. Contraint a
            // l'espace restant, il s'abrege proprement avec ses points de
            // suspension, qui n'ont jamais pu s'afficher jusqu'ici.
            Text(
                message ?: gameLabelText(s) ?: "",
                modifier = Modifier.weight(1f).padding(horizontal = 4.dp),
                textAlign = TextAlign.Center,
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

// Largeur maximale accordee au NOM d'equipe, en fraction de la largeur utile
// de la moitie.
//
// Sur un cadran ROND, le systeme decoupe la fenetre au disque : tout ce qui
// depasse la corde n'est pas abrege, il est TRANCHE EN PLEIN MILIEU D'UNE
// LETTRE, sans le moindre point de suspension pour le signaler. Le nom de
// l'equipe du HAUT est l'element le plus expose de l'ecran (il est en haut de
// sa moitie, donc tout pres du bord, la ou la corde est la plus courte) :
// "Abderrahmane & Jean-Philippe" s'affichait "errahmane & Jean" -- ni le
// debut ni la fin, et rien a l'ecran pour dire qu'il manquait quelque chose.
// Mesure sur l'emulateur rond 384 px : a la hauteur de cette ligne, un texte
// de 218 px passe intact, 251 px est tranche. 0.56 de la largeur utile
// (364 px) fait 204 px, sous le seuil mesure, avec de la marge.
//
// C'est une regle de FORME (rond contre carre), pas un cas particulier de
// modele : elle vaut pour tout cadran rond, quelle que soit sa taille. Le
// grand rond place cette ligne RELATIVEMENT plus bas (la rangee du milieu a
// une hauteur fixe en dp, donc elle occupe une part plus petite d'un grand
// ecran), donc la meme fraction y est encore plus prudente. Sur un cadran
// carre, aucun bord ne mord : la largeur entiere est disponible.
@Composable
private fun nameWidthFraction(): Float =
    if (LocalConfiguration.current.isScreenRound) 0.56f else 1f

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
             modifier = Modifier.fillMaxWidth(nameWidthFraction()),
             textAlign = TextAlign.Center,
             style = MaterialTheme.typography.caption1)
        Text(if (line.isEmpty()) "$won" else line,
             style = MaterialTheme.typography.display3, maxLines = 1)
    }
}
