import { describe, it, expect, vi } from 'vitest';

// homeSlot depend de lib/games (freeSpots, occupiesSpot), qui charge le client
// Supabase — lequel exige les variables d'environnement. Les fonctions testees
// ici sont PURES : on neutralise le module, comme dans urgentGame.test.
vi.mock('../supabase', () => ({ supabase: {} }));

import {
  suggestibleGames, homeSlot,
  MAX_SUGGESTIONS, type SuggestibleGame,
} from '../homeSlot';
import { homeSections } from '../homeLayout';

const NOW = new Date('2026-09-08T12:00:00Z');
const dans = (heures: number) => new Date(NOW.getTime() + heures * 3600_000).toISOString();

const MOI = { id: 'moi', gender: 'male' };

const G = (o: Partial<SuggestibleGame> = {}): SuggestibleGame => ({
  id: 'g1',
  creator_id: 'autre',
  match_date: dans(24),
  status: 'open',
  participants: [],
  ...o,
});

describe('les parties qu on a le droit de proposer', () => {
  it('propose une partie ouverte, a venir, avec de la place', () => {
    expect(suggestibleGames([G()], MOI, NOW)).toHaveLength(1);
  });

  it('ne propose PAS une partie deja passee', () => {
    expect(suggestibleGames([G({ match_date: dans(-2) })], MOI, NOW)).toHaveLength(0);
  });

  it('ne propose PAS une partie sans date : on ne peut pas la situer', () => {
    expect(suggestibleGames([G({ match_date: null })], MOI, NOW)).toHaveLength(0);
    expect(suggestibleGames([G({ match_date: 'bof' })], MOI, NOW)).toHaveLength(0);
  });

  it('ne propose PAS mes propres parties', () => {
    expect(suggestibleGames([G({ creator_id: 'moi' })], MOI, NOW)).toHaveLength(0);
  });

  it('ne propose PAS une partie ou je suis deja, meme juste invite', () => {
    // Une invitation en attente ne compte pas comme « match programme » plus
    // haut dans l'ecran : sans ce refus, l'accueil me proposerait de rejoindre
    // une partie qui m'attend deja.
    const invite = G({ participants: [{ player_id: 'moi', status: 'pending' }] });
    expect(suggestibleGames([invite], MOI, NOW)).toHaveLength(0);
  });

  it('ne propose PAS une partie complete', () => {
    const pleine = G({
      participants: [
        { player_id: 'a', status: 'accepted' },
        { player_id: 'b', status: 'accepted' },
        { player_id: 'c', status: 'accepted' },
      ],
    });
    expect(suggestibleGames([pleine], MOI, NOW)).toHaveLength(0);
  });

  it('ne fait PAS confiance a spots_available, qui derive', () => {
    // Le compteur denormalise annonce une place libre alors que les quatre
    // creneaux sont pris. C'est freeSpots qui fait foi.
    const menteuse = G({
      spots_available: 2,
      participants: [
        { player_id: 'a', status: 'accepted' },
        { player_id: 'b', status: 'accepted' },
        { player_id: 'c', status: 'accepted' },
      ],
    });
    expect(suggestibleGames([menteuse], MOI, NOW)).toHaveLength(0);
  });

  it('ne propose que les parties encore OUVERTES', () => {
    expect(suggestibleGames([G({ status: 'closed' })], MOI, NOW)).toHaveLength(0);
    expect(suggestibleGames([G({ status: 'cancelled' })], MOI, NOW)).toHaveLength(0);
  });

  it('les plus proches d abord', () => {
    const liste = [
      G({ id: 'loin', match_date: dans(72) }),
      G({ id: 'proche', match_date: dans(3) }),
      G({ id: 'milieu', match_date: dans(30) }),
    ];
    expect(suggestibleGames(liste, MOI, NOW, 3).map(g => g.id))
      .toEqual(['proche', 'milieu', 'loin']);
  });

  it('en montre TROIS au plus, en carrousel', () => {
    const liste = [1, 2, 3, 4, 5].map(n => G({ id: `g${n}`, match_date: dans(n) }));
    const gardees = suggestibleGames(liste, MOI, NOW);
    expect(MAX_SUGGESTIONS).toBe(3);
    expect(gardees.map(g => g.id)).toEqual(['g1', 'g2', 'g3']);
  });
});

