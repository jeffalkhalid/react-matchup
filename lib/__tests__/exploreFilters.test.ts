import { describe, it, expect } from 'vitest';
import {
  NO_EXPLORE_FILTERS, activeExploreFilterCount, matchesDatePreset, matchesTimeSlot,
  gameType, exploreRefusal, filterExplore, bestExploreFilterToDrop,
  canPlayerSee, visibleGames, allowedGenderFilters,
  type ExploreFilters, type ExploreContext, type ExploreGame,
} from '../exploreFilters';

// Vendredi 4 septembre 2026, 12 h.
const now = new Date(2026, 8, 4, 12, 0, 0);
const le = (j: number, h = 19, m = 0) => new Date(2026, 8, j, h, m).toISOString();

const f = (o: Partial<ExploreFilters> = {}): ExploreFilters => ({ ...NO_EXPLORE_FILTERS, ...o });

const ctx = (o: Partial<ExploreContext> = {}): ExploreContext => ({
  now,
  cityOfClub: (n) => (n === 'Padel 4 Maroc' ? 'Casablanca' : n === 'Padel Factory' ? 'Agadir' : null),
  freeSpots: () => 1,
  isUrgent: () => false,
  levelFit: () => 'fit',
  ...o,
});

const partie = (o: Partial<ExploreGame> = {}): ExploreGame => ({
  location: 'Padel 4 Maroc',
  match_date: le(4),
  gender_pref: 'men',
  game_format: 'competitive',
  is_challenge: false,
  ...o,
});

describe('compte des filtres actifs', () => {
  it('aucun au depart', () => {
    expect(activeExploreFilterCount(NO_EXPLORE_FILTERS)).toBe(0);
  });

  it('compte chaque dimension une fois', () => {
    expect(activeExploreFilterCount(f({ date: 'today', gender: 'women', urgentOnly: true }))).toBe(3);
  });

  it('une liste VIDE de clubs n est pas un filtre', () => {
    // Vide veut dire « tous » : le compteur ne doit pas annoncer un filtre que
    // l'utilisateur n'a pas pose.
    expect(activeExploreFilterCount(f({ clubs: [] }))).toBe(0);
    expect(activeExploreFilterCount(f({ clubs: ['ACSA'] }))).toBe(1);
  });

  it('une recherche faite d espaces ne compte pas', () => {
    expect(activeExploreFilterCount(f({ search: '   ' }))).toBe(0);
  });
});

describe('periodes', () => {
  it('aujourd hui et demain', () => {
    expect(matchesDatePreset(le(4), 'today', now)).toBe(true);
    expect(matchesDatePreset(le(5), 'today', now)).toBe(false);
    expect(matchesDatePreset(le(5), 'tomorrow', now)).toBe(true);
  });

  it('« cette semaine » est une fenetre GLISSANTE de sept jours', () => {
    // Un vendredi, une semaine civile s'arreterait au dimanche et ne montrerait
    // que trois jours. L'utilisateur n'a pas demande un calendrier, il a
    // demande « bientot ».
    expect(matchesDatePreset(le(10), 'week', now)).toBe(true);
    expect(matchesDatePreset(le(12), 'week', now)).toBe(false);
  });

  it('« cette semaine » exclut le PASSE', () => {
    expect(matchesDatePreset(le(3), 'week', now)).toBe(false);
  });

  it('« week-end » ne retient que samedi et dimanche', () => {
    expect(matchesDatePreset(le(5), 'weekend', now)).toBe(true);  // samedi
    expect(matchesDatePreset(le(6), 'weekend', now)).toBe(true);  // dimanche
    expect(matchesDatePreset(le(7), 'weekend', now)).toBe(false); // lundi
  });

  it('« week-end » designe CE week-end, pas le suivant', () => {
    // La maquette annonce « Week-end 5 - 6 sept. » : deux jours precis, pas une
    // fenetre de huit jours qui attraperait aussi le samedi d'apres.
    expect(matchesDatePreset(le(12), 'weekend', now)).toBe(false);
    expect(matchesDatePreset(le(19), 'weekend', now)).toBe(false);
  });

  it('un DIMANCHE SOIR, « week-end » designe encore ce dimanche-la', () => {
    const dimancheSoir = new Date(2026, 8, 6, 20, 0);
    expect(matchesDatePreset(le(6, 21), 'weekend', dimancheSoir)).toBe(true);
    expect(matchesDatePreset(le(5, 19), 'weekend', dimancheSoir)).toBe(true);
  });

  it('sans date, une partie ne tombe dans aucune periode', () => {
    expect(matchesDatePreset(null, 'today', now)).toBe(false);
    expect(matchesDatePreset(null, 'any', now)).toBe(true);
  });
});

