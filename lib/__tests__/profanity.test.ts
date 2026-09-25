import { describe, it, expect } from 'vitest';
import { containsProfanity, normalize } from '../profanity';

describe('normalize', () => {
  it('aplatit accents, leetspeak et ponctuation', () => {
    expect(normalize('Bravo ! Match très disputé')).toBe('bravo match tres dispute');
    expect(normalize('C0NN@RD')).toBe('connord');   // 0 et @ deviennent o
    expect(normalize('connard!')).toBe('connard'); // le ! final n'est pas un i
  });
});

describe('containsProfanity — ce qui doit PASSER', () => {
  // Le bug : « disputé » contient « pute » une fois les accents aplatis. Une
  // phrase de padel parfaitement normale était refusée.
  it('laisse passer un commentaire de match normal', () => {
    expect(containsProfanity('Bravo ! Match très disputé')).toBe(false);
  });

  it('laisse passer les mots qui CONTIENNENT un gros mot par hasard', () => {
    for (const phrase of [
      'On s’est disputé le premier set',
      'Une dispute sur le score',
      'Sa réputation n’est plus à faire',
      'Match amputé d’un set',
      'Je joue en Nike',
      'Rendez-vous à la clinique',
      'Merci Mokhtar pour le match',
      'Bien joué les gars',
    ]) {
      expect(containsProfanity(phrase), phrase).toBe(false);
    }
  });

  it('laisse passer le vide et la ponctuation seule', () => {
    expect(containsProfanity('')).toBe(false);
    expect(containsProfanity('!!! ??? ...')).toBe(false);
  });
});

describe('containsProfanity — ce qui doit être REFUSÉ', () => {
  it('attrape une insulte isolée', () => {
    expect(containsProfanity('connard')).toBe(true);
    expect(containsProfanity('t’es vraiment un abruti')).toBe(true);
    expect(containsProfanity('quelle salope')).toBe(true);
  });

  it('attrape le pluriel', () => {
    expect(containsProfanity('bande de putes')).toBe(true);
    expect(containsProfanity('des connards')).toBe(true);
  });

  it('attrape les lettres répétées', () => {
    expect(containsProfanity('salopeeee')).toBe(true);
    expect(containsProfanity('puuuute')).toBe(true);
  });

  it('attrape le leetspeak', () => {
    expect(containsProfanity('c0nnard')).toBe(true);
    expect(containsProfanity('n1quer')).toBe(true);
    expect(containsProfanity('9ahba')).toBe(true);
  });

  it('attrape une insulte longue collée à un autre mot', () => {
    expect(containsProfanity('vasyconnard')).toBe(true);
    expect(containsProfanity('grosputain')).toBe(true);
  });
});