describe('le classement : niveau, puis proximite, puis urgence, puis club favori', () => {
  // Deux joueurs deja dedans : il reste UNE place (4 - createur - 2).
  const DEUX = [
    { player_id: 'x', status: 'accepted' },
    { player_id: 'y', status: 'accepted' },
  ];
  const ME = { id: 'moi', gender: 'male', elo: 1500, favoriteClubs: ['Arena'] };

  it('met D ABORD ce qui est dans ma fourchette de niveau', () => {
    // Hors fourchette, rejoindre passe par le vote des joueurs deja dedans :
    // c'est une partie qu'on n'aura peut-etre pas. Meme plus proche, elle passe
    // apres.
    const hors = G({ id: 'hors', match_date: dans(2), min_elo: 1800, max_elo: 2200 });
    const dans_ = G({ id: 'dans', match_date: dans(48), min_elo: 1200, max_elo: 1700 });
    expect(suggestibleGames([hors, dans_], ME, NOW).map(g => g.id)).toEqual(['dans', 'hors']);
  });

  it('une partie sans fourchette declaree est ouverte a tous, donc dans la mienne', () => {
    const libre = G({ id: 'libre', match_date: dans(48) });
    const hors = G({ id: 'hors', match_date: dans(2), min_elo: 1800 });
    expect(suggestibleGames([hors, libre], ME, NOW)[0].id).toBe('libre');
  });

  it('a niveau egal, l URGENTE passe devant', () => {
    // Urgente = il manque UNE personne et ca se joue dans les six heures.
    const urgente = G({ id: 'urgente', match_date: dans(5), participants: DEUX });
    const tranquille = G({ id: 'tranquille', match_date: dans(1) });
    expect(suggestibleGames([tranquille, urgente], ME, NOW).map(g => g.id))
      .toEqual(['urgente', 'tranquille']);
  });

  it('le niveau prime sur l urgence', () => {
    const urgenteHors = G({ id: 'uh', match_date: dans(2), participants: DEUX, min_elo: 1900 });
    const dansTranquille = G({ id: 'dt', match_date: dans(48) });
    expect(suggestibleGames([urgenteHors, dansTranquille], ME, NOW)[0].id).toBe('dt');
  });

  it('a niveau et urgence egaux, mon CLUB FAVORI passe devant', () => {
    const ailleurs = G({ id: 'ailleurs', match_date: dans(10), location: 'Autre club' });
    const favori = G({ id: 'favori', match_date: dans(30), location: 'Arena' });
    expect(suggestibleGames([ailleurs, favori], ME, NOW).map(g => g.id))
      .toEqual(['favori', 'ailleurs']);
  });

  it('l urgence prime sur le club favori', () => {
    const favoriTranquille = G({ id: 'ft', match_date: dans(10), location: 'Arena' });
    const urgenteAilleurs = G({ id: 'ua', match_date: dans(3), participants: DEUX, location: 'Autre' });
    expect(suggestibleGames([favoriTranquille, urgenteAilleurs], ME, NOW)[0].id).toBe('ua');
  });

  it('a tout egal, la plus PROCHE dans le temps', () => {
    const tard = G({ id: 'tard', match_date: dans(40) });
    const tot = G({ id: 'tot', match_date: dans(20) });
    expect(suggestibleGames([tard, tot], ME, NOW)[0].id).toBe('tot');
  });

  it('sans ELO connu, aucune priorite de niveau', () => {
    const hors = G({ id: 'hors', match_date: dans(2), min_elo: 1800 });
    const dans_ = G({ id: 'dans', match_date: dans(48), min_elo: 1200, max_elo: 1700 });
    expect(suggestibleGames([dans_, hors], { id: 'moi', gender: 'male' }, NOW)[0].id).toBe('hors');
  });

  it('ce sont des PRIORITES, pas des filtres : hors fourchette reste proposable', () => {
    // Filtrer viderait l'accueil au lancement et renverrait sur « cree le
    // tien » alors qu'une partie existe.
    const hors = G({ id: 'hors', match_date: dans(2), min_elo: 1900 });
    expect(suggestibleGames([hors], ME, NOW)).toHaveLength(1);
  });
});

