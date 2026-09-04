import { describe, it, expect } from 'vitest';
import {
  formatCode, deviceName, matchesLabel, lastSeenLabel, linkedSinceLabel,
} from '../watchLink';

describe('formatCode', () => {
  it('coupe le code en deux groupes de trois pour la lisibilite', () => {
    expect(formatCode('123456')).toBe('123 456');
  });
  it('laisse intact ce qui ne fait pas six chiffres', () => {
    expect(formatCode('12345')).toBe('12345');
    expect(formatCode('')).toBe('');
  });
});

const now = new Date(2026, 8, 4, 18, 30, 0);
const ilYA = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

describe('nom de l appareil', () => {
  it('retombe sur « Montre » quand le nom manque ou est vide', () => {
    expect(deviceName({ device_label: null })).toBe('Montre');
    expect(deviceName({ device_label: '   ' })).toBe('Montre');
  });
  it('garde le nom choisi par le joueur', () => {
    expect(deviceName({ device_label: 'Galaxy Watch' })).toBe('Galaxy Watch');
  });
});

describe('nombre de matchs marques', () => {
  it('accorde le pluriel, et dit « aucun » plutot que « 0 »', () => {
    expect(matchesLabel(0)).toBe('Aucun match marqué depuis cette montre');
    expect(matchesLabel(1)).toBe('1 match marqué depuis cette montre');
    expect(matchesLabel(7)).toBe('7 matchs marqués depuis cette montre');
  });
  it('un compte negatif ne produit pas « -2 matchs »', () => {
    expect(matchesLabel(-2)).toBe('Aucun match marqué depuis cette montre');
  });
});

describe('derniere synchro', () => {
  it('distingue jamais utilisee d une date illisible... en les traitant pareil', () => {
    expect(lastSeenLabel(null, now)).toBe('Jamais utilisée');
    expect(lastSeenLabel('pas une date', now)).toBe('Jamais utilisée');
  });

  it('passe des minutes a l heure du jour, puis a la date', () => {
    expect(lastSeenLabel(ilYA(1), now)).toBe('À l’instant');
    expect(lastSeenLabel(ilYA(20), now)).toBe('Il y a 20 min');
    expect(lastSeenLabel(new Date(2026, 8, 4, 9, 5).toISOString(), now)).toBe('Aujourd’hui à 9h05');
    expect(lastSeenLabel(new Date(2026, 8, 3, 21, 40).toISOString(), now)).toBe('Hier à 21h40');
    expect(lastSeenLabel(new Date(2026, 7, 30, 12, 0).toISOString(), now)).toMatch(/^Le 30 août/);
  });

  it('une montre EN AVANCE sur le telephone se lit « a l instant », pas « il y a -3 min »', () => {
    // L'horloge d'une montre derive : sans borne, une synchro datee dans le
    // futur affichait un nombre negatif de minutes.
    const futur = new Date(now.getTime() + 3 * 60_000).toISOString();
    expect(lastSeenLabel(futur, now)).toBe('À l’instant');
  });

  it('une minuit franchie bascule sur « Hier », pas sur « Il y a 55 min »', () => {
    const minuitPasse = new Date(2026, 8, 5, 0, 20, 0);
    expect(lastSeenLabel(new Date(2026, 8, 4, 23, 50).toISOString(), minuitPasse))
      .toBe('Il y a 30 min');
    expect(lastSeenLabel(new Date(2026, 8, 4, 22, 10).toISOString(), minuitPasse))
      .toBe('Hier à 22h10');
  });
});

describe('date de liaison', () => {
  it('donne le mois en toutes lettres', () => {
    expect(linkedSinceLabel(new Date(2026, 7, 12, 10, 0).toISOString()))
      .toBe('Connectée depuis le 12 août');
  });
  it('ne rend rien pour une date illisible', () => {
    expect(linkedSinceLabel('n importe quoi')).toBe('');
  });
});
