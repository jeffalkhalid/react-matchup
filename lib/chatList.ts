// lib/chatList.ts — les mots et les dates de la liste des conversations.
//
// Refonte de l'onglet Chats (design_handoff_chats_refonte, option 4a). Trois
// choses reviennent partout dans cette liste, et elles reviennent dans les
// DEUX listes — les parties et les directs :
//
//   • l'heure du dernier message, en relatif (« 12 min », « hier », « lun. ») ;
//   • l'étiquette de date d'un match (« AUJOURD'HUI », « Sam. 26 sept. ») ;
//   • l'aperçu du dernier message, préfixé du prénom de qui l'a écrit.
//
// Les écrire dans chaque composant, c'était trois façons d'afficher la même
// chose — le piège déjà payé ailleurs dans l'app. Tout est pur et testé
// (lib/__tests__/chatList.test.ts) : ces fonctions ne parlent ni à la base ni
// à React.

const JOURS_COURTS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];

/** Le nombre de jours de calendrier entre deux instants (et non 24 h fixes). */
export function dayGap(iso: string | Date, now: Date = new Date()): number | null {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const jour = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  return Math.round((jour(d) - jour(now)) / 86_400_000);
}

/** Première lettre en majuscule. « sam. 26 sept. » → « Sam. 26 sept. ». */
function capitale(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * L'heure d'un message, telle qu'une messagerie l'affiche : plus c'est
 * récent, plus c'est précis.
 *
 * Avant, la liste affichait ici la date du MATCH — la même information que
 * l'étiquette, à un endroit où on cherche « quand m'a-t-on écrit ».
 */
export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';

  const secondes = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (secondes < 60) return "à l'instant";
  const minutes = Math.floor(secondes / 60);
  if (minutes < 60) return `${minutes} min`;

  const ecart = dayGap(d, now) ?? 0;
  if (ecart === 0) return `${Math.floor(minutes / 60)} h`;
  if (ecart === -1) return 'hier';
  if (ecart > -7 && ecart < 0) return JOURS_COURTS[d.getDay()];
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export type DateTagKind = 'today' | 'tomorrow' | 'yesterday' | 'other';

export interface DateTag {
  label: string;
  kind: DateTagKind;
}

/**
 * L'étiquette posée sous la mosaïque : quand se joue ce match.
 *
 * « HIER » existe parce qu'une conversation reste active 24 h après le coup
 * d'envoi, le temps que le score se règle (cf. ARCHIVE_GRACE_MS).
 */
export function dateTag(matchDate: string | null | undefined, now: Date = new Date()): DateTag {
  const ecart = matchDate ? dayGap(matchDate, now) : null;
  if (ecart === null) return { label: '', kind: 'other' };
  if (ecart === 0) return { label: "AUJOURD'HUI", kind: 'today' };
  if (ecart === 1) return { label: 'DEMAIN', kind: 'tomorrow' };
  if (ecart === -1) return { label: 'HIER', kind: 'yesterday' };
  const d = new Date(matchDate as string);
  return {
    label: capitale(d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })),
    kind: 'other',
  };
}

/** « 20:30 ». */
export function hourLabel(matchDate: string | null | undefined): string {
  if (!matchDate) return '';
  const d = new Date(matchDate);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/** « Samedi 19 septembre » — la date en toutes lettres, pour les archives. */
export function longDateLabel(matchDate: string | null | undefined): string {
  if (!matchDate) return '';
  const d = new Date(matchDate);
  if (Number.isNaN(d.getTime())) return '';
  return capitale(d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }));
}

/** Le jour court et son numéro : « sam. » / « 19 ». Bloc calendrier. */
export function dayParts(matchDate: string | null | undefined): { jour: string; numero: string } {
  if (!matchDate) return { jour: '', numero: '' };
  const d = new Date(matchDate);
  if (Number.isNaN(d.getTime())) return { jour: '', numero: '' };
  return { jour: JOURS_COURTS[d.getDay()], numero: String(d.getDate()) };
}

/** Le prénom seul. « Karim Bennani » → « Karim ». */
export function firstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}

/**
 * L'aperçu du dernier message : qui, puis quoi.
 *
 * `null` quand il n'y a rien à montrer — l'appelant écrit alors sa propre
 * phrase d'attente, qui n'est pas la même dans les deux listes.
 */
export function previewLine(
  content: string | null | undefined,
  senderName: string | null | undefined,
  fromMe: boolean,
): string | null {
  const texte = (content ?? '').replace(/\s+/g, ' ').trim();
  if (!texte) return null;
  const qui = fromMe ? 'Toi' : firstName(senderName);
  return qui ? `${qui} : ${texte}` : texte;
}

/**
 * Les prénoms des AUTRES joueurs, dans l'ordre reçu.
 *
 * Vide, la carte dit « Que toi pour l'instant » : une partie où personne
 * n'a encore rejoint n'a pas de deuxième ligne à afficher.
 */
export function othersLabel(names: string[]): string {
  const propres = names.map(firstName).filter(Boolean);
  return propres.length > 0 ? propres.join(', ') : 'Que toi pour l’instant';
}

/**
 * La phrase de la ligne « Demandes » : « Anaïs, Romain veulent t'écrire ».
 *
 * Au-delà de deux noms on compte, sinon la ligne déborde et se fait couper au
 * milieu d'un prénom.
 */
export function requestsLine(names: string[]): string {
  const propres = names.map(firstName).filter(Boolean);
  if (propres.length === 0) return "Quelqu'un veut t'écrire";
  if (propres.length === 1) return `${propres[0]} veut t'écrire`;
  if (propres.length === 2) return `${propres[0]}, ${propres[1]} veulent t'écrire`;
  return `${propres[0]}, ${propres[1]} et ${propres.length - 2} autre${propres.length - 2 > 1 ? 's' : ''} veulent t'écrire`;
}

/**
 * Les six couleurs de repli des initiales, quand un joueur n'a pas de photo.
 *
 * Tirees d'un hachage du NOM et non de la position : un joueur garde la meme
 * couleur d'une carte a l'autre et d'un ecran a l'autre. Par position, il
 * changeait de couleur selon l'ordre des participants — on croyait voir
 * quelqu'un d'autre.
 */
export const INITIALS_COLORS = ['#8B5CF6', '#EC4899', '#14B8A6', '#3B82F6', '#F59E0B', '#10B981'] as const;

export function initialsColor(name: string | null | undefined): string {
  const n = (name ?? '').trim();
  if (!n) return INITIALS_COLORS[0];
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  return INITIALS_COLORS[h % INITIALS_COLORS.length];
}
