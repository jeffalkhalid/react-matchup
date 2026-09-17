import { describe, it, expect, vi } from 'vitest';

// lib/games importe le client Supabase au chargement, lequel exige les
// variables d'environnement. Les fonctions testees ici sont PURES et ne s'en
// servent pas : on neutralise le module plutot que de deplacer le predicat
// loin de `freeSpots`, dont il depend.
vi.mock('../supabase', () => ({ supabase: {} }));

import {
  isUrgentGame, minutesUntil, urgentDelayLabel, joinErrorLabel, URGENT_WINDOW_MINUTES,
  isOngoingGame, staysInUpcoming,
} from '../games';

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

describe('un defi urgent : il manque un BINOME', () => {
  const defi = (autres: number, match_date: string | null) => ({ ...partie(autres, match_date), is_challenge: true });

  it('DEUX places libres : le defi est urgent', () => {
    // Un defi se rejoint a deux. Avec la regle « exactement une place », un
    // defi n'etait jamais urgent : releve sur telephone, defi dans 52 minutes
    // sans pastille.
    expect(isUrgentGame(defi(1, dans(52)), now)).toBe(true);
    expect(isUrgentGame(defi(1, dans(120)), now)).toBe(true);
  });

  it('une place seule reste urgente (cas qui ne doit pas exister)', () => {
    expect(isUrgentGame(defi(2, dans(60)), now)).toBe(true);
  });

  it('complet ou deux binomes manquants : pas urgent', () => {
    expect(isUrgentGame(defi(3, dans(60)), now)).toBe(false);
    expect(isUrgentGame(defi(0, dans(60)), now)).toBe(false);
  });

  it('la fenetre de six heures vaut aussi pour un defi', () => {
    expect(isUrgentGame(defi(1, dans(URGENT_WINDOW_MINUTES)), now)).toBe(true);
    expect(isUrgentGame(defi(1, dans(URGENT_WINDOW_MINUTES + 1)), now)).toBe(false);
    expect(isUrgentGame(defi(1, dans(-1)), now)).toBe(false);
  });

  it('une partie NORMALE a deux places n est toujours pas urgente', () => {
    expect(isUrgentGame(partie(1, dans(60)), now)).toBe(false);
  });
});

describe('« en cours » : l heure est passee ET la partie est complete', () => {
  it('complete, entre l heure et +1 h 30', () => {
    expect(isOngoingGame(partie(3, dans(-5)), now)).toBe(true);
    expect(isOngoingGame(partie(3, dans(-89)), now)).toBe(true);
  });

  it('INCOMPLETE : personne ne joue, donc jamais « en cours »', () => {
    // Releve sur telephone le 2026-09-17 : une partie a qui il manquait un
    // joueur s'affichait « EN COURS ».
    expect(isOngoingGame(partie(2, dans(-5)), now)).toBe(false);
  });

  it('avant l heure, ou au-dela d 1 h 30 : non', () => {
    expect(isOngoingGame(partie(3, dans(1)), now)).toBe(false);
    expect(isOngoingGame(partie(3, dans(-91)), now)).toBe(false);
  });

  it('sans date ou date illisible : non', () => {
    expect(isOngoingGame(partie(3, null), now)).toBe(false);
    expect(isOngoingGame(partie(3, 'bof'), now)).toBe(false);
  });
});

describe('rester dans « A venir »', () => {
  it('avant l heure, toujours — complete ou pas', () => {
    expect(staysInUpcoming(partie(3, dans(30)), now)).toBe(true);
    expect(staysInUpcoming(partie(1, dans(30)), now)).toBe(true);
  });

  it('heure passee et COMPLETE : on la garde pendant le match', () => {
    expect(staysInUpcoming(partie(3, dans(-30)), now)).toBe(true);
    expect(staysInUpcoming(partie(3, dans(-91)), now)).toBe(false);
  });

  it('heure passee et INCOMPLETE : elle part tout de suite', () => {
    expect(staysInUpcoming(partie(2, dans(-1)), now)).toBe(false);
    expect(staysInUpcoming(partie(2, dans(-30)), now)).toBe(false);
  });

  it('sans date ou date illisible : on la garde', () => {
    expect(staysInUpcoming(partie(2, null), now)).toBe(true);
    expect(staysInUpcoming(partie(2, 'bof'), now)).toBe(true);
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

describe('refus de join_game, en francais', () => {
  it('traduit le refus de mixite en disant ce qui se passe', () => {
    expect(joinErrorLabel('gender not allowed')).toContain('réservée à un autre genre');
  });

  it('DIT QUOI FAIRE quand le genre n est pas renseigne', () => {
    // Un message qui constate sans indiquer la sortie ne sert a rien.
    expect(joinErrorLabel('gender not set')).toContain('profil');
  });

  it('laisse passer un message inconnu plutot que de l avaler', () => {
    expect(joinErrorLabel('something odd')).toBe('something odd');
    expect(joinErrorLabel(null)).toBe('La demande a échoué.');
  });
});
