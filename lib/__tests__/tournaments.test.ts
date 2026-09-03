// Les dérivations d'affichage des tournois — celles que le schéma confie
// explicitement à l'app (« places = court_count x 4 se dérivent à la lecture »).
// Chacune est le port d'une fonction SQL nommée en commentaire : ce test est ce
// qui empêche l'écran de raconter autre chose que le serveur.

import { describe, it, expect } from 'vitest';
import {
  seatCount, teamCount, seatsTaken, waitlistCount, freePlaces, seatsLabel,
  seatedTeams, tournamentPhase, sameSideWarning, levelRangeLabel, priceLabel,
  soloRegistrations, myTournamentState, acceptsRegistrations, acceptsPairing,
  acceptsCheckIn, isFeatureDisabled,
  type TournamentRegistration, type TournamentTeam, type TournamentStatus,
} from '../tournaments';

const reg = (player_id: string, waitlist_position: number | null = null, extra: Partial<TournamentRegistration> = {}) => ({
  tournament_id: 'T', player_id, side: 'both', open_to_join: true,
  waitlist_position, check_in_status: 'pending', registered_at: '2026-09-01T18:00:00Z',
  ...extra,
} as TournamentRegistration);

const team = (id: string, a: string, b: string): TournamentTeam =>
  ({ id, tournament_id: 'T', player1_id: a, player2_id: b, withdrawn: false });

describe('les places se comptent en JOUEURS', () => {
  it('un terrain vaut quatre places et deux binomes', () => {
    expect(seatCount(4)).toBe(16);
    expect(teamCount(4)).toBe(8);
  });

  it('« 13/16 » est bien un nombre de joueurs assis sur un total de joueurs', () => {
    const regs = Array.from({ length: 13 }, (_, i) => reg(`p${i}`));
    expect(seatsLabel(regs, 4)).toBe('13/16');
    expect(seatsTaken(regs)).toBe(13);
  });

  it('une inscription en liste d’attente n’occupe aucune place', () => {
    const regs = [reg('a'), reg('b'), reg('c', 1), reg('d', 1)];
    expect(seatsTaken(regs)).toBe(2);
    expect(waitlistCount(regs)).toBe(2);
  });
});

describe('freePlaces — port de fn_tournament_free_places', () => {
  it('vaut le nombre de sièges vides quand personne n’attend', () => {
    expect(freePlaces([reg('a'), reg('b')], 1)).toBe(2);
  });

  it('vaut ZÉRO dès que quelqu’un attend, même s’il reste des sièges vides', () => {
    // Deux sièges libres sur quatre, mais une file existe : ces sièges
    // appartiennent à la file, pas au prochain arrivant.
    expect(freePlaces([reg('a'), reg('b'), reg('c', 1)], 1)).toBe(0);
  });
});

describe('seatedTeams — l’invariant de lecture de tournament_teams', () => {
  it('écarte un binôme dont les deux joueurs attendent', () => {
    const regs = [reg('a'), reg('b'), reg('c', 1), reg('d', 1)];
    const teams = [team('t1', 'a', 'b'), team('t2', 'c', 'd')];
    expect(seatedTeams(teams, regs).map(t => t.id)).toEqual(['t1']);
  });

  it('écarte aussi un binôme dont UN SEUL joueur attend', () => {
    const regs = [reg('a'), reg('b', 1)];
    expect(seatedTeams([team('t1', 'a', 'b')], regs)).toEqual([]);
  });
});

describe('les phases de la liste', () => {
  const cases: [TournamentStatus, string][] = [
    ['BROUILLON', 'draft'],
    ['INSCRIPTIONS_OUVERTES', 'upcoming'],
    ['COMPLET', 'upcoming'],
    ['CHECK_IN', 'upcoming'],
    ['PRET', 'upcoming'],
    ['EN_COURS', 'live'],
    ['TERMINE', 'past'],
    ['CLASSEMENT_VALIDE', 'past'],
  ];
  it.each(cases)('%s → %s', (status, phase) => {
    expect(tournamentPhase(status)).toBe(phase);
  });
});