describe('la regle de mixite, sur l accueil aussi', () => {
  it('un homme ne voit PAS une partie reservee aux femmes', () => {
    // Le serveur la refuserait dans join_game : l'afficher sur l'accueil
    // serait une promesse en l'air, a la pire place pour en faire une.
    expect(suggestibleGames([G({ gender_pref: 'women' })], MOI, NOW)).toHaveLength(0);
  });

  it('une femme voit la partie feminine, et pas la masculine', () => {
    const elle = { id: 'moi', gender: 'female' };
    expect(suggestibleGames([G({ gender_pref: 'women' })], elle, NOW)).toHaveLength(1);
    expect(suggestibleGames([G({ gender_pref: 'men' })], elle, NOW)).toHaveLength(0);
  });

  it('genre non declare : seules les parties ouvertes a tous', () => {
    const inconnu = { id: 'moi', gender: null };
    expect(suggestibleGames([G({ gender_pref: 'mixed' })], inconnu, NOW)).toHaveLength(1);
    expect(suggestibleGames([G({ gender_pref: 'men' })], inconnu, NOW)).toHaveLength(0);
    expect(suggestibleGames([G({ gender_pref: 'women' })], inconnu, NOW)).toHaveLength(0);
  });
});

describe('le critere « proche », juste apres le niveau', () => {
  const DEUX = [
    { player_id: 'x', status: 'accepted' },
    { player_id: 'y', status: 'accepted' },
  ];
  // Distances par NOM de club, comme lib/geo.makeDistanceOf les rend.
  const distances: Record<string, { km: number; approx: boolean }> = {
    'Pres': { km: 3, approx: false },
    'Loin': { km: 80, approx: false },
    'CentreVille': { km: 2, approx: true },
  };
  const distanceOf = (l: string | null | undefined) => (l ? distances[l] ?? null : null);
  const ME = { id: 'moi', gender: 'male', elo: 1500, distanceOf, radiusKm: 20 };

  it('une partie PROCHE passe devant une partie urgente mais lointaine', () => {
    const proche = G({ id: 'proche', location: 'Pres', match_date: dans(48) });
    const urgente = G({ id: 'urgente', location: 'Loin', match_date: dans(2), participants: DEUX });
    expect(suggestibleGames([urgente, proche], ME, NOW).map(g => g.id)).toEqual(['proche', 'urgente']);
  });

  it('mais le NIVEAU passe toujours avant la proximite', () => {
    const procheHorsNiveau = G({ id: 'proche', location: 'Pres', min_elo: 1800, max_elo: 2200, match_date: dans(48) });
    const loinDansNiveau = G({ id: 'loin', location: 'Loin', min_elo: 1200, max_elo: 1700, match_date: dans(48) });
    expect(suggestibleGames([procheHorsNiveau, loinDansNiveau], ME, NOW).map(g => g.id)).toEqual(['loin', 'proche']);
  });

  it('un club place au centre de sa ville compte AUSSI comme proche (decision utilisateur 2026-09-18)', () => {
    // La distance d'un club place au centre de sa ville est approximative,
    // mais elle suffit pour une PRIORITE : rien n'est promis au joueur, la
    // carte affichera « ~ ». Exiger une position exacte favorisait les 28
    // clubs verifies au detriment de parties reellement plus proches.
    const centre = G({ id: 'centre', location: 'CentreVille', match_date: dans(48) });
    const urgente = G({ id: 'urgente', location: 'Loin', match_date: dans(2), participants: DEUX });
    expect(suggestibleGames([centre, urgente], ME, NOW).map(g => g.id)).toEqual(['centre', 'urgente']);
  });

  it('un club approximatif AU-DELA du rayon n est pas proche', () => {
    const loinApprox = G({ id: 'loinApprox', location: 'CentreLoin', match_date: dans(48) });
    const urgente = G({ id: 'urgente', location: 'Loin', match_date: dans(2), participants: DEUX });
    const distanceOfLoinApprox = (l: string | null | undefined) =>
      l === 'CentreLoin' ? { km: 30, approx: true } : distanceOf(l);
    const ME20 = { ...ME, distanceOf: distanceOfLoinApprox, radiusKm: 20 };
    expect(suggestibleGames([loinApprox, urgente], ME20, NOW).map(g => g.id)).toEqual(['urgente', 'loinApprox']);
  });

  it('a la borne exacte du rayon, la partie compte comme proche', () => {
    const ME3 = { ...ME, radiusKm: 3 };
    const pile = G({ id: 'pile', location: 'Pres', match_date: dans(48) }); // 3 km, rayon 3
    const urgente = G({ id: 'urgente', location: 'Loin', match_date: dans(2), participants: DEUX });
    expect(suggestibleGames([urgente, pile], ME3, NOW).map(g => g.id)).toEqual(['pile', 'urgente']);
  });

  it('au-dela du rayon de la zone, ce n est plus proche', () => {
    const ME5 = { ...ME, radiusKm: 5 };
    const auBord = G({ id: 'bord', location: 'Pres', match_date: dans(48) });   // 3 km
    const urgente = G({ id: 'urgente', location: 'Loin', match_date: dans(2), participants: DEUX });
    expect(suggestibleGames([urgente, auBord], ME5, NOW).map(g => g.id)).toEqual(['bord', 'urgente']);
    const ME1 = { ...ME, radiusKm: 1 };
    expect(suggestibleGames([urgente, auBord], ME1, NOW).map(g => g.id)).toEqual(['urgente', 'bord']);
  });

  it('SANS position, l ordre est exactement celui d avant', () => {
    const SANS = { id: 'moi', gender: 'male', elo: 1500 };
    const proche = G({ id: 'proche', location: 'Pres', match_date: dans(48) });
    const urgente = G({ id: 'urgente', location: 'Loin', match_date: dans(2), participants: DEUX });
    expect(suggestibleGames([proche, urgente], SANS, NOW).map(g => g.id)).toEqual(['urgente', 'proche']);
  });

  it('sans rayon declare, la zone par defaut est de 20 km', () => {
    const SANS_RAYON = { id: 'moi', gender: 'male', elo: 1500, distanceOf };
    const proche = G({ id: 'proche', location: 'Pres', match_date: dans(48) });
    const urgente = G({ id: 'urgente', location: 'Loin', match_date: dans(2), participants: DEUX });
    expect(suggestibleGames([proche, urgente], SANS_RAYON, NOW).map(g => g.id)).toEqual(['proche', 'urgente']);
  });

  it('proche ou pas, une partie reste PROPOSABLE (priorite, pas filtre)', () => {
    const loin = G({ id: 'loin', location: 'Loin', match_date: dans(48) });
    expect(suggestibleGames([loin], ME, NOW).map(g => g.id)).toEqual(['loin']);
  });
});

