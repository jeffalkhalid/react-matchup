// lib/refereeQueue.ts — la file de travail de l'arbitre.
//
// Implémente `design_handoff_panel_arbitre`. Le panel demandait de visiter
// NEUF onglets pour savoir ce qu'il y avait à faire ; rien ne disait où était
// l'urgence, ni même s'il y avait quelque chose. La file agrège les cinq
// sources en une liste unique, triée par ce qui attend depuis le plus
// longtemps — et qui compte le plus.
//
// Tout est PUR et testé : c'est l'ordre de la file qui décide de ce que
// l'arbitre voit en premier, et un ordre faux ne se voit pas à l'œil.

export type QueueKind = 'dispute' | 'report' | 'frmt' | 'gender' | 'tournament';

export interface QueueItem {
  id: string;
  kind: QueueKind;
  /** Le titre de la carte — « Youssef & Karim vs Mehdi & Sofia ». */
  title: string;
  /** Ce qu'il faut savoir sans ouvrir : « Désaccord sur le set 2 ». */
  summary: string;
  /** Le contexte, en pied de carte : « Club Anfa · 31 août · Compétitif ». */
  context: string;
  /** Depuis quand ça attend. */
  createdAt: string;
  /** Marqueurs d'aggravation : « RÉCIDIVE », « 2 SIGNALEMENTS »… */
  flags?: string[];
  /** De quoi router vers l'écran qui traite le dossier. */
  targetTab: string;
  targetId?: string;
}

/**
 * Le poids d'un type dans la file, à ancienneté égale.
 *
 * Un litige bloque DEUX joueurs et gèle leur ELO : il passe devant. Un
 * signalement touche la sécurité de quelqu'un, il vient juste après. Le
 * rattachement FRMT et le genre attendent sans conséquence immédiate.
 * Un tournoi a une DATE : son urgence vient de l'échéance, pas du poids.
 */
const WEIGHT: Record<QueueKind, number> = {
  dispute: 100,
  report: 80,
  tournament: 60,
  gender: 40,
  frmt: 30,
};

/** L'âge en heures, borné à zéro — une date future ne rend pas négatif. */
export function ageHours(createdAt: string, now: Date = new Date()): number {
  return Math.max(0, (now.getTime() - new Date(createdAt).getTime()) / 3_600_000);
}

/** « 6 h », « 3 j » — l'âge tel qu'il s'affiche sur la carte. */
export function ageLabel(createdAt: string, now: Date = new Date()): string {
  const h = ageHours(createdAt, now);
  if (h < 1) return 'à l’instant';
  if (h < 24) return `${Math.floor(h)} h`;
  return `${Math.floor(h / 24)} j`;
}

/**
 * Le score de priorité. Plus il est haut, plus le dossier remonte.
 *
 * L'ancienneté pèse de plus en plus : un litige d'il y a une heure passe
 * devant un rattachement d'il y a une heure, mais un rattachement qui traîne
 * depuis une semaine finit par doubler un litige tout frais — sinon les
 * dossiers « peu graves » ne sont jamais traités, ce qui est le vrai risque
 * d'une file triée uniquement par gravité.
 */
export function priorityScore(item: QueueItem, now: Date = new Date()): number {
  return WEIGHT[item.kind] + ageHours(item.createdAt, now) * 2;
}

/** La file, du plus urgent au moins urgent. Tri STABLE sur l'identifiant. */
export function sortQueue(items: QueueItem[], now: Date = new Date()): QueueItem[] {
  return [...items].sort((a, b) => {
    const d = priorityScore(b, now) - priorityScore(a, now);
    return d !== 0 ? d : a.id.localeCompare(b.id);
  });
}

/** Combien de dossiers par type — la rangée de compteurs au-dessus de la file. */
export function countByKind(items: QueueItem[]): Record<QueueKind, number> {
  const out: Record<QueueKind, number> = { dispute: 0, report: 0, frmt: 0, gender: 0, tournament: 0 };
  for (const i of items) out[i.kind] += 1;
  return out;
}

export const KIND_LABEL: Record<QueueKind, string> = {
  dispute: 'LITIGE',
  report: 'SIGNALEMENT',
  frmt: 'RATTACHEMENT',
  gender: 'GENRE',
  tournament: 'TOURNOI',
};

/** Le libellé pluriel des compteurs. */
export const KIND_COUNTER: Record<QueueKind, string> = {
  dispute: 'LITIGES',
  report: 'SIGNAL.',
  frmt: 'FRMT',
  gender: 'GENRE',
  tournament: 'TOURNOIS',
};
