// Les mots et les dates de la liste des conversations.
//
// Trois pièges sont gardés ici : une étiquette qui compte en heures au lieu de
// jours de calendrier (un match à 23 h et un à 1 h du matin seraient « le même
// jour »), un aperçu qui affiche le prénom de l'expéditeur au lieu de « Toi »,
// et une ligne de demandes qui déborde dès trois noms.
import { describe, it, expect } from 'vitest';
import {
  relativeTime, dateTag, hourLabel, firstName, previewLine, othersLabel, requestsLine, dayGap,
  initialsColor, INITIALS_COLORS,
} from '../chatList';

// Jeudi 24 septembre 2026, 9 h 52 — l'heure des captures.
const now = new Date(2026, 8, 24, 9, 52, 0);
const le = (j: number, h = 12, m = 0) => new Date(2026, 8, j, h, m, 0).toISOString();

describe("l'écart se compte en jours de calendrier", () => {
  it('23 h 30 et 00 h 30 ne sont PAS le même jour', () => {
    // À 24 h fixes, ces deux instants tombent dans le même seau. Pour un
    // joueur, l'un est ce soir et l'autre demain.
    const soir = new Date(2026, 8, 24, 23, 30, 0);
    expect(dayGap(new Date(2026, 8, 25, 0, 30, 0), soir)).toBe(1);
  });

  it('rend null sur une date illisible', () => {
    expect(dayGap('pas une date', now)).toBeNull();
  });
});

describe("l'heure du dernier message", () => {
  it('à la seconde, puis en minutes, puis en heures', () => {
    expect(relativeTime(new Date(now.getTime() - 30_000).toISOString(), now)).toBe("à l'instant");
    expect(relativeTime(new Date(now.getTime() - 12 * 60_000).toISOString(), now)).toBe('12 min');
    expect(relativeTime(new Date(now.getTime() - 2 * 3_600_000).toISOString(), now)).toBe('2 h');
  });

  it('hier, puis le jour de la semaine, puis la date', () => {
    expect(relativeTime(le(23, 20), now)).toBe('hier');
    expect(relativeTime(le(21, 20), now)).toBe('lun.');
    expect(relativeTime(le(12, 20), now)).toBe('12 sept.');
  });

  it('ne rend rien sans message', () => {
    expect(relativeTime(null, now)).toBe('');
    expect(relativeTime('pas une date', now)).toBe('');
  });
});

describe("l'étiquette de date du match", () => {
  it('aujourd hui, demain, hier', () => {
    expect(dateTag(le(24, 20), now)).toEqual({ label: "AUJOURD'HUI", kind: 'today' });
    expect(dateTag(le(25, 19), now)).toEqual({ label: 'DEMAIN', kind: 'tomorrow' });
    expect(dateTag(le(23, 19), now)).toEqual({ label: 'HIER', kind: 'yesterday' });
  });

  it('au-delà, la date avec une majuscule', () => {
    const tag = dateTag(le(26, 14), now);
    expect(tag.kind).toBe('other');
    expect(tag.label).toBe('Sam. 26 sept.');
  });

  it('un match tard ce soir reste AUJOURD HUI', () => {
    expect(dateTag(le(24, 23, 30), now).kind).toBe('today');
  });
});

describe("l'heure du match", () => {
  it('se lit en 24 h', () => {
    expect(hourLabel(le(24, 20, 30))).toBe('20:30');
  });

  it('ne rend rien sans date', () => {
    expect(hourLabel(null)).toBe('');
  });
});

describe("l'aperçu du dernier message", () => {
  it('dit qui parle', () => {
    expect(previewLine('Je prends les balles', 'Karim Bennani', false)).toBe('Karim : Je prends les balles');
  });

  it('dit « Toi » quand c est moi', () => {
    // Le prénom de l'expéditeur serait techniquement juste et humainement
    // faux : on ne se lit pas à la troisième personne.
    expect(previewLine('Ok pour 20h', 'Jeff Alkhalid', true)).toBe('Toi : Ok pour 20h');
  });

  it('met les retours à la ligne à plat', () => {
    expect(previewLine('Salut\n\nOn joue ?', 'Lea', false)).toBe('Lea : Salut On joue ?');
  });

  it('ne rend rien sans message', () => {
    expect(previewLine(null, 'Karim', false)).toBeNull();
    expect(previewLine('   ', 'Karim', false)).toBeNull();
  });
});

describe('les autres joueurs', () => {
  it('sont listés par prénom', () => {
    expect(othersLabel(['Karim Bennani', 'Léa M.', 'Sofiane'])).toBe('Karim, Léa, Sofiane');
  });

  it('seul, la carte le dit plutôt que de laisser un blanc', () => {
    expect(othersLabel([])).toMatch(/Que toi/);
  });
});

describe('la ligne des demandes', () => {
  it('nomme un ou deux joueurs', () => {
    expect(requestsLine(['Anaïs P.'])).toBe("Anaïs veut t'écrire");
    expect(requestsLine(['Anaïs P.', 'Romain L.'])).toBe("Anaïs, Romain veulent t'écrire");
  });

  it('au-delà de deux, elle compte au lieu de déborder', () => {
    expect(requestsLine(['Anaïs', 'Romain', 'Léa'])).toBe("Anaïs, Romain et 1 autre veulent t'écrire");
    expect(requestsLine(['Anaïs', 'Romain', 'Léa', 'Hugo'])).toBe("Anaïs, Romain et 2 autres veulent t'écrire");
  });

  it('sans nom connu, elle reste une phrase', () => {
    expect(requestsLine([])).toBe("Quelqu'un veut t'écrire");
  });
});

describe('la couleur des initiales', () => {
  it('depend du nom, pas de la place dans la mosaique', () => {
    // Par position, un joueur changeait de couleur selon l'ordre des
    // participants : on croyait voir quelqu'un d'autre d'une carte a l'autre.
    expect(initialsColor('Karim Bennani')).toBe(initialsColor('Karim Bennani'));
    expect(INITIALS_COLORS).toContain(initialsColor('Karim Bennani'));
  });

  it('deux noms differents ne tombent pas systematiquement pareil', () => {
    const vues = new Set(['Karim', 'Lea', 'Sofiane', 'Thomas', 'Yanis', 'Mehdi'].map(initialsColor));
    expect(vues.size).toBeGreaterThan(1);
  });

  it('sans nom, elle reste une couleur de la palette', () => {
    expect(INITIALS_COLORS).toContain(initialsColor(null));
    expect(INITIALS_COLORS).toContain(initialsColor('   '));
  });
});
