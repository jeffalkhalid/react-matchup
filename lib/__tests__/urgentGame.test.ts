import { describe, it, expect, vi } from 'vitest';

// lib/games importe le client Supabase au chargement, lequel exige les
// variables d'environnement. Les fonctions testees ici sont PURES et ne s'en
// servent pas : on neutralise le module plutot que de deplacer le predicat
// loin de `freeSpots`, dont il depend.
vi.mock('../supabase', () => ({ supabase: {} }));

import { isUrgentGame, minutesUntil, urgentDelayLabel, URGENT_WINDOW_MINUTES } from '../games';

const now = new Date(2026, 8, 5, 12, 0, 0);
const dans = (minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString();

/** Une partie a 4 places : le createur + `autres` joueurs occupent des places. */
const partie = (autres: number, match_date: string | null) => ({
  creator_id: 'C',
  match_date,
  participants: Array.from({ length: autres }, (_, i) => ({
    player_id: `p${i}`, status: 'accepted',
  })),
});

describe('minutes jusqu au coup d envoi', () => {
  it('compte en minutes, sans arrondi', () => {
    expect(minutesUntil(dans(20), now)).toBe(20);
    expect(minutesUntil(dans(6 * 60), now)).toBe(360);
  });

  it('devient negatif une fois le match commence', () => {
    expect(minutesUntil(dans(-10), now)).toBe(-10);
  });

  it('ne plante pas sur une date illisible', () => {
    expect(Number.isNaN(minutesUntil('pas une date', now))).toBe(true);
  });
});

describe('une partie urgente : il manque UNE personne, et c est bientot', () => {
  it('trois joueurs presents et un match dans 2 h', () => {
    expect(isUrgentGame(partie(2, dans(120)), now)).toBe(true);
  });

  it('UNE PARTIE DANS 20 MINUTES EST URGENTE', () => {
    // Le bug corrige : le compte se faisait en heures ARRONDIES. 20 minutes
    // donnait « 0 heure », la condition exigeait « plus de 0 », et la partie
    // disparaissait — au moment precis ou elle etait la plus urgente. Tout ce
    // qui commencait dans moins de trente minutes tombait dans ce trou.
    expect(isUrgentGame(partie(2, dans(20)), now)).toBe(true);
    expect(isUrgentGame(partie(2, dans(5)), now)).toBe(true);
  });

  it('une partie DEJA COMMENCEE ne l est plus', () => {
    expect(isUrgentGame(partie(2, dans(-1)), now)).toBe(false);
    expect(isUrgentGame(partie(2, dans(0)), now)).toBe(false);
  });

  it('au-dela de six heures, ce n est plus urgent', () => {
    expect(isUrgentGame(partie(2, dans(URGENT_WINDOW_MINUTES)), now)).toBe(true);
    expect(isUrgentGame(partie(2, dans(URGENT_WINDOW_MINUTES + 1)), now)).toBe(false);
  });

  it('EXACTEMENT une place libre : ni zero, ni deux', () => {
    // A deux places manquantes, la partie n'est pas a un message de se
    // completer, elle est a deux — ce n'est plus le meme geste.
    expect(isUrgentGame(partie(3, dans(60)), now)).toBe(false); // complete
    expect(isUrgentGame(partie(1, dans(60)), now)).toBe(false); // deux places
    expect(isUrgentGame(partie(2, dans(60)), now)).toBe(true);  // une place
  });

  it('une partie SANS DATE n est jamais urgente', () => {
    expect(isUrgentGame(partie(2, null), now)).toBe(false);
  });

  it('une date illisible n est pas urgente non plus', () => {
    expect(isUrgentGame(partie(2, 'n importe quoi'), now)).toBe(false);
  });
});

describe('le delai affiche sur la pastille', () => {
  it('compte en MINUTES en dessous d une heure', () => {
    // L'ancienne carte affichait `{heures}h` : une partie dans vingt minutes
    // annoncait « 0h », la plus pressante de toutes.
    expect(urgentDelayLabel(dans(20), now)).toBe('20 min');
    expect(urgentDelayLabel(dans(59), now)).toBe('59 min');
  });

  it('ne descend jamais a « 0 min »', () => {
    expect(urgentDelayLabel(dans(0.4), now)).toBe('1 min');
  });

  it('passe aux heures pleines au-dela', () => {
    expect(urgentDelayLabel(dans(60), now)).toBe('1 h');
    expect(urgentDelayLabel(dans(150), now)).toBe('2 h');
  });

  it('ne rend rien pour une partie passee, sans date ou illisible', () => {
    expect(urgentDelayLabel(dans(-5), now)).toBe('');
    expect(urgentDelayLabel(null, now)).toBe('');
    expect(urgentDelayLabel('bof', now)).toBe('');
  });
});