describe('plages horaires', () => {
  it('midi pile est de l APRES-MIDI, pas du matin', () => {
    // Bornes fermees a gauche, ouvertes a droite : sans cette regle une partie
    // a midi appartiendrait a deux tranches et se compterait deux fois.
    expect(matchesTimeSlot(le(4, 12, 0), 'morning')).toBe(false);
    expect(matchesTimeSlot(le(4, 12, 0), 'afternoon')).toBe(true);
  });

  it('18 h pile est du soir, minuit pile est de la nuit', () => {
    expect(matchesTimeSlot(le(4, 18, 0), 'afternoon')).toBe(false);
    expect(matchesTimeSlot(le(4, 18, 0), 'evening')).toBe(true);
    expect(matchesTimeSlot(le(4, 0, 0), 'night')).toBe(true);
    expect(matchesTimeSlot(le(4, 0, 0), 'evening')).toBe(false);
  });

  it('les quatre tranches couvrent la journee SANS trou ni chevauchement', () => {
    const tranches = ['morning', 'afternoon', 'evening', 'night'] as const;
    for (let h = 0; h < 24; h++) {
      const dedans = tranches.filter(t => matchesTimeSlot(le(4, h, 0), t));
      expect(dedans, `heure ${h}`).toHaveLength(1);
    }
  });
});

describe('type de partie', () => {
  it('le defi prime sur le format', () => {
    expect(gameType({ is_challenge: true, game_format: 'friendly' })).toBe('challenge');
  });
  it('amical et competitif', () => {
    expect(gameType({ game_format: 'friendly' })).toBe('friendly');
    expect(gameType({ game_format: 'competitive' })).toBe('competitive');
    expect(gameType({})).toBe('competitive');
  });
});

describe('refus, et sa raison', () => {
  it('laisse tout passer sans filtre', () => {
    expect(exploreRefusal(partie(), NO_EXPLORE_FILTERS, ctx())).toBe(null);
  });

  it('nomme le filtre qui a ecarte', () => {
    expect(exploreRefusal(partie(), f({ date: 'tomorrow' }), ctx())).toBe('date');
    expect(exploreRefusal(partie(), f({ gender: 'women' }), ctx())).toBe('gender');
    expect(exploreRefusal(partie(), f({ type: 'friendly' }), ctx())).toBe('type');
  });

  it('filtre par CLUB sur le nom exact', () => {
    expect(exploreRefusal(partie(), f({ clubs: ['Padel 4 Maroc'] }), ctx())).toBe(null);
    expect(exploreRefusal(partie(), f({ clubs: ['ACSA'] }), ctx())).toBe('club');
  });

  it('filtre par VILLE en passant par le club', () => {
    expect(exploreRefusal(partie(), f({ cities: ['Casablanca'] }), ctx())).toBe(null);
    expect(exploreRefusal(partie(), f({ cities: ['Agadir'] }), ctx())).toBe('city');
  });

  it('un lieu INCONNU du referentiel ne passe aucun filtre de ville', () => {
    // Sept lieux sur soixante et un ne correspondent a aucun club : ils ne
    // doivent pas se faufiler dans « Casablanca » par defaut.
    const inconnue = partie({ location: '4Padel (Montreuil)' });
    expect(exploreRefusal(inconnue, f({ cities: ['Casablanca'] }), ctx())).toBe('city');
    expect(exploreRefusal(inconnue, NO_EXPLORE_FILTERS, ctx())).toBe(null);
  });

  it('places libres : le nombre EXACT', () => {
    expect(exploreRefusal(partie(), f({ spots: 1 }), ctx({ freeSpots: () => 1 }))).toBe(null);
    expect(exploreRefusal(partie(), f({ spots: 2 }), ctx({ freeSpots: () => 1 }))).toBe('spots');
  });

  it('niveau : « le mien » et « hors du mien » sont complementaires', () => {
    const dedans = ctx({ levelFit: () => 'fit' });
    const dehors = ctx({ levelFit: () => 'outside' });
    expect(exploreRefusal(partie(), f({ level: 'mine' }), dedans)).toBe(null);
    expect(exploreRefusal(partie(), f({ level: 'mine' }), dehors)).toBe('level');
    expect(exploreRefusal(partie(), f({ level: 'outside' }), dehors)).toBe(null);
    expect(exploreRefusal(partie(), f({ level: 'outside' }), dedans)).toBe('level');
  });

  it('la recherche porte sur le lieu ET sur le createur', () => {
    const g = partie({ creator: { name: 'Youssef' } });
    expect(exploreRefusal(g, f({ search: 'padel' }), ctx())).toBe(null);
    expect(exploreRefusal(g, f({ search: 'yous' }), ctx())).toBe(null);
    expect(exploreRefusal(g, f({ search: 'zzz' }), ctx())).toBe('search');
  });
});

