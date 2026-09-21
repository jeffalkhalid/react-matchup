// lib/circleAlert.ts — « Prévenir mon cercle » : quoi annoncer, et quand se taire.
//
// Le bouton envoie une notification à tous mes abonnés. Trois choses le
// rendaient dangereux :
//  • il annonçait toujours le créneau le plus proche (« ce soir »), même
//    quand j'avais coché demain et mercredi — le message mentait ;
//  • il ne montrait aucune confirmation, donc on retapait, donc le cercle
//    sonnait deux ou trois fois ;
//  • rien ne comptait les envois, ni ici ni dans send-push.
//
// Ici on annonce EXACTEMENT les jours cochés, et un seul envoi passe par
// tranche de quelques heures.
//
// Ce garde-fou vit dans le téléphone : il protège du doigt qui insiste, pas
// d'une mauvaise volonté — réinstaller l'app le remet à zéro. C'est un choix
// assumé (la version serveur demandait une migration).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isSlotActive, slotShortLabel, type AvailabilityRow, type Slot } from './availability';

/** Le silence entre deux annonces au cercle. */
export const CIRCLE_ALERT_COOLDOWN_MS = 4 * 60 * 60 * 1000;

/** Au-delà, on résume : personne ne lit « ce soir, demain, mardi, mercredi… ». */
const NOMMES_AU_MAX = 3;

/** Les jours que j'ai réellement cochés, dans l'ordre de la ligne de dispo. */
export function announcedSlots(
  slots: Slot[],
  mine: Pick<AvailabilityRow, 'slot_start' | 'slot_end'>[],
): Slot[] {
  return slots.filter(s => isSlotActive(s, mine));
}

/** « ce soir » · « demain et mercredi » · « ce soir, demain et 3 autres jours ». */
export function announcementLabel(slots: Slot[], now: Date = new Date()): string {
  const noms = slots.map(s => slotShortLabel(s, now));
  if (noms.length === 0) return '';
  if (noms.length === 1) return noms[0];
  if (noms.length <= NOMMES_AU_MAX) return `${noms.slice(0, -1).join(', ')} et ${noms[noms.length - 1]}`;
  const reste = noms.length - 2;
  return `${noms[0]}, ${noms[1]} et ${reste} autres jours`;
}

/** Le corps de la notification envoyée au cercle. */
export function alertBody(slots: Slot[], now: Date = new Date()): string {
  return `Dispo ${announcementLabel(slots, now)} — tape pour te déclarer aussi.`;
}

/**
 * Ce qu'il reste à attendre avant de pouvoir relancer, en millisecondes.
 * 0 = la voie est libre.
 *
 * Une horloge qui recule (changement d'heure, date bidouillée) ouvre la voie
 * plutôt que de bloquer le bouton pour des mois : on protège d'une maladresse,
 * pas d'une attaque.
 */
export function cooldownLeft(lastSentAt: number | null, now: number = Date.now()): number {
  if (lastSentAt == null || !Number.isFinite(lastSentAt) || lastSentAt > now) return 0;
  return Math.max(0, lastSentAt + CIRCLE_ALERT_COOLDOWN_MS - now);
}

/** « 25 min » · « 3 h ». Arrondi au-dessus : jamais promettre plus tôt que vrai. */
export function cooldownLabel(msLeft: number): string {
  if (msLeft <= 0) return '';
  const min = Math.ceil(msLeft / 60_000);
  return min < 60 ? `${min} min` : `${Math.ceil(min / 60)} h`;
}

// Une clé par joueur : un même téléphone sert parfois à plusieurs comptes, et
// le silence de l'un ne doit pas bâillonner l'autre (cf. le piège des jetons
// push par appareil).
const cleAlerte = (playerId: string) => `circleAlert:${playerId}`;

/** Quand ce joueur a prévenu son cercle pour la dernière fois, sur CE téléphone. */
export async function readLastAlert(playerId: string): Promise<number | null> {
  if (!playerId) return null;
  try {
    const brut = await AsyncStorage.getItem(cleAlerte(playerId));
    const t = brut == null ? NaN : Number(brut);
    return Number.isFinite(t) ? t : null;
  } catch { return null; }
}

/**
 * Note l'envoi. On l'écrit même si la notification s'est perdue en route :
 * `notifyPlayers` ne dit jamais si elle a abouti, et entre sonner deux fois
 * et sonner zéro fois, c'est zéro qui se rattrape le plus facilement.
 */
export async function markAlertSent(playerId: string, at: number = Date.now()): Promise<void> {
  if (!playerId) return;
  try { await AsyncStorage.setItem(cleAlerte(playerId), String(at)); } catch { /* le garde-fou saute, pas l'app */ }
}
