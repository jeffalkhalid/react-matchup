import { describe, it, expect } from 'vitest';
import {
  isBatchable, toggleSelected, toggleAll, pruneSelection,
  selectionLabel, batchConfirmText,
} from '../batchModeration';

describe('ce qui peut se traiter en lot', () => {
  it('on classe en lot, on ne SANCTIONNE jamais en lot', () => {
    // La regle du fichier, et la seule qui compte : « classer sans suite »
    // n'accuse personne, « retenir » marque un joueur. Un bouton « tout
    // retenir » aurait l'air symetrique ; il ne l'est pas.
    expect(isBatchable('dismissed')).toBe(true);
    expect(isBatchable('actioned')).toBe(false);
  });
});

describe('selection', () => {
  it('ajoute puis retire', () => {
    expect(toggleSelected([], 'a')).toEqual(['a']);
    expect(toggleSelected(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('ne modifie pas la selection qu on lui donne', () => {
    const src = ['a'];
    const copie = [...src];
    toggleSelected(src, 'b');
    expect(src).toEqual(copie);
  });

  it('« tout selectionner » BASCULE : deux appels et on est revenu a vide', () => {
    // Sans la bascule, il faudrait decocher un par un pour sortir du mode.
    const tous = ['a', 'b', 'c'];
    const plein = toggleAll([], tous);
    expect(plein).toEqual(tous);
    expect(toggleAll(plein, tous)).toEqual([]);
  });

  it('« tout selectionner » sur une selection PARTIELLE complete au lieu de vider', () => {
    expect(toggleAll(['a'], ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('une liste vide ne se remplit pas', () => {
    expect(toggleAll([], [])).toEqual([]);
  });
});

describe('nettoyage apres traitement', () => {
  it('OUBLIE les dossiers qui ont disparu de la liste', () => {
    // Apres un lot, la liste se recharge sans les dossiers regles. Les garder
    // enverrait au serveur des lignes deja classees, et afficherait
    // « 3 selectionnes » sur une liste qui n'en montre qu'un.
    expect(pruneSelection(['a', 'b', 'c'], ['b'])).toEqual(['b']);
  });

  it('ne rend rien quand la liste est vide', () => {
    expect(pruneSelection(['a', 'b'], [])).toEqual([]);
  });

  it('laisse intacte une selection entierement valide', () => {
    expect(pruneSelection(['a', 'b'], ['a', 'b', 'c'])).toEqual(['a', 'b']);
  });
});

describe('libelles', () => {
  it('accorde le pluriel et nomme le cas vide', () => {
    expect(selectionLabel(0)).toBe('Aucun signalement sélectionné');
    expect(selectionLabel(1)).toBe('1 signalement sélectionné');
    expect(selectionLabel(4)).toBe('4 signalements sélectionnés');
  });

  it('la confirmation DIT LE NOMBRE, parce qu un lot se defait un par un', () => {
    expect(batchConfirmText(1)).toContain('Ce signalement sera classé');
    expect(batchConfirmText(6)).toContain('Ces 6 signalements seront classés');
  });

  it('la confirmation rassure sur ce qui ne se passe PAS', () => {
    expect(batchConfirmText(3)).toContain('Personne n’est sanctionné');
  });
});
