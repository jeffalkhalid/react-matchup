// lib/uiText.ts — les textes STRUCTURANTS de l'accueil.
//
// L'accueil ne défile pas : sa hauteur est un budget fermé, et chaque bloc
// doit tenir dans la part qu'on lui donne. Ce calcul n'est démontrable que si
// la hauteur d'un texte est CONNUE — or la taille de police système d'Android
// peut la multiplier par un facteur qu'on ne connaît pas d'ici. Tant qu'elle
// s'applique, tout minimum est une supposition, et l'écran déborde sur les
// téléphones qu'on n'a pas testés.
//
// D'où ce réglage, qui ne concerne QUE les titres et libellés de mise en page
// (« Trouver un match », « Tournois & événements », « Prochain match »…). Les
// textes de CONTENU — noms de joueurs, clubs, niveaux — continuent de suivre
// la taille système : c'est eux qu'on a besoin d'agrandir pour lire.
//
// RÉVERSIBLE EN UNE LIGNE : repasser la constante à `true` rend la taille
// système à ces textes. L'écran redeviendra alors sensible à ce réglage —
// c'est le compromis assumé, écrit ici pour qu'on sache quoi défaire.

/** Les textes de mise en page de l'accueil suivent-ils la taille système ? */
export const TEXTE_UI_SUIT_POLICE_SYSTEME = false;

/**
 * À étaler sur un `<Text>` de mise en page : `<Text {...texteUI} …>`.
 *
 * Quand la taille système est réactivée, on garde un plafond : au-delà, la
 * contrainte « tout tient sans défiler » redevient mathématiquement
 * impossible, quelle que soit la qualité du calculateur.
 */
export const texteUI = TEXTE_UI_SUIT_POLICE_SYSTEME
  ? { maxFontSizeMultiplier: 1.15 }
  : { allowFontScaling: false };