describe('partage garde / masque', () => {
  const jeu = [
    partie({ location: 'Padel 4 Maroc', match_date: le(4) }),
    partie({ location: 'Padel Factory', match_date: le(4) }),
    partie({ location: 'Padel 4 Maroc', match_date: le(12) }),
  ];

  it('separe ce qui passe de ce qui est ecarte, avec la raison', () => {
    const out = filterExplore(jeu, f({ cities: ['Casablanca'] }), ctx());
    expect(out.kept).toHaveLength(2);
    expect(out.hidden.map(h => h.reason)).toEqual(['city']);
  });

  it('propose le filtre a retirer le plus rentable', () => {
    const out = bestExploreFilterToDrop(jeu, f({ date: 'today', cities: ['Agadir'] }), ctx());
    // Deux parties sont ecartees par la date, une seule par la ville d'abord
    // testee — la date passe avant la ville dans l'ordre des controles.
    expect(out?.unlocked).toBeGreaterThan(0);
  });

  it('rend null quand rien n est masque', () => {
    expect(bestExploreFilterToDrop(jeu, NO_EXPLORE_FILTERS, ctx())).toBe(null);
  });

  it('le choix est DETERMINISTE a egalite', () => {
    const a = bestExploreFilterToDrop(jeu, f({ date: 'tomorrow' }), ctx());
    const b = bestExploreFilterToDrop(jeu, f({ date: 'tomorrow' }), ctx());
    expect(a).toEqual(b);
  });
});

describe('mixite : une regle, pas un filtre', () => {
  const mixte = { gender_pref: 'mixed' };
  const hommes = { gender_pref: 'men' };
  const femmes = { gender_pref: 'women' };

  it('un HOMME ne voit pas les parties reservees aux femmes', () => {
    expect(canPlayerSee(hommes, 'male')).toBe(true);
    expect(canPlayerSee(femmes, 'male')).toBe(false);
  });

  it('une FEMME ne voit pas les parties reservees aux hommes', () => {
    expect(canPlayerSee(femmes, 'female')).toBe(true);
    expect(canPlayerSee(hommes, 'female')).toBe(false);
  });

  it('les parties mixtes ou sans preference sont ouvertes a tous', () => {
    for (const me of ['male', 'female', null] as const) {
      expect(canPlayerSee(mixte, me)).toBe(true);
      expect(canPlayerSee({}, me)).toBe(true);
      expect(canPlayerSee({ gender_pref: null }, me)).toBe(true);
    }
  });

  it('un genre NON DECLARE ne donne acces a aucune partie genree', () => {
    // Le serveur le refuserait : la lui montrer serait une promesse en l'air.
    expect(canPlayerSee(hommes, null)).toBe(false);
    expect(canPlayerSee(femmes, undefined)).toBe(false);
  });

  it('le tri s applique sur une liste entiere', () => {
    expect(visibleGames([mixte, hommes, femmes], 'male')).toEqual([mixte, hommes]);
  });

  it('on ne PROPOSE pas un filtre qui ne peut rien rendre', () => {
    // « Femmes » offert a un homme afficherait une liste vide en permanence.
    expect(allowedGenderFilters('male')).toEqual(['all', 'men', 'mixed']);
    expect(allowedGenderFilters('female')).toEqual(['all', 'women', 'mixed']);
    expect(allowedGenderFilters(null)).toEqual(['all', 'mixed']);
  });
});
