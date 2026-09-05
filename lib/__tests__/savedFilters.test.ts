import { describe, it, expect } from 'vitest';
import {
  alertCoverage, canAlert, suggestFilterName, hydrateFilter, normalizeFilterName,
} from '../savedFilters';
import { NO_EXPLORE_FILTERS, type ExploreFilters } from '../exploreFilters';

const f = (o: Partial<ExploreFilters> = {}): ExploreFilters => ({ ...NO_EXPLORE_FILTERS, ...o });

describe('ce qu une alerte sait surveiller', () => {
  it('separe les criteres STABLES de ceux qui dependent du moment', () => {
    // « Ce week-end » n'a aucun sens en alerte permanente : quel week-end ?
    const c = alertCoverage(f({ cities: ['Casablanca'], date: 'weekend', urgentOnly: true }));
    expect(c.watched).toEqual(['Ville']);
    expect(c.ignored).toEqual(['Date', 'Urgent']);
  });

  it('club, ville, type, genre, plage et niveau sont surveilles', () => {
    const c = alertCoverage(f({
      clubs: ['ACSA'], cities: ['Rabat'], type: 'friendly',
      gender: 'mixed', slot: 'evening', level: 'mine',
    }));
    expect(c.watched).toEqual(['Club', 'Ville', 'Type de match', 'Genre', 'Plage horaire', 'Niveau']);
    expect(c.ignored).toEqual([]);
  });

  it('date, places, urgent et recherche sont IGNORES par l alerte', () => {
    const c = alertCoverage(f({ date: 'today', spots: 1, urgentOnly: true, search: 'anfa' }));
    expect(c.watched).toEqual([]);
    expect(c.ignored).toEqual(['Date', 'Places libres', 'Urgent', 'Recherche']);
  });
});

describe('une alerte doit avoir un critere stable', () => {
  it('REFUSE une alerte qui previendrait a chaque partie creee', () => {
    // Sans critere stable, ce n'est pas une alerte, c'est du bruit.
    expect(canAlert(NO_EXPLORE_FILTERS)).toBe(false);
    expect(canAlert(f({ date: 'weekend', urgentOnly: true }))).toBe(false);
  });

  it('accepte des qu un critere stable est pose', () => {
    expect(canAlert(f({ cities: ['Casablanca'] }))).toBe(true);
    expect(canAlert(f({ slot: 'evening' }))).toBe(true);
  });
});

describe('nom propose', () => {
  it('decrit ce que le filtre dit vraiment', () => {
    expect(suggestFilterName(f({ cities: ['Casablanca'], slot: 'evening' })))
      .toBe('Casablanca · Soir');
  });

  it('compte au lieu d enumerer quand il y en a plusieurs', () => {
    expect(suggestFilterName(f({ cities: ['Casablanca', 'Rabat'] }))).toBe('2 villes');
    expect(suggestFilterName(f({ clubs: ['ACSA', 'COC Padel', 'Casa Green Town'] }))).toBe('3 clubs');
  });

  it('se borne a trois morceaux : un nom n est pas une phrase', () => {
    const n = suggestFilterName(f({
      cities: ['Rabat'], type: 'competitive', slot: 'evening', gender: 'men', level: 'mine',
    }));
    expect(n.split(' · ')).toHaveLength(3);
  });

  it('a toujours un nom, meme sans aucun critere', () => {
    expect(suggestFilterName(NO_EXPLORE_FILTERS)).toBe('Mon filtre');
  });
});

describe('relecture d un filtre enregistre', () => {
  it('complete les dimensions qu une ANCIENNE version ne connaissait pas', () => {
    // Un filtre enregistre avant l'ajout des clubs n'a pas la cle : sans
    // completement, `f.clubs.length` planterait a la lecture.
    const vieux = hydrateFilter({ type: 'friendly' });
    expect(vieux.clubs).toEqual([]);
    expect(vieux.cities).toEqual([]);
    expect(vieux.type).toBe('friendly');
    expect(vieux.date).toBe('any');
  });

  it('resiste a un contenu aberrant', () => {
    expect(hydrateFilter(null)).toEqual(NO_EXPLORE_FILTERS);
    expect(hydrateFilter('bof')).toEqual(NO_EXPLORE_FILTERS);
    expect(hydrateFilter({ clubs: 'pas un tableau' }).clubs).toEqual([]);
  });
});

describe('nom nettoye', () => {
  it('retire les espaces en trop', () => {
    expect(normalizeFilterName('  Soir   a  Casa ', NO_EXPLORE_FILTERS)).toBe('Soir a Casa');
  });

  it('retombe sur le nom propose quand on n a rien saisi', () => {
    expect(normalizeFilterName('   ', f({ slot: 'evening' }))).toBe('Soir');
  });

  it('borne la longueur', () => {
    expect(normalizeFilterName('x'.repeat(80), NO_EXPLORE_FILTERS)).toHaveLength(40);
  });
});
