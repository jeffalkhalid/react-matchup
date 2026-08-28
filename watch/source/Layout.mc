// watch/source/Layout.mc
// Mesure et dessine — sans jamais supposer la taille ni la forme de l'ecran.
//
// Pourquoi ce module existe : trois defauts d'affichage du meme type ont ete
// trouves en une seule journee de test (lignes poussees vers le bord, marge
// verticale reduite de moitie, messages rognes aux deux bouts). Tous venaient
// de positions et de polices reglees a l'oeil sur UNE montre. Le parc va de
// 148 a 486 px, en rond ET en rectangle : aucune valeur en dur ne peut y etre
// juste. Ici on mesure, on ne suppose pas.
//
// SANS ETAT : ne memorise rien entre deux dessins.
using Toybox.Graphics;
using Toybox.System;
using Toybox.Math;
using Toybox.Lang;

module Layout {

    // Marge VOLONTAIREMENT genereuse : les metriques de police Garmin
    // surestiment l'encre reelle (verifie en revue), donc un calcul au pixel
    // pres donnerait une fausse assurance dans les deux sens.
    const MARGIN_PCT = 6;
    const MARGIN_MIN = 8;

    // De la plus grande a la plus petite.
    function textLadder() {
        return [Graphics.FONT_LARGE, Graphics.FONT_MEDIUM, Graphics.FONT_SMALL,
                Graphics.FONT_TINY, Graphics.FONT_XTINY];
    }

    function numberLadder() {
        return [Graphics.FONT_NUMBER_HOT, Graphics.FONT_NUMBER_MEDIUM,
                Graphics.FONT_NUMBER_MILD, Graphics.FONT_LARGE,
                Graphics.FONT_MEDIUM, Graphics.FONT_SMALL, Graphics.FONT_TINY];
    }

    // SEMI_ROUND et SEMI_OCTAGON sont traites comme ronds : leur largeur decroit
    // aussi vers les bords. Seul RECTANGLE garde sa pleine largeur partout.
    function isRound() {
        return System.getDeviceSettings().screenShape != System.SCREEN_SHAPE_RECTANGLE;
    }

    function isTouch() {
        return System.getDeviceSettings().isTouchScreen;
    }

    function margin(dc) {
        var m = dc.getWidth() * MARGIN_PCT / 100;
        return m < MARGIN_MIN ? MARGIN_MIN : m;
    }

    // Largeur REELLEMENT utilisable a la hauteur y.
    // Rond : la corde du cercle, 2*racine(r^2 - (y-r)^2). C'est le calcul qui
    // manquait et qui rognait les textes en bas d'ecran.
    function usableWidth(dc, y) {
        var w = dc.getWidth();
        var m = margin(dc);
        if (!isRound()) {
            var flat = w - 2 * m;
            return flat > 0 ? flat : 0;
        }
        var r = dc.getHeight() / 2.0;
        var dy = y - r;
        var inside = r * r - dy * dy;
        if (inside <= 0) { return 0; }
        var chord = 2.0 * Math.sqrt(inside);
        if (chord > w) { chord = w; }   // ecran rond pas forcement carre
        var usable = chord - 2 * m;
        return usable > 0 ? usable : 0;
    }

    // Premiere police de l'echelle dont le texte tient. null si aucune :
    // l'appelant decide alors quoi abandonner.
    function fitFont(dc, text, maxWidth, ladder) {
        if (text == null) { return null; }
        if (text.length() == 0) { return null; }
        for (var i = 0; i < ladder.size(); i = i + 1) {
            if (dc.getTextWidthInPixels(text, ladder[i]) <= maxWidth) {
                return ladder[i];
            }
        }
        return null;
    }

    // Dessine si ca tient, sinon ne dessine RIEN et renvoie false.
    // Jamais de texte tronque : c'est precisement le defaut qu'on elimine.
    function drawFit(dc, y, text, ladder, color) {
        var f = fitFont(dc, text, usableWidth(dc, y), ladder);
        if (f == null) { return false; }
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        dc.drawText(dc.getWidth() / 2, y, f, text, Graphics.TEXT_JUSTIFY_CENTER);
        return true;
    }

    // Essaie plusieurs formulations, de la plus riche a la plus pauvre, et
    // dessine la premiere qui tient. C'est ainsi que « admin & Kay » devient
    // « A&K » puis rien du tout quand l'ecran retrecit.
    function drawBest(dc, y, variants, ladder, color) {
        for (var i = 0; i < variants.size(); i = i + 1) {
            if (drawFit(dc, y, variants[i], ladder, color)) { return true; }
        }
        return false;
    }
}