describe('les fenêtres de statut, miroirs des gardes SQL', () => {
  it('inscription : ouvertes et complet seulement (au-delà, c’est la file)', () => {
    expect(acceptsRegistrations('INSCRIPTIONS_OUVERTES')).toBe(true);
    expect(acceptsRegistrations('COMPLET')).toBe(true);
    expect(acceptsRegistrations('CHECK_IN')).toBe(false);
  });
  it('appariement : jusqu’au lancement', () => {
    for (const s of ['INSCRIPTIONS_OUVERTES', 'COMPLET', 'CHECK_IN', 'PRET'] as TournamentStatus[]) {
      expect(acceptsPairing(s)).toBe(true);
    }
    expect(acceptsPairing('EN_COURS')).toBe(false);
  });
  it('pointage : check-in et prêt', () => {
    expect(acceptsCheckIn('CHECK_IN')).toBe(true);
    expect(acceptsCheckIn('PRET')).toBe(true);
    expect(acceptsCheckIn('COMPLET')).toBe(false);
  });
});

describe('même côté : signalé, jamais bloqué', () => {
  it('deux gauchers sont avertis', () => {
    expect(sameSideWarning('left', 'left')).toContain('gauche');
  });
  it('deux droitiers sont avertis', () => {
    expect(sameSideWarning('right', 'right')).toContain('droite');
  });
  it('des côtés complémentaires ne disent rien', () => {
    expect(sameSideWarning('left', 'right')).toBeNull();
  });
  it('« les deux » ne contraint rien, donc n’avertit jamais', () => {
    expect(sameSideWarning('both', 'both')).toBeNull();
    expect(sameSideWarning('both', 'left')).toBeNull();
  });
  it('un côté inconnu ne fabrique pas d’avertissement', () => {
    expect(sameSideWarning(null, 'left')).toBeNull();
  });
});

describe('libellés', () => {
  it('la plage de niveau', () => {
    expect(levelRangeLabel(3, 5)).toBe('Niveau 3 à 5');
    expect(levelRangeLabel(4, null)).toBe('Niveau 4 et plus');
    expect(levelRangeLabel(null, null)).toBe('Tous niveaux');
  });
  it('le prix est affiché, gratuit compris', () => {
    expect(priceLabel(150)).toBe('150 DH');
    expect(priceLabel(0)).toBe('Gratuit');
  });
});

describe('où j’en suis', () => {
  const regs = [reg('moi'), reg('toi'), reg('lui')];
  const teams = [team('t1', 'moi', 'toi')];
  const requests = [
    { id: 'r1', tournament_id: 'T', from_player: 'lui', to_player: 'moi', status: 'pending' as const, created_at: '' },
    { id: 'r2', tournament_id: 'T', from_player: 'moi', to_player: 'lui', status: 'pending' as const, created_at: '' },
  ];

  it('trouve mon inscription, mon binôme et mon partenaire', () => {
    const me = myTournamentState('moi', regs, teams, requests);
    expect(me.registration?.player_id).toBe('moi');
    expect(me.team?.id).toBe('t1');
    expect(me.partnerId).toBe('toi');
    expect(me.waitlisted).toBe(false);
  });

  it('sépare les demandes reçues des demandes envoyées', () => {
    const me = myTournamentState('moi', regs, teams, requests);
    expect(me.incoming.map(r => r.id)).toEqual(['r1']);
    expect(me.outgoing.map(r => r.id)).toEqual(['r2']);
  });

  it('les joueurs seuls sont ceux SANS binôme — pas ceux qui sont « ouverts »', () => {
    // 'lui' est le seul sans équipe ; 'moi' et 'toi' sont appariés bien qu'ils
    // aient open_to_join à true.
    expect(soloRegistrations(regs, teams).map(r => r.player_id)).toEqual(['lui']);
  });
});

describe('feature_disabled ne s’affiche pas, il fait disparaître l’entrée', () => {
  it('se reconnaît sur un refus, et sur lui seul', () => {
    expect(isFeatureDisabled({ ok: false, reason: 'feature_disabled' })).toBe(true);
    expect(isFeatureDisabled({ ok: false, reason: 'tournament_not_open' })).toBe(false);
    expect(isFeatureDisabled({ ok: true })).toBe(false);
    expect(isFeatureDisabled(null)).toBe(false);
  });
});
