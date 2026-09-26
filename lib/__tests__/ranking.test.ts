import { describe, it, expect, vi } from 'vitest';

// Les fonctions éprouvées ici sont pures — elles ne parlent à personne. Mais le
// module importe le client Supabase, qui réclame le stockage du téléphone :
// on le remplace par une coquille vide, comme le fait circleAlert.test.
vi.mock('../supabase', () => ({ supabase: {} }));
import { leagueBounds, pageOffset, aEncoreDesPages, pageDuRang, restreintARien, RANKING_PAGE } from '../ranking';
import { getLeague } from '../theme';

describe('bornes de ligue', () => {
  // Le filtre du classement et l'étiquette d'une ligne doivent dire la même
  // chose. Ce test échoue si l'un des deux bouge sans l'autre.
  it('encadrent exactement ce que getLeague renvoie', () => {
    const ligues = ['discovery', 'bronze', 'silver', 'gold', 'diamond'] as const;
    for (const l of ligues) {
      const { min, max } = leagueBounds(l);
      if (min !== null) expect(getLeague(min)).toBe(l);
      if (max !== null) expect(getLeague(max)).toBe(l);
      // Juste en dessous / au-dessus, on doit sortir de la ligue.
      if (min !== null) expect(getLeague(min - 1)).not.toBe(l);
      if (max !== null) expect(getLeague(max + 1)).not.toBe(l);
    }
  });

  it('« tous » n’impose aucune borne', () => {
    expect(leagueBounds('tous')).toEqual({ min: null, max: null });
  });
});

describe('découpage en pages', () => {
  it('la première page part de zéro', () => {
    expect(pageOffset(0)).toBe(0);
  });

  it('chaque page suivante décale d’une page entière', () => {
    expect(pageOffset(1)).toBe(RANKING_PAGE);
    expect(pageOffset(4)).toBe(RANKING_PAGE * 4);
  });

  it('une page négative ne remonte pas avant le début', () => {
    expect(pageOffset(-3)).toBe(0);
  });
});

describe('reste-t-il des pages', () => {
  it('une page pleine laisse supposer une suite', () => {
    expect(aEncoreDesPages(RANKING_PAGE)).toBe(true);
  });

  it('une page incomplète est la dernière', () => {
    expect(aEncoreDesPages(RANKING_PAGE - 1)).toBe(false);
    expect(aEncoreDesPages(0)).toBe(false);
  });
});

describe('aller à sa position', () => {
  it('les premiers rangs sont sur la première page', () => {
    expect(pageDuRang(1)).toBe(0);
    expect(pageDuRang(RANKING_PAGE)).toBe(0);
  });

  it('le rang juste après bascule sur la page suivante', () => {
    expect(pageDuRang(RANKING_PAGE + 1)).toBe(1);
  });

  it('un rang lointain tombe sur la bonne page', () => {
    // 347e avec des pages de 50 → pages 0..6, la 347e est sur la 7e (index 6).
    expect(pageDuRang(347, 50)).toBe(6);
  });

  it('un rang aberrant ne sort pas du tableau', () => {
    expect(pageDuRang(0)).toBe(0);
    expect(pageDuRang(-5)).toBe(0);
  });
});

describe('onglet Amis', () => {
  // Le piège : une liste vide ressemble à « pas de filtre ». Quelqu'un qui ne
  // suit personne verrait alors le classement entier dans son onglet Amis.
  it('une liste d’amis vide veut dire « personne », pas « tout le monde »', () => {
    expect(restreintARien([])).toBe(true);
  });

  it('pas de liste du tout veut bien dire « pas de filtre »', () => {
    expect(restreintARien(null)).toBe(false);
    expect(restreintARien(undefined)).toBe(false);
  });

  it('une liste non vide filtre normalement', () => {
    expect(restreintARien(['a', 'b'])).toBe(false);
  });
});
