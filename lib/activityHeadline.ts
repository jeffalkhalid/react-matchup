// lib/activityHeadline.ts — la phrase d'en-tête d'une carte du fil.
//
// « Khalid a gagné » sur sa propre carte : on ne se parle pas de soi à la
// troisième personne. Le sujet et le verbe se construisent ensemble — « Toi a
// gagné » ne marcherait pas — donc une seule fonction rend les deux.
import type { ActivityEvent } from '../types';

export interface Headline {
  /** « Tu », ou le prénom/nom du joueur. */
  subject: string;
  /** Accordé au sujet : « as gagné » / « a gagné ». */
  verb: string;
  /** Complément mis en avant (ligue, mois du bilan), ou vide. */
  accent?: string;
}

type Type = ActivityEvent['type'] | string;

/**
 * @param type   le type d'événement
 * @param isMe   est-ce MON activité ?
 * @param name   le nom de l'acteur (ignoré si `isMe`)
 * @param accent le complément déjà calculé (ligue, libellé de mois)
 */
export function headlineFor(type: Type, isMe: boolean, name: string | null | undefined, accent?: string | null): Headline {
  const sujet = isMe ? 'Tu' : (name?.trim() || 'Joueur');
  const v = (mien: string, autre: string) => (isMe ? mien : autre);

  switch (type) {
    case 'match_win':  return { subject: sujet, verb: v('as gagné', 'a gagné') };
    case 'match_loss': return { subject: sujet, verb: v('as perdu', 'a perdu') };
    case 'badge':      return { subject: sujet, verb: v('as débloqué un badge', 'a débloqué un badge') };
    case 'promotion':  return { subject: sujet, verb: v('montes en', 'monte en'), accent: accent ?? '' };
    case 'bilan':      return { subject: sujet, verb: v('as partagé ton bilan', 'a partagé son bilan'), accent: accent ?? '' };
    default:           return { subject: sujet, verb: '' };
  }
}
