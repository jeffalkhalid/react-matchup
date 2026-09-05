// lib/batchModeration.ts — le traitement en lot des signalements.
//
// Implémente `design_handoff_panel_arbitre`, sélection multiple.
//
// Le besoin est réel : quand quelqu'un signale dix messages d'affilée, ou
// qu'une même story est signalée par cinq personnes, l'arbitre rejette dix
// fois la même chose, un bouton à la fois.
//
// LA RÈGLE QUI GOUVERNE CE FICHIER : on classe en lot, on ne sanctionne
// jamais en lot.
//
// « Classer sans suite » (`dismissed`) dit « il ne s'est rien passé » — c'est
// le geste par défaut, celui qui ne touche personne, et le seul qui reste
// juste quand on le fait dix fois de suite sans relire. « Retenir »
// (`actioned`) marque un joueur : ça se décide un dossier à la fois, en
// ayant lu celui-là et pas les neuf autres.
//
// Un bouton « tout retenir » aurait l'air symétrique de « tout classer ». Il
// ne l'est pas : l'un annule du bruit, l'autre accuse des gens.

/** Les issues qu'un signalement peut recevoir. */
export type ReportOutcome = 'actioned' | 'dismissed';

/**
 * Cette issue peut-elle être appliquée à plusieurs dossiers d'un coup ?
 *
 * Seul le classement sans suite. Voir la règle en tête de fichier : ce n'est
 * pas une limite technique, c'est le fond du sujet.
 */
export function isBatchable(outcome: ReportOutcome): boolean {
  return outcome === 'dismissed';
}

/** Ajoute ou retire un dossier de la sélection. Ne modifie pas l'entrée. */
export function toggleSelected(selected: readonly string[], id: string): string[] {
  return selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id];
}

/**
 * « Tout sélectionner » est une bascule : si tout est déjà pris, elle vide.
 * Sans ça, il faudrait décocher les dossiers un par un pour en sortir.
 */
export function toggleAll(selected: readonly string[], allIds: readonly string[]): string[] {
  const tout = allIds.length > 0 && allIds.every(id => selected.includes(id));
  return tout ? [] : [...allIds];
}

/**
 * La sélection débarrassée de ce qui n'existe plus.
 *
 * Après un traitement, la liste se recharge et les dossiers réglés
 * disparaissent. Une sélection qui garderait leurs identifiants enverrait au
 * serveur des lignes déjà classées — et afficherait « 5 sélectionnés » sur
 * une liste qui n'en montre que deux.
 */
export function pruneSelection(selected: readonly string[], allIds: readonly string[]): string[] {
  return selected.filter(id => allIds.includes(id));
}

/** « 3 signalements sélectionnés » — l'accord au pluriel compris. */
export function selectionLabel(n: number): string {
  if (n <= 0) return 'Aucun signalement sélectionné';
  return n === 1 ? '1 signalement sélectionné' : `${n} signalements sélectionnés`;
}

/**
 * Le texte de confirmation. Il dit le NOMBRE et l'effet, parce qu'un lot se
 * défait dossier par dossier : le seul moment où l'on peut encore reculer à
 * peu de frais, c'est avant.
 */
export function batchConfirmText(n: number): string {
  const quoi = n === 1 ? 'Ce signalement sera classé' : `Ces ${n} signalements seront classés`;
  return `${quoi} sans suite. Personne n’est sanctionné, et chacun reste consultable dans le journal.`;
}
