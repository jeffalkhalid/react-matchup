// Les exigences d'un mot de passe, et la phrase qui dit ce qui manque.
//
// La règle était écrite deux fois et différemment : le bouton d'inscription
// s'activait à 6 caractères sous un champ annonçant « 8 caractères min. ».
import { describe, it, expect } from 'vitest';
import {
  PASSWORD_MIN, PASSWORD_RULES, passwordProblems, isPasswordValid,
  passwordError, passwordServerError, passwordResetSendError,
} from '../password';

describe('ce qu on exige', () => {
  it('huit caractères, une majuscule, une minuscule, un chiffre', () => {
    expect(PASSWORD_MIN).toBe(8);
    expect(PASSWORD_RULES.map(r => r.key)).toEqual(['length', 'upper', 'lower', 'digit']);
  });

  it('un mot de passe complet passe', () => {
    expect(isPasswordValid('Padel2026')).toBe(true);
  });

  it('sept caractères ne suffisent pas, même bien composés', () => {
    expect(isPasswordValid('Padel26')).toBe(false);
    expect(passwordProblems('Padel26').map(r => r.key)).toEqual(['length']);
  });

  it('sans majuscule, sans minuscule ou sans chiffre, on refuse', () => {
    expect(passwordProblems('padel2026').map(r => r.key)).toEqual(['upper']);
    expect(passwordProblems('PADEL2026').map(r => r.key)).toEqual(['lower']);
    expect(passwordProblems('PadelPadel').map(r => r.key)).toEqual(['digit']);
  });

  it('les accents comptent comme des lettres', () => {
    // « Éléphant1 » a bien une majuscule et des minuscules.
    expect(isPasswordValid('Éléphant1')).toBe(true);
  });

  it('un espace ou un symbole ne gêne pas', () => {
    expect(isPasswordValid('Mon mot 2 passe')).toBe(true);
    expect(isPasswordValid('Padel-2026!')).toBe(true);
  });

  it('un mot de passe vide manque de tout', () => {
    expect(passwordProblems('').map(r => r.key)).toEqual(['length', 'upper', 'lower', 'digit']);
  });
});

describe('la phrase qui dit ce qui manque', () => {
  it('rien à dire quand tout est bon', () => {
    expect(passwordError('Padel2026')).toBeNull();
  });

  it('un seul manque se dit simplement', () => {
    expect(passwordError('padel2026')).toBe('Il manque une majuscule.');
  });

  it('plusieurs manques sont énumérés en une fois', () => {
    // Corriger un defaut pour en decouvrir un autre au tap suivant fait
    // abandonner : on dit tout d'un coup.
    expect(passwordError('padel')).toBe('Il manque 8 caractères minimum, une majuscule et un chiffre.');
  });

  it('un mot de passe vide énumère les quatre', () => {
    expect(passwordError('')).toContain('8 caractères minimum, une majuscule, une minuscule et un chiffre');
  });
});

describe('le refus venu du serveur', () => {
  it('un mot de passe trop faible redonne la règle entière', () => {
    expect(passwordServerError('Password should be at least 6 characters'))
      .toBe('Mot de passe refusé : il faut 8 caractères minimum, une majuscule, une minuscule et un chiffre.');
  });

  it('un mot de passe identique à l ancien le dit', () => {
    expect(passwordServerError('New password should be different from the old password.'))
      .toBe('Choisis un mot de passe différent de l’ancien.');
  });

  it('on ne relaie jamais l anglais de Supabase', () => {
    const rendu = passwordServerError('unexpected_failure: database timeout');
    expect(rendu).toBe('Impossible de mettre à jour le mot de passe. Réessaie.');
    expect(rendu).not.toContain('database');
  });

  it('un message absent ne fait pas planter', () => {
    expect(passwordServerError(null)).toContain('Réessaie');
    expect(passwordServerError(undefined)).toContain('Réessaie');
  });
});

describe("l envoi du lien de changement", () => {
  it("le quota d emails se dit en clair", () => {
    // L envoi d emails d authentification est bride tant que le SMTP dedie
    // n est pas en place : sans traduction, le refus est incomprehensible.
    expect(passwordResetSendError('For security purposes, over_email_send_rate_limit'))
      .toBe('Trop de demandes en peu de temps. Patiente quelques minutes puis réessaie.');
  });

  it("une panne reseau se distingue du quota", () => {
    expect(passwordResetSendError('Network request failed')).toContain('réseau');
  });

  it("le reste reste comprehensible", () => {
    expect(passwordResetSendError('boom')).toBe("L'email n'a pas pu être envoyé. Réessaie dans un instant.");
  });
});
