import { describe, it, expect } from 'vitest';
import {
  tournamentShareText, tournamentIcs, icsDate, icsEscape, icsFileName,
  type ShareableTournament,
} from '../tournamentShare';

const T = (o: Partial<ShareableTournament> = {}): ShareableTournament => ({
  id: 'abc',
  name: 'Montante du jeudi',
  starts_at: new Date(Date.UTC(2026, 8, 11, 18, 0)).toISOString(),
  round_count: 6,
  round_minutes: 20,
  court_count: 2,
  club: { name: 'Padel 4 Maroc' },
  ...o,
});

describe('message de partage', () => {
  it('porte le nom, le quand, le club et le format', () => {
    const txt = tournamentShareText(T());
    expect(txt).toContain('Montante du jeudi');
    expect(txt).toContain('Padel 4 Maroc');
    expect(txt).toContain('2 terrains');
    expect(txt).toContain('6 rotations');
    expect(txt).toContain('2h');   // 6 x 20 min
  });

  it('n annonce les places QUE si on les connait', () => {
    // Annoncer « 0 place » sur une donnee absente ferait renoncer pour rien.
    expect(tournamentShareText(T(), null)).not.toContain('place');
    expect(tournamentShareText(T(), 0)).not.toContain('Il reste');
    expect(tournamentShareText(T(), 3)).toContain('Il reste 3 places');
    expect(tournamentShareText(T(), 1)).toContain('Il reste 1 place.');
  });

  it('survit a une date illisible sans afficher « Invalid Date »', () => {
    const txt = tournamentShareText(T({ starts_at: 'bof' }));
    expect(txt).not.toMatch(/Invalid/i);
    expect(txt).toContain('Montante du jeudi');
  });

  it('tient sans club', () => {
    expect(tournamentShareText(T({ club: null }))).toContain('Montante du jeudi');
  });
});

describe('date iCalendar', () => {
  it('est en UTC, avec le Z final', () => {
    // Sans fuseau, un tournoi de Casablanca atterrirait a une autre heure dans
    // l'agenda d'un joueur en deplacement.
    expect(icsDate(new Date(Date.UTC(2026, 8, 11, 18, 5, 3)))).toBe('20260911T180503Z');
  });

  it('complete les chiffres a deux positions', () => {
    expect(icsDate(new Date(Date.UTC(2026, 0, 2, 3, 4, 5)))).toBe('20260102T030405Z');
  });
});

describe('echappement iCalendar', () => {
  it('protege les virgules et points-virgules', () => {
    // « Anfa, Casablanca » couperait la ligne en deux et l'agenda refuserait
    // le fichier — ou pire, l'accepterait a moitie.
    expect(icsEscape('Anfa, Casablanca')).toBe('Anfa\\, Casablanca');
    expect(icsEscape('a;b')).toBe('a\\;b');
  });

  it('protege les antislashs et les retours a la ligne', () => {
    // Un antislash brut doit devenir DOUBLE, sinon il echappe le caractere
    // suivant et decale tout le reste de la ligne.
    expect(icsEscape('a\\b')).toBe('a\\\\b');
    // Un vrai retour a la ligne devient la sequence litterale \n : une ligne
    // coupee en deux dans un .ics rend le fichier invalide.
    expect(icsEscape('a\nb')).toBe('a\\nb');
  });
});

describe('fichier agenda', () => {
  const now = new Date(Date.UTC(2026, 8, 7, 10, 0));

  it('pose la fin d apres la duree reelle des rotations', () => {
    // 6 rotations x 20 min = 2 h.
    const ics = tournamentIcs(T(), now);
    expect(ics).toContain('DTSTART:20260911T180000Z');
    expect(ics).toContain('DTEND:20260911T200000Z');
  });

  it('retombe sur 15 min quand la duree n est pas connue', () => {
    // round_minutes est optionnel tant que la migration n est pas partout.
    const ics = tournamentIcs(T({ round_minutes: null }), now);
    expect(ics).toContain('DTEND:20260911T193000Z');   // 6 x 15 = 1 h 30
  });

  it('separe ses lignes par CRLF, comme la norme l exige', () => {
    // Certains agendas rejettent un fichier en LF seul sans dire pourquoi.
    const ics = tournamentIcs(T(), now);
    expect(ics.includes('\r\n')).toBe(true);
    expect(ics.split('\r\n')[0]).toBe('BEGIN:VCALENDAR');
  });

  it('omet le lieu plutot que d ecrire une ligne vide', () => {
    expect(tournamentIcs(T({ club: null }), now)).not.toContain('LOCATION:');
  });

  it('donne un identifiant stable a l evenement', () => {
    // Reimporte deux fois, l'agenda met a jour au lieu de dupliquer.
    expect(tournamentIcs(T(), now)).toContain('UID:tournoi-abc@pagmatch.com');
  });
});

describe('nom de fichier', () => {
  it('retire accents et ponctuation', () => {
    expect(icsFileName(T({ name: 'Montée · Été 2026 !' }))).toBe('montee-ete-2026.ics');
  });

  it('a toujours un nom, meme sur un titre exotique', () => {
    expect(icsFileName(T({ name: '???' }))).toBe('tournoi.ics');
  });
});
