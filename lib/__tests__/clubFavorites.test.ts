import { describe, it, expect } from 'vitest';
import { toggleFavorite, moveFavorite } from '../clubFavorites';

const LIST = ['CITY BALL', 'PADEL CLUB', 'PADEL ZONE', 'CASA PADEL'];

describe('toggleFavorite', () => {
  it('ajoute un club absent en fin de liste', () => {
    expect(toggleFavorite(LIST, 'WE PADEL')).toEqual([...LIST, 'WE PADEL']);
  });
  it('retire un club déjà favori', () => {
    expect(toggleFavorite(LIST, 'PADEL CLUB')).toEqual(['CITY BALL', 'PADEL ZONE', 'CASA PADEL']);
  });
  it('ne mute pas la liste d’origine', () => {
    const copy = [...LIST];
    toggleFavorite(LIST, 'WE PADEL');
    toggleFavorite(LIST, 'CITY BALL');
    expect(LIST).toEqual(copy);
  });
});

describe('moveFavorite', () => {
  it('monte un club d’une position', () => {
    expect(moveFavorite(LIST, 'PADEL ZONE', -1)).toEqual(['CITY BALL', 'PADEL ZONE', 'PADEL CLUB', 'CASA PADEL']);
  });
  it('descend un club d’une position', () => {
    expect(moveFavorite(LIST, 'PADEL CLUB', 1)).toEqual(['CITY BALL', 'PADEL ZONE', 'PADEL CLUB', 'CASA PADEL']);
  });
  it('monter le premier ne change rien', () => {
    expect(moveFavorite(LIST, 'CITY BALL', -1)).toEqual(LIST);
  });
  it('descendre le dernier ne change rien', () => {
    expect(moveFavorite(LIST, 'CASA PADEL', 1)).toEqual(LIST);
  });
  it('club inconnu → liste inchangée', () => {
    expect(moveFavorite(LIST, 'INCONNU', 1)).toEqual(LIST);
  });
  it('ne mute pas la liste d’origine', () => {
    const copy = [...LIST];
    moveFavorite(LIST, 'PADEL ZONE', -1);
    expect(LIST).toEqual(copy);
  });
});
