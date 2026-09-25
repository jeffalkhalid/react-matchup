import { describe, it, expect } from 'vitest';
import { splitFullName, prettyFrmtName, profileIdentity, realNameLine } from '../frmt-match';

describe('splitFullName', () => {
  it('coupe au PREMIER espace : le nom compose reste dans le nom', () => {
    expect(splitFullName('Yassine El Amrani')).toEqual({ first: 'Yassine', last: 'El Amrani' });
  });

  it('recoller prenom + nom redonne la chaine d\'origine', () => {
    const s = 'Mohamed Amine El Idrissi';
    const { first, last } = splitFullName(s);
    expect(`${first} ${last}`).toBe(s);
  });

  it('tolere le vide, les espaces en trop et le mot unique', () => {
    expect(splitFullName(null)).toEqual({ first: '', last: '' });
    expect(splitFullName('  Karim   Benani ')).toEqual({ first: 'Karim', last: 'Benani' });
    expect(splitFullName('Yassine')).toEqual({ first: 'Yassine', last: '' });
  });
});

describe('prettyFrmtName', () => {
  // La FRMT publie en majuscules. On adoucit la casse SANS toucher aux mots ni
  // a leur ordre : « IRROU ALAMINE » reste « Irrou Alamine », jamais l'inverse.
  it('adoucit la casse sans reordonner', () => {
    expect(prettyFrmtName('IRROU ALAMINE')).toBe('Irrou Alamine');
    expect(prettyFrmtName('ALAMI MOHAMED')).toBe('Alami Mohamed');
  });

  it('gere les traits d\'union, les espaces en trop et le vide', () => {
    expect(prettyFrmtName('EL IDRISSI MOHAMED-AMINE')).toBe('El Idrissi Mohamed-Amine');
    expect(prettyFrmtName('  IRROU   ALAMINE  ')).toBe('Irrou Alamine');
    expect(prettyFrmtName(null)).toBe('');
  });
});

describe('profileIdentity', () => {
  // Joueur lie au classement : le nom vient de la federation, en un seul bloc.
  // On ne le decoupe pas en prenom/nom — la FRMT ecrit « NOM PRENOM », l'inverse
  // d'ici, donc tout decoupage inverserait les deux.
  it('joueur FRMT lie : le nom du classement, non modifiable', () => {
    expect(profileIdentity({ frmt_verified: true }, 'IRROU ALAMINE'))
      .toEqual({ mode: 'frmt', full: 'Irrou Alamine' });
  });

  it('verifie mais sans ligne de classement lue : on retombe sur la saisie libre', () => {
    expect(profileIdentity({ frmt_verified: true, first_name: 'Alamine', last_name: 'Irrou' }, null))
      .toEqual({ mode: 'free', first: 'Alamine', last: 'Irrou' });
  });

  it('joueur normal : ce qu\'il a renseigne', () => {
    expect(profileIdentity({ first_name: 'Karim', last_name: 'Benani' }))
      .toEqual({ mode: 'free', first: 'Karim', last: 'Benani' });
  });

  it('a defaut, le nom FRMT declare au signup pre-remplit les deux champs', () => {
    expect(profileIdentity({ frmt_full_name: 'Yassine El Amrani' }))
      .toEqual({ mode: 'free', first: 'Yassine', last: 'El Amrani' });
  });

  it('une chaine vide en base vaut une absence de nom', () => {
    expect(profileIdentity({ first_name: '', last_name: '  ', frmt_full_name: 'Karim Benani' }))
      .toEqual({ mode: 'free', first: 'Karim', last: 'Benani' });
  });

  it('profil vide : deux champs vides, modifiables', () => {
    expect(profileIdentity({})).toEqual({ mode: 'free', first: '', last: '' });
  });
});

describe('realNameLine', () => {
  it('joueur FRMT lie : le nom du classement, toujours affiche', () => {
    // Le reglage ne s'applique PAS a un joueur classe : son nom federal
    // l'identifie deja publiquement.
    expect(realNameLine({ frmt_verified: true, show_real_name: false }, 'IRROU ALAMINE'))
      .toBe('Irrou Alamine');
  });

  it('le nom d\'un joueur FRMT ne vient JAMAIS de sa saisie', () => {
    // Sinon : se lier sous le nom d'un classe, puis afficher le sien — le vol
    // de classement deviendrait invisible.
    expect(realNameLine({ frmt_verified: true, first_name: 'Karim', last_name: 'Benani' }, 'IRROU ALAMINE'))
      .toBe('Irrou Alamine');
  });

  it('joueur normal : ce qu\'il a renseigne, si la case est cochee', () => {
    expect(realNameLine({ first_name: 'Karim', last_name: 'Benani', show_real_name: true }))
      .toBe('Karim Benani');
  });

  it('case decochee : rien', () => {
    expect(realNameLine({ first_name: 'Karim', last_name: 'Benani', show_real_name: false })).toBe(null);
  });

  it('colonne absente (avant migration) : on affiche, la case est cochee par defaut', () => {
    expect(realNameLine({ first_name: 'Karim', last_name: 'Benani' })).toBe('Karim Benani');
  });

  it('pas de nom du tout : rien', () => {
    expect(realNameLine({ show_real_name: true })).toBe(null);
    expect(realNameLine({ frmt_verified: true }, null)).toBe(null);
  });

  it('un seul des deux champs renseigne : on affiche ce qu\'on a', () => {
    expect(realNameLine({ first_name: 'Karim' })).toBe('Karim');
    expect(realNameLine({ last_name: 'Benani' })).toBe('Benani');
  });
});
