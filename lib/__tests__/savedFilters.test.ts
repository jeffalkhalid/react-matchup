import { describe, it, expect } from 'vitest';
import {
  alertCoverage, canAlert, suggestFilterName, hydrateFilter, normalizeFilterName,
  alertNeedsZone, distanceAlertCount, zoneDeletionMessage, type SavedFilter,
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
    expect(c.ignored).toEqual(['Date', 'Nombre de places libres', 'Urgent', 'Recherche']);
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

describe('distance max et alertes (lot 4)', () => {
  it('maxKm rejoint desormais les criteres surveilles, avec le rayon dans le libelle', () => {
    const c = alertCoverage(f({ cities: ['Rabat'], maxKm: 10 }));
    expect(c.watched).toEqual(['Ville', 'Distance : moins de 10 km de ta zone']);
    expect(c.ignored).toEqual([]);
  });

  it('une distance seule suffit desormais a faire une alerte', () => {
    expect(canAlert(f({ maxKm: 10 }))).toBe(true);
  });

  it('relecture : maxKm absent ou aberrant → null ; valeur permise conservée', () => {
    expect(hydrateFilter({ type: 'friendly' }).maxKm).toBeNull();
    expect(hydrateFilter({ maxKm: 15 }).maxKm).toBeNull();
    expect(hydrateFilter({ maxKm: '10' }).maxKm).toBeNull();
    expect(hydrateFilter({ maxKm: 20 }).maxKm).toBe(20);
  });
});

describe('nom propose avec une distance (lot 4)', () => {
  it('ajoute « Moins de N km » apres la ville et le club', () => {
    expect(suggestFilterName(f({ cities: ['Rabat'], maxKm: 10 })))
      .toBe('Rabat · Moins de 10 km');
  });

  it('la limite a trois morceaux s applique toujours avec la distance', () => {
    const n = suggestFilterName(f({
      cities: ['Rabat'], clubs: ['ACSA'], maxKm: 20, slot: 'evening',
    }));
    expect(n.split(' · ')).toHaveLength(3);
    expect(n).toBe('Rabat · ACSA · Moins de 20 km');
  });
});

describe('alerte avec distance sans zone (lot 4)', () => {
  it('signale qu il manque une zone quand une distance est posee sans zone', () => {
    expect(alertNeedsZone(f({ maxKm: 10 }), false)).toBe(true);
  });

  it('ne signale rien des qu une zone existe', () => {
    expect(alertNeedsZone(f({ maxKm: 10 }), true)).toBe(false);
  });

  it('ne signale rien sans critere de distance, zone ou pas', () => {
    expect(alertNeedsZone(f({ cities: ['Rabat'] }), false)).toBe(false);
    expect(alertNeedsZone(NO_EXPLORE_FILTERS, false)).toBe(false);
  });
});

describe('compter les alertes avec distance (lot 4)', () => {
  const sf = (o: Partial<SavedFilter> = {}): SavedFilter => ({
    id: 'x', name: 'Test', criteria: NO_EXPLORE_FILTERS, alert: true,
    created_at: '2026-01-01T00:00:00.000Z', ...o,
  });

  it('compte seulement les filtres actifs ET portant une distance', () => {
    const saved: SavedFilter[] = [
      sf({ id: 'a', alert: true, criteria: f({ maxKm: 10 }) }),
      sf({ id: 'b', alert: false, criteria: f({ maxKm: 20 }) }),
      sf({ id: 'c', alert: true, criteria: f({ cities: ['Rabat'] }) }),
      sf({ id: 'd', alert: true, criteria: f({ maxKm: 5 }) }),
    ];
    expect(distanceAlertCount(saved)).toBe(2);
  });

  it('zero sur une liste vide ou sans aucune distance', () => {
    expect(distanceAlertCount([])).toBe(0);
    expect(distanceAlertCount([sf({ criteria: f({ cities: ['Rabat'] }) })])).toBe(0);
  });
});

describe('message avant de supprimer sa zone (lot 4)', () => {
  it('garde le message actuel sans alerte a distance', () => {
    expect(zoneDeletionMessage(0)).toBe(
      'Les distances ne seront plus calculées depuis cette zone.',
    );
  });

  it('avertit au singulier pour une seule alerte', () => {
    expect(zoneDeletionMessage(1)).toBe(
      'Les distances ne seront plus calculées depuis cette zone. Ton alerte avec distance ne se déclenchera plus.',
    );
  });

  it('avertit au pluriel, avec le compte, au-dela d une alerte', () => {
    expect(zoneDeletionMessage(3)).toBe(
      'Les distances ne seront plus calculées depuis cette zone. Tes 3 alertes avec distance ne se déclencheront plus.',
    );
  });
});
