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
    val messageShort by store.messageShort.collectAsState()
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
            //
            // Le libelle RICHE d'abord, sa variante courte seulement s'il ne
            // tient pas (voir fitLabel dans Fit.kt). Ce n'est pas la meme
            // chose que de couper : "Plus le scoreur" et "Plus dans ce match"
            // deviennent tous les deux "Plus dan..."/"Plus le sc..." sur le
            // carre, donc IMPOSSIBLES A DISTINGUER l'un de l'autre -- alors
            // que ce sont exactement les deux messages qui expliquent pourquoi
            // le point qu'on vient de taper n'a pas compte. "Pas toi" et
            // "Hors match" tiennent, eux, et disent chacun sa chose.
            // Pas de padding horizontal ICI : les deux CompactButton mesurent
            // 48.dp (la cible tactile minimale de la plateforme) pour un
            // cercle DESSINE de 32.dp, donc 8.dp de vide invisible separent
            // deja le texte de chaque bouton -- 16 px de chaque cote sur les
            // trois cadrans, mesures sur capture. Les 4.dp qu'on ajoutait
            // par-dessus n'ecartaient rien de plus, ils prenaient 16 px sur
            // les ~230 px de la rangee, assez pour faire basculer
            // "Plus dans ce match" (218 px mesures) dans sa variante courte
            // sur le GRAND rond, ou il tient. L'ecart visible reste le meme,
            // la phrase entiere revient.
            FittedLabel(
                long = message ?: gameLabelText(s) ?: "",
                short = if (message != null) messageShort else null,
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.caption2
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
// de la moitie. DEUX fractions, pas une : les deux moities ne sont pas dans
// la meme situation geometrique, et leur donner la meme valeur abimait celle
// qui n'avait aucun probleme.
//
// Sur un cadran ROND, le systeme decoupe la fenetre au disque : tout ce qui
// depasse la corde n'est pas abrege, il est TRANCHE EN PLEIN MILIEU D'UNE
// LETTRE, sans le moindre point de suspension pour le signaler. Dans chaque
// moitie le nom est AU-DESSUS du score : cela le place tout pres du bord dans
// la moitie HAUTE (corde courte), et au contraire pres du centre dans la
// moitie BASSE (corde longue). Mesure sur le 384 rond, sur la capture
// `small_06_match_long.raw.png` :
//
//   nom du HAUT  -- premiere ligne peinte a 166.5 px du centre : corde 191 px
//   nom du BAS   -- premiere ligne peinte a  73.5 px du centre : corde 355 px
//                   (et 334 px a la ligne des jambages, la plus basse)
//
// La ligne mesuree est celle des HAMPES (le haut des M, H, N, K, l, b, d),
// PAS la ligne de base. C'est la correction du calcul precedent : la corde
// vaut 251 px a la ligne de base mais seulement 191 px 21 px plus haut, la ou
// vivent les hampes. Une fraction derivee de la ligne de base laissait donc
// raboter jusqu'a 6 px du montant de la premiere lettre d'un nom commencant
// par une majuscule pleine hauteur -- et "Abderrahma..." ne paraissait propre
// que parce qu'un A capital est etroit en haut.
//
// Largeur utile d'une moitie sur le 384 rond : 384 - 2 x 10.dp = 344 px.
//   HAUT : 0.50 x 344 = 172 px pour 191 px de corde -> ~10 px de marge/cote.
//   BAS  : 0.85 x 344 = 292 px pour 334 px de corde -> ~21 px de marge/cote.
// Sur le 454 rond (largeur utile 414 px) : 207 px pour 267 px de corde en
// haut, 352 px pour 394 px en bas. Les deux fractions passent sur les deux
// tailles rondes.
//
// C'est une regle de FORME (rond contre carre) et de POSITION (haut contre
// bas), pas un cas particulier de modele : rien ici ne lit la marque, la
// definition ni le nom de l'appareil. Sur un cadran carre, aucun bord ne
// mord : la largeur entiere est disponible dans les deux moities.
@Composable
private fun nameWidthFraction(team: Int): Float =
    if (!LocalConfiguration.current.isScreenRound) 1f
    else if (team == 1) 0.50f else 0.85f

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
             modifier = Modifier.fillMaxWidth(nameWidthFraction(team)),
             textAlign = TextAlign.Center,
             style = MaterialTheme.typography.caption1)
        Text(if (line.isEmpty()) "$won" else line,
             style = MaterialTheme.typography.display3, maxLines = 1)
    }
}
