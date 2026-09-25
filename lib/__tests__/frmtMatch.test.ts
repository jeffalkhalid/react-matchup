import { describe, it, expect } from 'vitest';
import { splitFullName, profileIdentity } from '../frmt-match';

describe('splitFullName', () => {
  it('coupe au PREMIER espace : le nom compose reste dans le nom', () => {
    expect(splitFullName('Yassine El Amrani')).toEqual({ first: 'Yassine', last: 'El Amrani' });
    expect(splitFullName('Karim Benani')).toEqual({ first: 'Karim', last: 'Benani' });
  });

  it('recoller prenom + nom redonne la chaine d\'origine', () => {
    const s = 'Mohamed Amine El Idrissi';
    const { first, last } = splitFullName(s);
    expect(`${first} ${last}`).toBe(s);
  });

  it('tolere le vide, les espaces en trop et le mot unique', () => {
    expect(splitFullName(null)).toEqual({ first: '', last: '' });
    expect(splitFullName('   ')).toEqual({ first: '', last: '' });
    expect(splitFullName('  Karim   Benani ')).toEqual({ first: 'Karim', last: 'Benani' });
    expect(splitFullName('Yassine')).toEqual({ first: 'Yassine', last: '' });
  });
});

describe('profileIdentity', () => {
  it('prend l\'identite stockee en priorite, et la verrouille pour un joueur verifie', () => {
    expect(profileIdentity({
      first_name: 'Karim', last_name: 'Benani',
      frmt_full_name: 'Autre Nom', frmt_verified: true,
    })).toEqual({ first: 'Karim', last: 'Benani', locked: true });
  });

  it('a defaut, decoupe le nom FRMT declare', () => {
    expect(profileIdentity({ frmt_full_name: 'Yassine El Amrani', frmt_verified: false }))
      .toEqual({ first: 'Yassine', last: 'El Amrani', locked: false });
  });

  // LE BUG : Alamine est verifie (position 811) mais n'a AUCUN nom dans players
  // — son nom federal vit dans frmt_rankings (« IRROU ALAMINE », ordre NOM
  // PRENOM). Verrouiller sur le seul frmt_verified donnait deux champs vides ET
  // grises : rien a lire, rien a saisir.
  it('verifie mais SANS nom stocke : champs vides et MODIFIABLES', () => {
    expect(profileIdentity({
      first_name: null, last_name: null, frmt_full_name: null, frmt_verified: true,
    })).toEqual({ first: '', last: '', locked: false });
  });

  it('ne verrouille jamais un champ vide, meme si l\'autre est rempli', () => {
    expect(profileIdentity({ frmt_full_name: 'Yassine', frmt_verified: true }))
      .toEqual({ first: 'Yassine', last: '', locked: false });
  });

  it('traite la chaine vide comme une absence de nom', () => {
    expect(profileIdentity({ first_name: '', last_name: '  ', frmt_full_name: 'Karim Benani', frmt_verified: false }))
      .toEqual({ first: 'Karim', last: 'Benani', locked: false });
  });

  it('un joueur non verifie n\'est jamais verrouille', () => {
    expect(profileIdentity({ first_name: 'Karim', last_name: 'Benani', frmt_verified: false }).locked).toBe(false);
  });

  it('profil vide : rien, et modifiable', () => {
    expect(profileIdentity({})).toEqual({ first: '', last: '', locked: false });
  });
});