describe('qui occupe l emplacement', () => {
  it('un match programme passe avant tout', () => {
    expect(homeSlot({ hasNextMatch: true, hasTournaments: true, suggestions: [G()] }).kind)
      .toBe('nextMatch');
  });

  it('des tournois ouverts remplissent deja l ecran : personne d autre', () => {
    // Empiler des suggestions SOUS une section Tournois surchargerait la page
    // au lieu de l'aerer, ce qui est exactement ce qu'on cherchait a corriger.
    expect(homeSlot({ hasNextMatch: false, hasTournaments: true, suggestions: [G()] }).kind)
      .toBe('none');
  });

  it('rien de programme et rien d ouvert : on propose ce qui se joue', () => {
    const slot = homeSlot({ hasNextMatch: false, hasTournaments: false, suggestions: [G()] });
    expect(slot.kind).toBe('openGames');
    if (slot.kind === 'openGames') expect(slot.games).toHaveLength(1);
  });

  it('vraiment RIEN : on invite a creer, on ne laisse pas du blanc', () => {
    // Le jour du lancement il n'y aura pas encore de parties ouvertes. Sans ce
    // dernier etage, l'ecran d'un nouveau joueur serait vide au moment precis
    // ou il faut lui donner un geste.
    expect(homeSlot({ hasNextMatch: false, hasTournaments: false, suggestions: [] }).kind)
      .toBe('createFirst');
  });
});

describe('la decision et le budget de hauteur disent la MEME chose', () => {
  it('a chaque occupant choisi correspond la section reservee, et une seule', () => {
    // Deux lectures de la meme regle vivent dans deux fichiers : homeSlot
    // decide QUI s'affiche, homeLayout reserve la PLACE. Si elles divergent,
    // une section est dessinee sans hauteur reservee (elle s'ecrase) ou une
    // hauteur est reservee pour rien (l'accueil se met a defiler). Rien dans
    // l'ecran ne le signalerait : c'est ce test qui tient les deux ensemble.
    for (const hasTournaments of [true, false]) {
      for (const hasNextMatch of [true, false]) {
        for (const nb of [0, 2]) {
          const suggestions = Array.from({ length: nb }, (_, n) => G({ id: `g${n}` }));
          const slot = homeSlot({ hasNextMatch, hasTournaments, suggestions });
          const cles = homeSections({
            availableHeight: 680, availableWidth: 393,
            hasTournaments, hasNextMatch, openGames: nb,
          }).map(x => x.key);
          const contexte = `tournois=${hasTournaments} match=${hasNextMatch} parties=${nb}`;
          expect(cles.includes('nextMatch'), contexte).toBe(slot.kind === 'nextMatch');
          expect(cles.includes('openGames'), contexte)
            .toBe(slot.kind === 'openGames' || slot.kind === 'createFirst');
        }
      }
    }
  });
});
