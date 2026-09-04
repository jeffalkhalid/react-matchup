import { describe, it, expect } from 'vitest';
import { fold, matchScore, searchAll, MIN_QUERY } from '../adminSearch';

describe('repli des accents', () => {
  it('rend comparables deux ecritures du meme nom', () => {
    expect(fold('Méhdi')).toBe('mehdi');
    expect(fold('EL AMRANI')).toBe('el amrani');
    expect(fold('  Anfá   Club  ')).toBe('anfa club');
  });

  it('ne casse pas sur du vide', () => {
    expect(fold(null)).toBe('');
    expect(fold(undefined)).toBe('');
  });
});

describe('pertinence', () => {
  it('classe egalite, debut, debut de mot, puis contenu', () => {
    expect(matchScore('anfa', 'Anfa')).toBe(100);
    expect(matchScore('anf', 'Anfa Club')).toBe(80);
    expect(matchScore('club', 'Anfa Club')).toBe(60);
    expect(matchScore('nfa', 'Anfa Club')).toBe(40);
  });

  it('LE NOM DE FAMILLE se cherche autant que le prenom', () => {
    // Sans le cas « debut de mot », chercher « amrani » ne remonterait
    // « Mehdi El Amrani » qu'au meme rang qu'une correspondance au milieu
    // d'un mot, donc derriere du bruit.
    expect(matchScore('amrani', 'Mehdi El Amrani')).toBe(60);
  });

  it('IGNORE LES ACCENTS des deux cotes', () => {
    // Le vrai piege : ILIKE en base les distingue, « mehdi » ne ramenerait
    // jamais « Mehdi » ecrit avec un accent.
    expect(matchScore('mehdi', 'Méhdi')).toBe(100);
    expect(matchScore('méhdi', 'Mehdi')).toBe(100);
  });

  it('rend null quand rien ne correspond', () => {
    expect(matchScore('zzz', 'Anfa')).toBe(null);
    expect(matchScore('', 'Anfa')).toBe(null);
    expect(matchScore('anfa', '')).toBe(null);
  });
});

describe('recherche globale', () => {
  const src = {
    players: [
      { id: 'p1', name: 'Méhdi El Amrani', frmt_full_name: 'EL AMRANI Mehdi' },
      { id: 'p2', name: 'Youssef Bennani', frmt_full_name: null },
      { id: 'p3', name: 'Sofia', frmt_full_name: 'MEHDAOUI Sofia' },
    ],
    games: [{ id: 'g1', location: 'Club Anfa', match_date: new Date(2026, 8, 4).toISOString() }],
    tournaments: [{ id: 't1', name: 'Montante du jeudi', club: { name: 'Anfa' } }],
  };

  it('cherche dans les trois familles a la fois', () => {
    const r = searchAll('anfa', src);
    expect(r.map(h => h.kind).sort()).toEqual(['game', 'tournament']);
  });

  it('trouve un joueur malgre l accent', () => {
    expect(searchAll('mehdi', src).map(h => h.id)).toContain('p1');
  });

  it('cherche AUSSI sur le nom FRMT, qui differe souvent du nom d usage', () => {
    // « Sofia » s'appelle MEHDAOUI a la federation : sans la recherche sur le
    // nom FRMT, un rattachement a verifier serait introuvable.
    const r = searchAll('mehdaoui', src);
    expect(r.map(h => h.id)).toEqual(['p3']);
  });

  it('classe le plus pertinent en premier', () => {
    const r = searchAll('anfa', src);
    // « Anfa » (le club du tournoi) est une egalite exacte, « Club Anfa »
    // un debut de mot.
    expect(r[0].kind).toBe('tournament');
  });

  it('NE REPOND PAS a une lettre isolee', () => {
    // Sans plancher, « a » ramenerait la base entiere et l'ecran deviendrait
    // inutilisable au premier caractere frappe.
    expect(searchAll('a', src)).toEqual([]);
    expect(MIN_QUERY).toBe(2);
  });

  it('borne le nombre de resultats', () => {
    const beaucoup = { players: Array.from({ length: 50 }, (_, i) => ({ id: `x${i}`, name: `Anfa ${i}` })) };
    expect(searchAll('anfa', beaucoup).length).toBe(12);
    expect(searchAll('anfa', beaucoup, 3).length).toBe(3);
  });

  it('le tri est STABLE : deux fois la meme recherche, le meme ordre', () => {
    const a = searchAll('anfa', src).map(h => h.id);
    const b = searchAll('anfa', src).map(h => h.id);
    expect(a).toEqual(b);
  });

  it('des sources absentes ne font pas planter la recherche', () => {
    expect(searchAll('anfa', {})).toEqual([]);
  });
});
