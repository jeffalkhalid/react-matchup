// lib/tournamentShare.ts — partager un tournoi, et le mettre à l'agenda.
//
// Deux gestes qui manquaient à la fiche : dire à ses partenaires qu'une soirée
// existe, et ne pas l'oublier.
//
// LE PARTAGE EST DU TEXTE, PAS UN LIEN. La passerelle web (`pagmatch.com`)
// sert /u/, /g/ et /p/ — il n'y a PAS de route pour un tournoi. Partager une
// adresse qui répond 404 serait pire que ne rien partager : celui qui la
// reçoit conclut que l'app est cassée. Le message porte donc tout ce qu'il
// faut pour décider — le nom, le jour, l'heure, le club, les places qui
// restent — et rien qu'on ne puisse honorer.
//
// L'AGENDA PASSE PAR UN FICHIER .ics, pas par `expo-calendar`. Ce module
// n'est pas installé, et l'ajouter demanderait une permission d'accès au
// calendrier plus une recompilation native — donc un nouvel APK, et rien dans
// Expo Go d'ici là. Un `.ics` partagé s'ouvre dans l'agenda de n'importe quel
// téléphone, ne demande aucune permission, et fonctionne dès aujourd'hui.

export interface ShareableTournament {
  id: string;
  name: string;
  starts_at: string;
  round_count: number;
  round_minutes?: number | null;
  court_count: number;
  club?: { name?: string | null } | null;
}

/** Minutes de jeu au total — sert à poser l'heure de fin dans l'agenda. */
function dureeMinutes(t: ShareableTournament): number {
  const m = typeof t.round_minutes === 'number' && t.round_minutes > 0 ? t.round_minutes : 15;
  return Math.max(1, t.round_count) * m;
}

/**
 * Le message qu'on envoie à ses partenaires.
 *
 * Écrit pour être collé dans une conversation, pas pour être joli : le jour,
 * l'heure et le club en premier, parce que c'est là-dessus qu'on répond oui
 * ou non. Les places restantes ne sont mises que si on les connaît — annoncer
 * « 0 place » sur une donnée absente ferait renoncer pour rien.
 */
export function tournamentShareText(
  t: ShareableTournament, placesLibres?: number | null,
): string {
  const d = new Date(t.starts_at);
  const quand = Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
      + ` à ${d.getHours()}h${String(d.getMinutes()).padStart(2, '0')}`;

  const lignes = [`🏆 ${t.name}`];
  if (quand) lignes.push(quand);
  if (t.club?.name) lignes.push(t.club.name);
  lignes.push(`${t.court_count} terrain${t.court_count > 1 ? 's' : ''} · ${t.round_count} rotations · ${hhmmCourt(dureeMinutes(t))}`);
  if (typeof placesLibres === 'number' && placesLibres > 0) {
    lignes.push(`Il reste ${placesLibres} place${placesLibres > 1 ? 's' : ''}.`);
  }
  lignes.push('On joue sur PagMatch.');
  return lignes.join('\n');
}

function hhmmCourt(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

/**
 * Une date au format iCalendar : `20260911T180000Z`.
 *
 * EN UTC, avec le `Z` final. Une date locale sans fuseau serait interprétée
 * dans le fuseau de CELUI QUI OUVRE le fichier : un tournoi de Casablanca
 * atterrirait à une autre heure dans l'agenda d'un joueur en déplacement.
 */
export function icsDate(d: Date): string {
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`
    + `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/**
 * Échappe un texte pour iCalendar.
 *
 * Le format sépare ses champs par des virgules et des points-virgules : un
 * club qui s'appelle « Anfa, Casablanca » couperait la ligne en deux et
 * l'agenda refuserait le fichier — ou pire, l'accepterait à moitié.
 */
export function icsEscape(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Le fichier d'agenda du tournoi.
 *
 * Les lignes sont séparées par CRLF — la norme l'exige, et certains agendas
 * rejettent un fichier en LF seul sans dire pourquoi.
 */
export function tournamentIcs(t: ShareableTournament, now: Date = new Date()): string {
  const debut = new Date(t.starts_at);
  const fin = new Date(debut.getTime() + dureeMinutes(t) * 60_000);
  const lieu = t.club?.name ?? '';
  const desc = `${t.court_count} terrains · ${t.round_count} rotations · montante/descente. Organisé sur PagMatch.`;

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PagMatch//Tournoi//FR',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:tournoi-${t.id}@pagmatch.com`,
    `DTSTAMP:${icsDate(now)}`,
    `DTSTART:${icsDate(debut)}`,
    `DTEND:${icsDate(fin)}`,
    `SUMMARY:${icsEscape(t.name)}`,
    ...(lieu ? [`LOCATION:${icsEscape(lieu)}`] : []),
    `DESCRIPTION:${icsEscape(desc)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

/** Un nom de fichier sûr, tiré du nom du tournoi. */
export function icsFileName(t: ShareableTournament): string {
  const base = t.name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 40);
  return `${base || 'tournoi'}.ics`;
}
