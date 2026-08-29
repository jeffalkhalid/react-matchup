package com.pagmatch.wear.ui

import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text

// ---------------------------------------------------------------------------
// Choisir en fonction de la PLACE REELLE, pas d'un modele de montre.
// ---------------------------------------------------------------------------
//
// Deux decisions reviennent partout sur un cadran de montre : "ce libelle
// tient-il, sinon lequel prendre ?" et "quelle taille de caractere fait tenir
// cette ligne ?". Les deux sont ici, en fonctions PURES : elles ne connaissent
// ni police ni ecran, on leur passe une fonction de MESURE. Compose la remplit
// avec un vrai TextMeasurer (mesure exacte, dans la police et le style
// effectivement dessines) ; un test la remplit avec une largeur par caractere.
// Elles decident, elles ne dessinent pas -- c'est ce qui les rend verifiables
// sans emulateur.
//
// Ce n'est PAS un cas particulier de modele : rien ici ne lit la marque, la
// definition ni le nom de l'appareil. La seule entree est le nombre de pixels
// que la mise en page laisse, quel que soit l'appareil qui les fournit.

// Le libelle riche s'il tient, sa variante courte sinon.
//
// Pourquoi pas la variante courte partout : sur un grand cadran rond
// "Plus dans ce match" tient EN ENTIER, et le remplacer par "Hors match"
// appauvrirait un ecran qui avait la place de dire la phrase complete.
// Pourquoi pas le libelle riche partout : sur le carre 180 dp, la rangee du
// milieu ne laisse que ~128 px, ou "Plus le scoreur" devient "Plus le sc..."
// et "Plus dans ce match" devient "Plus dan..." -- deux messages qui disent
// POURQUOI le tapotement qu'on vient de faire n'a pas compte, rendus
// INDISTINGUABLES l'un de l'autre. Les points de suspension prouvent qu'on a
// coupe ; ils ne delivrent pas la phrase.
fun fitLabel(long: String, short: String?, maxWidthPx: Int, widthOf: (String) -> Int): String {
    if (short.isNullOrEmpty() || short == long) return long
    // Largeur inconnue (contrainte non bornee) : on ne devine pas, on garde le
    // libelle riche -- se rabattre "au cas ou" serait perdre du texte sans
    // aucune mesure pour le justifier.
    if (maxWidthPx <= 0 || maxWidthPx == Int.MAX_VALUE) return long
    return if (widthOf(long) <= maxWidthPx) long else short
}

// La plus grande taille de la liste qui fait tenir le texte sur une ligne.
//
// `candidatesSp` est donnee du plus grand au plus petit. Si aucune ne tient,
// on rend la plus petite : c'est le dernier recours, et l'appelant garde ses
// points de suspension pour le signaler.
fun fitFontSizeSp(
    text: String,
    candidatesSp: List<Float>,
    maxWidthPx: Int,
    widthOf: (String, Float) -> Int
): Float {
    require(candidatesSp.isNotEmpty()) { "candidatesSp vide" }
    if (maxWidthPx <= 0 || maxWidthPx == Int.MAX_VALUE) return candidatesSp.first()
    for (sp in candidatesSp) if (widthOf(text, sp) <= maxWidthPx) return sp
    return candidatesSp.last()
}

// ---- Habillages Compose ---------------------------------------------------

// Une ligne de message qui prefere le libelle riche et ne se rabat sur le
// court QUE s'il ne tient pas. La mesure est faite AVANT le dessin (pas de
// premiere image fausse suivie d'une correction) : BoxWithConstraints donne la
// largeur reellement accordee, rememberTextMeasurer mesure dans le style exact.
@Composable
fun FittedLabel(
    long: String,
    short: String?,
    modifier: Modifier = Modifier,
    style: TextStyle = MaterialTheme.typography.caption2
) {
    BoxWithConstraints(modifier, contentAlignment = Alignment.Center) {
        val measurer = rememberTextMeasurer()
        val shown = fitLabel(long, short, constraints.maxWidth) { s ->
            measurer.measure(AnnotatedString(s), style, softWrap = false, maxLines = 1).size.width
        }
        Text(
            shown,
            textAlign = TextAlign.Center,
            style = style,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

// Le score de l'ecran de confirmation : il RETRECIT au lieu d'etre tronque.
//
// C'est le seul element pour lequel cet ecran existe -- on demande de le
// RELIRE avant une action irreversible. `maxLines = 1` + Ellipsis y etait la
// mauvaise politique : "6 6 6 6 6 / 6 6 6 6 6" (un match en cinq sets sur le
// carre 180 dp) serait devenu "6 6 6 6 6 / 6..." , c'est-a-dire un score FAUX
// presente comme le score a valider. Un chiffre coupe n'est pas une
// abreviation, c'est une erreur de lecture. On descend donc la taille jusqu'a
// ce que le score entier tienne ; l'ellipse ne reste que comme garde-fou
// absolu sous la plus petite taille.
@Composable
fun FittedScore(text: String, modifier: Modifier = Modifier) {
    BoxWithConstraints(modifier, contentAlignment = Alignment.Center) {
        val measurer = rememberTextMeasurer()
        val base = MaterialTheme.typography.title1
        val sp = fitFontSizeSp(text, SCORE_SIZES_SP, constraints.maxWidth) { s, size ->
            measurer.measure(
                AnnotatedString(s), base.copy(fontSize = size.sp),
                softWrap = false, maxLines = 1
            ).size.width
        }
        Text(
            text,
            style = base.copy(fontSize = sp.sp),
            textAlign = TextAlign.Center,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

// title1 (20sp) d'abord : la regle "le score est l'element le plus gros" tient
// tant qu'il tient. Les paliers descendent jusqu'a 12sp, ce qui laisse encore
// le score au-dessus de la question posee au-dessus de lui (caption1, 14sp)
// sur les trois premiers paliers, et lisible sur le dernier.
val SCORE_SIZES_SP = listOf(20f, 18f, 16f, 14f, 12f)
