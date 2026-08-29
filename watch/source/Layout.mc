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

    // ------------------------------------------------------------------
    // MESURE VERTICALE — ajoutee apres la passe visuelle des 14 familles.
    //
    // Tout ce qui precede ne mesure QUE l'horizontale. C'est ce qui a laisse
    // passer, sur TOUTES les familles capturees, des defauts qu'aucune
    // compilation ne pouvait voir :
    //   - « 40 - AV » et le message ecrits PAR-DESSUS les chiffres du score
    //     (vivoactive_hr, fenix5, fenix5s, fenix6, fenix6xpro, venusq,
    //     epix2...) : chaque element etait pose a sa hauteur sans jamais
    //     verifier que l'encre du precedent s'y arretait ;
    //   - un nom d'equipe prenant une grosse police et mordant sur le score.
    //
    // La reponse n'est pas de rabaisser les hauteurs a l'oeil — ce serait
    // re-regler des valeurs sur UNE montre, exactement le defaut que ce module
    // elimine. On donne a chaque element un BUDGET vertical et on n'accepte
    // qu'une police dont l'encre tient dedans. Le budget est une regle de mise
    // en page (l'ecart jusqu'a l'element suivant), pas une valeur par modele.
    // ------------------------------------------------------------------

    // DEUX METRIQUES, DEUX QUESTIONS DIFFERENTES — ne pas les confondre :
    //
    //   - « combien de place cette ligne PREND-ELLE » (pour ne pas mordre sur
    //     la suivante) : getFontHeight, l'interligne complet de la police.
    //     Volontairement prudent : c'est lui qui separe deux lignes.
    //   - « ou passe le coin bas de son encre » (pour la corde d'un cadran
    //     rond) : la LIGNE DE BASE, soit getFontHeight - getFontDescent.
    //
    // Pourquoi la ligne de base et non la hauteur complete : sur une ligne
    // centree, le point qui touche la lunette est un coin BAS-EXTERIEUR, et
    // les caracteres des extremites sont des capitales ou des lettres sans
    // jambage — leur encre s'arrete a la ligne de base. Mesurer la corde un
    // interligne entier plus bas rejetait des lignes qui tenaient tres bien :
    // « HAUT/BAS puis SELECT » disparaissait de l'ecran d'appairage du
    // vivoactive3, alors qu'elle s'y affiche sans etre rognee.
    // Le cas d'un jambage en bout de chaine (« ... appui long ») descend sous
    // la ligne de base, et c'est la MARGE — deja volontairement genereuse pour
    // cette raison meme, cf. MARGIN_PCT — qui l'absorbe.
    // getFontDescent existe depuis l'API 1.2.0, tres en dessous du plancher
    // 2.4.0 du manifeste : disponible sur les 53 cibles.

    // Profondeur d'encre sous y : jusqu'a la ligne de base.
    function inkDepth(font) {
        var d = Graphics.getFontHeight(font) - Graphics.getFontDescent(font);
        return d > 0 ? d : Graphics.getFontHeight(font);
    }

    // Largeur garantie sur TOUTE la hauteur d'une ligne posee en y.
    // usableWidth ne connait que le HAUT de l'encre ; sur un cadran rond la
    // corde se resserre en descendant, et c'est le BAS d'une ligne basse qui
    // touche le bord en premier. On retient donc la plus etroite des deux.
    function lineWidth(dc, y, lineH) {
        var a = usableWidth(dc, y);
        var b = usableWidth(dc, y + lineH);
        return a < b ? a : b;
    }

    // Indice, DANS L'ECHELLE, de la plus grande police dont le texte tient a la
    // fois en largeur et dans le budget vertical maxH. -1 si aucune.
    // On renvoie l'indice et non la police parce que deux polices ne sont pas
    // comparables entre elles : c'est le seul moyen pour deux lignes (les deux
    // scores, les deux noms) de s'accorder sur la plus petite de leurs deux.
    function fitIndex(dc, text, y, maxH, ladder) {
        if (text == null) { return -1; }
        if (text.length() == 0) { return -1; }
        for (var i = 0; i < ladder.size(); i = i + 1) {
            var f = ladder[i];
            if (Graphics.getFontHeight(f) > maxH) { continue; }
            if (dc.getTextWidthInPixels(text, f) <= lineWidth(dc, y, inkDepth(f))) {
                return i;
            }
        }
        return -1;
    }

    // Un barreau DONNE tient-il pour CETTE ligne ? Meme regle que fitIndex,
    // mais sur un indice impose au lieu d'en chercher un.
    //
    // Pourquoi cette fonction existe : fitIndex rend le PREMIER barreau qui
    // tient, donc le plus grand, et commonIndex fait ensuite adopter aux DEUX
    // lignes solidaires le barreau de celle qui en demandait le plus. Ce
    // barreau-la n'a jamais ete confronte aux contraintes de l'AUTRE ligne :
    // ni a son budget vertical, ni a la corde de SA hauteur. Le cas est
    // ordinaire, pas exotique — sur un cadran rond le score de l'equipe 2 est
    // pose a 52 %, ou la corde de sa ligne de base est plus etroite qu'a 18 %,
    // si bien que c'est presque toujours LUI qui impose le barreau et
    // l'equipe 1 qui herite d'une police jamais verifiee. Les echelles ne sont
    // d'ailleurs pas garanties decroissantes en hauteur d'un modele a l'autre
    // (FONT_NUMBER_MILD contre FONT_LARGE, par exemple, n'a aucun ordre
    // impose par le SDK) : « plus petit indice » ne veut donc pas dire
    // « police plus basse », et la garantie sur laquelle s'appuie
    // SessionView.teamForTapY — le score de l'equipe 1 ne descend jamais
    // sous Y_NAME2_PCT — n'en serait plus une.
    function fitsIndex(dc, text, y, maxH, ladder, idx) {
        if (idx < 0 || idx >= ladder.size()) { return false; }
        if (text == null) { return false; }
        if (text.length() == 0) { return false; }
        var f = ladder[idx];
        if (Graphics.getFontHeight(f) > maxH) { return false; }
        return dc.getTextWidthInPixels(text, f) <= lineWidth(dc, y, inkDepth(f));
    }

    function fitsPartsIndex(dc, parts, y, maxH, ladder, idx) {
        if (idx < 0 || idx >= ladder.size()) { return false; }
        if (parts == null) { return false; }
        if (parts.size() == 0) { return false; }
        var f = ladder[idx];
        if (Graphics.getFontHeight(f) > maxH) { return false; }
        return partsWidth(dc, parts, f) <= lineWidth(dc, y, inkDepth(f));
    }

    // Barreau COMMUN a deux lignes solidaires, verifie pour les DEUX.
    // On part du plus petit des deux barreaux retenus separement (commonIndex)
    // et on continue de descendre l'echelle tant que l'une des deux lignes n'y
    // tient pas. -1 quand aucun barreau ne convient aux deux : elles
    // s'affichent ensemble ou pas du tout (cf. commonIndex).
    function pairIndex(dc, t1, y1, h1, t2, y2, h2, ladder) {
        var i = commonIndex(fitIndex(dc, t1, y1, h1, ladder),
                            fitIndex(dc, t2, y2, h2, ladder));
        if (i < 0) { return -1; }
        while (i < ladder.size()) {
            if (fitsIndex(dc, t1, y1, h1, ladder, i)
                && fitsIndex(dc, t2, y2, h2, ladder, i)) { return i; }
            i = i + 1;
        }
        return -1;
    }

    function pairPartsIndex(dc, p1, y1, h1, p2, y2, h2, ladder) {
        var i = commonIndex(fitPartsIndex(dc, p1, y1, h1, ladder),
                            fitPartsIndex(dc, p2, y2, h2, ladder));
        if (i < 0) { return -1; }
        while (i < ladder.size()) {
            if (fitsPartsIndex(dc, p1, y1, h1, ladder, i)
                && fitsPartsIndex(dc, p2, y2, h2, ladder, i)) { return i; }
            i = i + 1;
        }
        return -1;
    }

    // drawFit, budget vertical en plus. Ne dessine RIEN si rien ne tient.
    function drawBox(dc, y, maxH, text, ladder, color) {
        return drawAt(dc, y, maxH, text, ladder,
                      fitIndex(dc, text, y, maxH, ladder), color);
    }

    // drawBest, budget vertical en plus.
    function drawBestBox(dc, y, maxH, variants, ladder, color) {
        for (var i = 0; i < variants.size(); i = i + 1) {
            if (drawBox(dc, y, maxH, variants[i], ladder, color)) { return true; }
        }
        return false;
    }

    // Dessine avec la police d'indice idx (celui rendu par fitIndex), ou rien
    // si idx est negatif. Sert a imposer a deux lignes la MEME police.
    //
    // Le barreau est RE-VERIFIE ici, contre le budget maxH de CETTE ligne et
    // contre la corde de SA hauteur : un indice venu d'ailleurs (commonIndex,
    // pairIndex) a pu etre choisi pour une autre ligne. Sans cette
    // verification, le module dessinait une police qu'il n'avait jamais
    // mesuree pour l'endroit ou il la posait — exactement le genre de
    // supposition qu'il existe pour supprimer.
    function drawAt(dc, y, maxH, text, ladder, idx, color) {
        if (!fitsIndex(dc, text, y, maxH, ladder, idx)) { return false; }
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        dc.drawText(dc.getWidth() / 2, y, ladder[idx], text,
                    Graphics.TEXT_JUSTIFY_CENTER);
        return true;
    }

    // La plus petite de deux polices de la meme echelle, par leur indice.
    // -1 des que l'une des deux manque : deux lignes solidaires s'affichent
    // ensemble ou pas du tout.
    function commonIndex(a, b) {
        if (a < 0 || b < 0) { return -1; }
        return a > b ? a : b;
    }

    // ------------------------------------------------------------------
    // LIGNES EN FRAGMENTS — le separateur n'est JAMAIS confie a la police.
    //
    // Les polices FONT_NUMBER_* sont dessinees pour des chiffres et n'ont pas
    // toutes de glyphe d'espace. Constate a l'ecran :
    //   - vivoactive_hr : « 6 3 5 » sortait « 6[?]3[?]5 », chaque espace
    //     remplace par l'image « caractere manquant » de Garmin, qui mange
    //     autant de place qu'un chiffre ;
    //   - fenix5 / fenix5s : l'espace etait au contraire avale, et les trois
    //     sets se lisaient « 635 », c'est-a-dire six cent trente-cinq.
    // Dans les deux cas le score set par set devenait faux a la lecture. On
    // menage donc l'intervalle NOUS-MEMES, en pixels, et on ne passe a la
    // police que des chiffres.
    // ------------------------------------------------------------------

    // Intervalle entre deux fragments : une demi-largeur de chiffre dans la
    // police retenue. Assez pour separer deux sets a l'oeil, assez peu pour ne
    // pas gaspiller la corde. Proportionnel a la police, donc juste a toute
    // taille d'ecran.
    function partGap(dc, font) {
        var g = dc.getTextWidthInPixels("0", font) / 2;
        return g < 2 ? 2 : g;
    }

    function partsWidth(dc, parts, font) {
        var gap = partGap(dc, font);
        var w = 0;
        for (var i = 0; i < parts.size(); i = i + 1) {
            if (i > 0) { w = w + gap; }
            w = w + dc.getTextWidthInPixels(parts[i], font);
        }
        return w;
    }

    // Meme regle que fitIndex, pour une ligne faite de plusieurs fragments.
    function fitPartsIndex(dc, parts, y, maxH, ladder) {
        if (parts == null) { return -1; }
        if (parts.size() == 0) { return -1; }
        for (var i = 0; i < ladder.size(); i = i + 1) {
            var f = ladder[i];
            if (Graphics.getFontHeight(f) > maxH) { continue; }
            if (partsWidth(dc, parts, f) <= lineWidth(dc, y, inkDepth(f))) {
                return i;
            }
        }
        return -1;
    }

    // Dessine les fragments avec la police d'indice idx, l'ensemble centre.
    // Meme re-verification que drawAt, et pour la meme raison.
    function drawPartsAt(dc, y, maxH, parts, ladder, idx, color) {
        if (!fitsPartsIndex(dc, parts, y, maxH, ladder, idx)) { return false; }
        return drawPartsRaw(dc, y, parts, ladder, idx, color);
    }

    // DERNIER RECOURS — dessine SANS aucune condition de place.
    //
    // Toute la mecanique de ce module repose sur « ne rien dessiner plutot que
    // rogner ». C'est le bon arbitrage pour un nom, une consigne, un message :
    // ils sont sacrifiables par definition. Il ne l'est PAS pour le score, que
    // la spec place en priorite 1 et qui est la seule raison d'etre de l'ecran.
    // Un score legerement trop haut se rattrape a l'oeil ; un score absent ne
    // se rattrape pas — l'utilisateur n'a plus rien a lire au poignet.
    //
    // Cette fonction ne peut pas echouer autrement qu'en l'absence de contenu :
    // l'indice est BORNE a l'echelle au lieu d'etre refuse, l'echelle n'est
    // jamais vide, et drawText ne rend pas d'erreur. Elle ne doit servir que
    // la ou l'omission est pire que le debordement.
    function drawPartsRaw(dc, y, parts, ladder, idx, color) {
        if (parts == null) { return false; }
        if (parts.size() == 0) { return false; }
        if (ladder.size() == 0) { return false; }
        if (idx < 0) { idx = ladder.size() - 1; }
        if (idx >= ladder.size()) { idx = ladder.size() - 1; }
        var font = ladder[idx];
        var gap = partGap(dc, font);
        var x = dc.getWidth() / 2 - partsWidth(dc, parts, font) / 2;
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        for (var i = 0; i < parts.size(); i = i + 1) {
            dc.drawText(x, y, font, parts[i], Graphics.TEXT_JUSTIFY_LEFT);
            x = x + dc.getTextWidthInPixels(parts[i], font) + gap;
        }
        return true;
    }

}
