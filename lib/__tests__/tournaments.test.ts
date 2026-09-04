// Les dérivations d'affichage des tournois — celles que le schéma confie
// explicitement à l'app (« places = court_count x 4 se dérivent à la lecture »).
// Chacune est le port d'une fonction SQL nommée en commentaire : ce test est ce
// qui empêche l'écran de raconter autre chose que le serveur.

import { describe, it, expect } from 'vitest';
import {
  seatCount, teamCount, seatsTaken, waitlistCount, freePlaces, seatsLabel,
  seatedTeams, tournamentPhase, sameSideWarning, levelRangeLabel, priceLabel,
  soloRegistrations, myTournamentState, acceptsRegistrations, acceptsPairing,
  acceptsCheckIn, isFeatureDisabled, matchLiveStatus, validateTournamentScore,
  computeCareerTotals,
  nextRoundIsFinal, missingMatchLabel, countLaterRoundMatches, pointsScaleValid,
  DEFAULT_POINTS_SCALE, statusLabel, statusTone, canOpenCheckIn, stakeLabel,
  groupResultsByTeam, dateBucket, formatTournamentDate, homeTournamentPick,
  monthMatrix, isoDay, timeSlots, defaultPointsScale, resizePointsScale,
  type TournamentRegistration, type TournamentTeam, type TournamentStatus,
  type TournamentMissingMatch, type TournamentResultTeamRow, type Tournament,
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

  it('`waitlist_position` ABSENT (undefined) occupe une place, comme `null` explicite — ' +
     'aucune fixture ne le posait jusqu’ici, un `== null` muté en `=== null` passait donc à tort', () => {
    const noKey = { player_id: 'x' } as unknown as Pick<TournamentRegistration, 'waitlist_position'>;
    expect(seatsTaken([noKey])).toBe(1);
    expect(waitlistCount([noKey])).toBe(0);
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

// La soirée (Task 8) : le tableau, le classement, la saisie.

const entry = (a: number, b: number) => ({ games_a: a, games_b: b });

describe('matchLiveStatus — jamais un vainqueur redérivé', () => {
  it('un bye se lit à `hasTeamB`, avant tout le reste', () => {
    expect(matchLiveStatus(false, null, null, [], [])).toBe('bye');
    // Même confirmé ou forfait, l'absence d'adversaire prime : ce cas ne
    // devrait jamais survenir en pratique (un bye ne se confirme ni ne se
    // forfait), mais le bye reste la première clé lue.
    expect(matchLiveStatus(false, 'x', '2026-01-01', [], [])).toBe('bye');
  });

  it('un forfait se lit à `forfeitedTeam`, jamais aux jeux', () => {
    // Score de courtoisie égal des deux côtés : rien dans les jeux ne dirait
    // qui a forfait, c'est bien le marqueur qui tranche.
    expect(matchLiveStatus(true, 'team-a', null, [entry(4, 4)], [entry(4, 4)])).toBe('forfeited');
  });

  it('confirmé se lit à `confirmedAt`, avant même de regarder les saisies', () => {
    expect(matchLiveStatus(true, null, '2026-01-01T20:00:00Z', [], [])).toBe('confirmed');
  });

  it('un match forfait PORTE AUSSI `confirmedAt` posé (le serveur écrit les deux) : ' +
     'reste `forfeited`, jamais `confirmed` — sous l’ordre inverse des deux gardes ' +
     'ci-dessus, ce cas rendrait `confirmed`, un score 0-0 s’afficherait comme un vrai ' +
     'score et la pastille « Forfait » disparaîtrait', () => {
    expect(matchLiveStatus(true, 'team-a', '2026-01-01T20:00:00Z', [], [])).toBe('forfeited');
  });

  it('personne n’a encore saisi → en attente', () => {
    expect(matchLiveStatus(true, null, null, [], [])).toBe('awaiting');
  });

  it('un seul camp a saisi → en attente, pas litige', () => {
    expect(matchLiveStatus(true, null, null, [entry(6, 3)], [])).toBe('awaiting');
    expect(matchLiveStatus(true, null, null, [], [entry(6, 3)])).toBe('awaiting');
  });

  it('les deux camps concordent → en attente (le serveur confirmera au refresh), pas litige', () => {
    expect(matchLiveStatus(true, null, null, [entry(6, 3)], [entry(6, 3)])).toBe('awaiting');
  });

  it('les deux camps se contredisent → litige', () => {
    expect(matchLiveStatus(true, null, null, [entry(6, 3)], [entry(6, 4)])).toBe('disputed');
  });
});

describe('validateTournamentScore — refuse l’égalité CÔTÉ ÉCRAN, avant le serveur', () => {
  it('rend null tant que la saisie est incomplète — pas encore une erreur', () => {
    expect(validateTournamentScore(null, null)).toBeNull();
    expect(validateTournamentScore(6, null)).toBeNull();
  });

  it('un score valide ne dit rien', () => {
    expect(validateTournamentScore(6, 3)).toBeNull();
  });

  it('l’égalité est refusée, avec un message qui explique pourquoi', () => {
    expect(validateTournamentScore(4, 4)).toContain('égalité');
  });

  it('un score négatif est refusé', () => {
    expect(validateTournamentScore(-1, 3)).not.toBeNull();
  });

  it('un score au-delà de 20 jeux est refusé', () => {
    expect(validateTournamentScore(21, 3)).not.toBeNull();
  });

  it('20 jeux reste dans les bornes', () => {
    expect(validateTournamentScore(20, 3)).toBeNull();
  });
});

// « Mon parcours » (Task 9) : les cumuls, sur des lignes déjà filtrées
// CLASSEMENT_VALIDE par `fetchMyTournamentResults` — cette fonction ne
// revérifie aucun statut, elle ne fait que sommer.

const res = (final_rank: number, played: number, wins: number, games_won: number, games_lost: number, points: number) =>
  ({ final_rank, played, wins, games_won, games_lost, points });

describe('computeCareerTotals — les cumuls de « Mon parcours »', () => {
  it('aucun tournoi validé : tout à zéro, pas de division par zéro', () => {
    const t = computeCareerTotals([]);
    expect(t).toEqual({
      tournamentsPlayed: 0, matchesPlayed: 0, wins: 0, losses: 0, winPct: 0,
      gamesWon: 0, gamesLost: 0, gamesDiff: 0, tournamentWins: 0, podiums: 0, points: 0,
    });
  });

  it('les défaites se DÉDUISENT (played - wins), il n’y a pas de colonne pour ça', () => {
    // 6 matchs joués, 4 gagnés : 2 défaites, jamais lues nulle part.
    const t = computeCareerTotals([res(2, 6, 4, 24, 14, 80)]);
    expect(t.losses).toBe(2);
  });

  it('somme sur plusieurs tournois, et arrondit le pourcentage de victoires', () => {
    const rows = [
      res(1, 6, 5, 30, 12, 100), // 1er : victoire de tournoi ET podium
      res(4, 6, 3, 20, 20, 65),  // podium raté (4e)
      res(3, 6, 4, 22, 15, 65),  // podium (3e)
    ];
    const t = computeCareerTotals(rows);
    expect(t.tournamentsPlayed).toBe(3);
    expect(t.matchesPlayed).toBe(18);
    expect(t.wins).toBe(12);
    expect(t.losses).toBe(6);
    expect(t.winPct).toBe(67); // 12/18 = 66.66… → 67
    expect(t.gamesWon).toBe(72);
    expect(t.gamesLost).toBe(47);
    expect(t.gamesDiff).toBe(25);
    expect(t.tournamentWins).toBe(1);
    expect(t.podiums).toBe(2);
    expect(t.points).toBe(230);
  });

  it('podium = rang 1, 2 OU 3 — pas seulement la victoire', () => {
    const rows = [res(1, 6, 6, 36, 6, 100), res(2, 6, 5, 30, 12, 80), res(3, 6, 4, 24, 18, 65)];
    expect(computeCareerTotals(rows).podiums).toBe(3);
    expect(computeCareerTotals(rows).tournamentWins).toBe(1);
  });

  it('la différence de jeux peut être négative', () => {
    const t = computeCareerTotals([res(8, 6, 1, 10, 30, 20)]);
    expect(t.gamesDiff).toBe(-20);
  });
});

// ─── L'organisation (Task 10) ─────────────────────────────────────────────

describe('nextRoundIsFinal — quand appeler generateFinalTournamentRound', () => {
  it('vrai quand le tour à tirer EST la dernière rotation', () => {
    expect(nextRoundIsFinal(5, 6)).toBe(true); // tour 5 acquis, tour 6 = dernier
  });

  it('faux tant qu’il reste des rotations ordinaires avant la dernière', () => {
    expect(nextRoundIsFinal(0, 6)).toBe(false); // premier tour
    expect(nextRoundIsFinal(3, 6)).toBe(false);
    expect(nextRoundIsFinal(4, 6)).toBe(false);
  });

  it('faux une fois la dernière rotation déjà tirée (rien à générer)', () => {
    expect(nextRoundIsFinal(6, 6)).toBe(false);
  });
});

describe('missingMatchLabel — le refus round_incomplete, nommé', () => {
  const base: Pick<TournamentMissingMatch, 'court_no' | 'team_a_label' | 'team_b_label' | 'entries' | 'disputed'> = {
    court_no: 2, team_a_label: 'Alice · Bob', team_b_label: 'Carla · Dan', entries: 0, disputed: false,
  };

  it('nomme le terrain et les deux binômes', () => {
    expect(missingMatchLabel(base)).toContain('Terrain 2');
    expect(missingMatchLabel(base)).toContain('Alice · Bob');
    expect(missingMatchLabel(base)).toContain('Carla · Dan');
  });

  it('distingue « aucune saisie », « un seul camp » et « litige »', () => {
    expect(missingMatchLabel({ ...base, entries: 0, disputed: false })).toContain('aucune saisie');
    expect(missingMatchLabel({ ...base, entries: 1, disputed: false })).toContain('un seul camp a saisi');
    expect(missingMatchLabel({ ...base, entries: 2, disputed: true })).toContain('litige');
  });

  it('un binôme sans nom retombe sur un libellé générique, jamais un identifiant nu', () => {
    const label = missingMatchLabel({ ...base, team_a_label: null, team_b_label: null });
    expect(label).toContain('Équipe A');
    expect(label).toContain('Équipe B');
  });
});

describe('countLaterRoundMatches — ce qu’une réouverture détruirait', () => {
  const m = (round_no: number) => ({ round_no });

  it('compte les matchs des tours STRICTEMENT postérieurs, byes compris', () => {
    const matches = [m(1), m(1), m(2), m(2), m(3)];
    expect(countLaterRoundMatches(matches, 1)).toBe(3);
    expect(countLaterRoundMatches(matches, 2)).toBe(1);
  });

  it('zéro quand on rouvre le dernier tour joué', () => {
    const matches = [m(1), m(2), m(3)];
    expect(countLaterRoundMatches(matches, 3)).toBe(0);
  });
});

describe('pointsScaleValid — miroir de la CHECK sur tournaments.points_scale', () => {
  it('accepte le barème par défaut du schéma', () => {
    expect(pointsScaleValid(DEFAULT_POINTS_SCALE)).toBe(true);
  });

  it('refuse toute valeur négative', () => {
    expect(pointsScaleValid({ '1': 100, '2': -5 })).toBe(false);
  });

  it('accepte zéro, et refuse un barème vide', () => {
    expect(pointsScaleValid({ '1': 0 })).toBe(true);
    expect(pointsScaleValid({})).toBe(false);
  });
});

// ─── ANNULE (Task 12) ──────────────────────────────────────────────────────

describe('ANNULE — un tournoi mort, jamais affiché comme vivant', () => {
  it('va dans « Passés », ni « à venir » ni « en cours »', () => {
    expect(tournamentPhase('ANNULE')).toBe('past');
  });

  it('a son propre libellé, jamais confondu avec un autre statut', () => {
    expect(statusLabel('ANNULE')).toBe('Annulé');
    expect(statusLabel('ANNULE')).not.toBe(statusLabel('TERMINE'));
  });

  it('n’accepte plus rien : ni inscription, ni appariement, ni pointage', () => {
    expect(acceptsRegistrations('ANNULE')).toBe(false);
    expect(acceptsPairing('ANNULE')).toBe(false);
    expect(acceptsCheckIn('ANNULE')).toBe(false);
    expect(canOpenCheckIn('ANNULE')).toBe(false);
  });
});

describe('statusTone — la couleur d’un statut, SOURCE UNIQUE (comme statusLabel pour le texte)', () => {
  it('COMPLET a une seule couleur, la même partout où ce code l’appelle', () => {
    expect(statusTone('COMPLET')).toBe('warning');
  });

  it('un statut et son opposé n’ont jamais la même couleur', () => {
    expect(statusTone('INSCRIPTIONS_OUVERTES')).not.toBe(statusTone('ANNULE'));
    expect(statusTone('EN_COURS')).not.toBe(statusTone('TERMINE'));
  });

  it('ANNULE est signalé (danger), jamais confondu avec TERMINE (neutre)', () => {
    expect(statusTone('ANNULE')).toBe('danger');
    expect(statusTone('TERMINE')).toBe('neutral');
  });
});

describe('canOpenCheckIn — miroir de tournament_open_check_in', () => {
  it('ouvertes et complet seulement', () => {
    expect(canOpenCheckIn('INSCRIPTIONS_OUVERTES')).toBe(true);
    expect(canOpenCheckIn('COMPLET')).toBe(true);
  });
  it('pas une fois le pointage déjà ouvert, ni après', () => {
    expect(canOpenCheckIn('CHECK_IN')).toBe(false);
    expect(canOpenCheckIn('PRET')).toBe(false);
    expect(canOpenCheckIn('EN_COURS')).toBe(false);
  });
});

// ─── stakes (Task 12) : l’enjeu de la rotation de classement ────────────────

describe('stakeLabel — la traduction d’UNE ligne de stakes, jamais un calcul de rang', () => {
  it('les deux places d’un terrain qui oppose deux équipes', () => {
    expect(stakeLabel({ rank_win: 3, rank_lose: 4 })).toBe('Places 3 et 4 en jeu');
  });

  it('une seule place pour un bye qui ne partage pas son palier', () => {
    expect(stakeLabel({ rank_win: 1, rank_lose: null })).toBe('Place 1 en jeu');
  });

  it('rien à annoncer pour un bye qui partage son palier avec un match', () => {
    expect(stakeLabel({ rank_win: null, rank_lose: null })).toBeNull();
  });
});

// ─── Le classement figé d’un tournoi clos (Task 12) ──────────────────────────

describe('groupResultsByTeam — une ligne par joueur devient une ligne par binôme', () => {
  const row = (team_id: string, player_id: string, final_rank: number): TournamentResultTeamRow => ({
    tournament_id: 'T', team_id, player_id, final_rank, played: 6, wins: 4, games_won: 24, games_lost: 14, points: 80,
  });

  it('regroupe les deux joueurs d’un même binôme sans dupliquer la ligne', () => {
    const rows = [row('t1', 'a', 1), row('t1', 'b', 1)];
    const grouped = groupResultsByTeam(rows);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].player_ids.sort()).toEqual(['a', 'b']);
    expect(grouped[0].final_rank).toBe(1);
  });

  it('trie par rang final, plusieurs binômes', () => {
    const rows = [row('t2', 'c', 3), row('t2', 'd', 3), row('t1', 'a', 1), row('t1', 'b', 1)];
    const grouped = groupResultsByTeam(rows);
    expect(grouped.map(g => g.team_id)).toEqual(['t1', 't2']);
  });

  it('ne recalcule aucun total : les chiffres sont recopiés tels quels', () => {
    const grouped = groupResultsByTeam([row('t1', 'a', 2), row('t1', 'b', 2)]);
    expect(grouped[0]).toMatchObject({ played: 6, wins: 4, games_won: 24, games_lost: 14, points: 80 });
  });
});

// ─── dateBucket — SOURCE UNIQUE du « aujourd'hui / demain » (Task 12) ────────
// Avant cette fonction, `formatTournamentDate` ici et `splitDate`
// (components/tournaments/TournamentCard.tsx) portaient chacune leur propre
// calcul, NI L'UN NI L'AUTRE testé — deux implémentations qui pouvaient
// diverger au passage de minuit.

describe('dateBucket — le jour calendaire d’une date ISO, par rapport à `now`', () => {
  const now = new Date('2026-09-10T22:00:00');

  it('la même date calendaire que `now` est « today », même à une autre heure', () => {
    expect(dateBucket('2026-09-10T08:00:00', now)).toBe('today');
  });

  it('le lendemain calendaire est « tomorrow »', () => {
    expect(dateBucket('2026-09-11T08:00:00', now)).toBe('tomorrow');
  });

  it('tout le reste est « other », avant comme après', () => {
    expect(dateBucket('2026-09-09T08:00:00', now)).toBe('other');
    expect(dateBucket('2026-09-12T08:00:00', now)).toBe('other');
  });

  it('minuit ne fait pas déborder « today » sur la veille ou le lendemain', () => {
    const justAfterMidnight = new Date('2026-09-10T00:05:00');
    expect(dateBucket('2026-09-10T23:55:00', justAfterMidnight)).toBe('today');
    expect(dateBucket('2026-09-09T23:55:00', justAfterMidnight)).toBe('other');
  });
});

describe('formatTournamentDate — utilise dateBucket, jamais un calcul séparé', () => {
  it('contient "Aujourd\'hui" pour la date du jour', () => {
    const today = new Date();
    const hh = String(today.getHours()).padStart(2, '0');
    const mm = String(today.getMinutes()).padStart(2, '0');
    expect(formatTournamentDate(today.toISOString())).toBe(`Aujourd'hui · ${hh}h${mm}`);
  });
});

// ── La carte d'accueil : quand apparaît-elle ? ─────────────────────────────
const tournoi = (id: string, starts_at: string, status: TournamentStatus = 'INSCRIPTIONS_OUVERTES'): Tournament =>
  ({ id, name: id, club_id: null, starts_at, ends_at: null, level_min: null, level_max: null,
     court_count: 4, round_count: 6, price_mad: 0, forfeit_games: 0, status,
     current_round: 0, created_by: 'orga', created_at: starts_at } as Tournament);

describe("carte d'accueil — n'apparaît que s'il y a quelque chose à faire", () => {
  it('propose le tournoi a venir auquel je ne suis pas inscrit', () => {
    const t = tournoi('T1', '2026-09-10T18:00:00Z');
    const pick = homeTournamentPick([t], new Map([['T1', [reg('autre')]]]), 'moi');
    expect(pick?.tournament.id).toBe('T1');
    expect(pick?.free).toBe(15); // 4 terrains x 4 places, un siege pris
    expect(pick?.state).toBe('open');
  });

  it('RESTE quand je suis inscrit, et le dit — sinon on oublie qu on joue jeudi', () => {
    const t = tournoi('T1', '2026-09-10T18:00:00Z');
    const pick = homeTournamentPick([t], new Map([['T1', [reg('moi')]]]), 'moi');
    expect(pick?.tournament.id).toBe('T1');
    expect(pick?.state).toBe('registered');
  });

  it('distingue la liste d attente de l inscription', () => {
    const t = tournoi('T1', '2026-09-10T18:00:00Z');
    expect(homeTournamentPick([t], new Map([['T1', [reg('moi', 1)]]]), 'moi')?.state).toBe('waitlisted');
  });

  it('ignore ce qui n est pas a venir : en cours, termine, annule', () => {
    const encours = tournoi('T1', '2026-09-10T18:00:00Z', 'EN_COURS');
    const termine = tournoi('T2', '2026-09-11T18:00:00Z', 'TERMINE');
    const annule  = tournoi('T3', '2026-09-12T18:00:00Z', 'ANNULE');
    expect(homeTournamentPick([encours, termine, annule], new Map(), 'moi')).toBeNull();
  });

  it('prend le PLUS PROCHE, pas le premier de la liste', () => {
    const tard = tournoi('TARD', '2026-09-20T18:00:00Z');
    const tot  = tournoi('TOT',  '2026-09-11T18:00:00Z');
    expect(homeTournamentPick([tard, tot], new Map(), 'moi')?.tournament.id).toBe('TOT');
  });

  it('le plus proche gagne, meme si je suis deja inscrit dessus', () => {
    // C est « ce qui vient » qui compte, pas « ce sur quoi il reste a agir ».
    const tot  = tournoi('TOT',  '2026-09-11T18:00:00Z');
    const tard = tournoi('TARD', '2026-09-20T18:00:00Z');
    const pick = homeTournamentPick([tard, tot], new Map([['TOT', [reg('moi')]]]), 'moi');
    expect(pick?.tournament.id).toBe('TOT');
    expect(pick?.state).toBe('registered');
  });

  it('reste affiche quand c est complet : entrer en file est encore une action', () => {
    const t = tournoi('T1', '2026-09-10T18:00:00Z', 'COMPLET');
    const pleins = Array.from({ length: 16 }, (_, i) => reg(`p${i}`));
    const pick = homeTournamentPick([t], new Map([['T1', pleins]]), 'moi');
    expect(pick?.tournament.id).toBe('T1');
    expect(pick?.free).toBe(0);
  });

  it('rend null quand il n y a aucun tournoi', () => {
    expect(homeTournamentPick([], new Map(), 'moi')).toBeNull();
  });
});

// ── Calendrier et créneaux horaires ────────────────────────────────────────
describe('grille du mois — semaines commençant le lundi', () => {
  it('septembre 2026 commence un mardi : une seule case vide avant le 1er', () => {
    // 2026-09-01 est un mardi -> lundi = 0, mardi = 1, donc un décalage de 1.
    const g = monthMatrix(2026, 8);
    expect(g[0][0]).toBeNull();
    expect(g[0][1]).toBe(1);
  });

  it('ne perd aucun jour et n en invente aucun', () => {
    for (const [y, m, n] of [[2026, 8, 30], [2026, 0, 31], [2026, 1, 28], [2024, 1, 29]] as const) {
      const jours = monthMatrix(y, m).flat().filter(d => d !== null);
      expect(jours.length).toBe(n);
      expect(jours[0]).toBe(1);
      expect(jours[jours.length - 1]).toBe(n);
    }
  });

  it('rend toujours des lignes completes de sept cases', () => {
    for (const m of [0, 1, 5, 8, 11]) {
      for (const l of monthMatrix(2026, m)) expect(l.length).toBe(7);
    }
  });

  it('fevrier 2024 est bissextile — 29 jours, pas 28', () => {
    expect(monthMatrix(2024, 1).flat().filter(d => d !== null).length).toBe(29);
  });
});

describe('date et heure du formulaire', () => {
  it('isoDay complete les zeros', () => {
    expect(isoDay(2026, 8, 4)).toBe('2026-09-04');
    expect(isoDay(2026, 11, 25)).toBe('2026-12-25');
  });

  it('les creneaux vont du premier au dernier, par pas de 30 min', () => {
    const s = timeSlots();
    expect(s[0]).toBe('08:00');
    expect(s[1]).toBe('08:30');
    expect(s[s.length - 1]).toBe('23:30');
  });

  it('la date et l heure se recollent en un instant valide', () => {
    const d = new Date(`${isoDay(2026, 8, 4)}T${timeSlots()[22]}`);
    expect(isNaN(d.getTime())).toBe(false);
    expect(d.getHours()).toBe(19);
  });
});

// ── Le barème s'adapte au nombre de terrains ───────────────────────────────
describe('bareme par rang — autant de rangs que de binomes', () => {
  it('huit binomes : exactement le bareme du reglement', () => {
    expect(defaultPointsScale(8)).toEqual(DEFAULT_POINTS_SCALE);
  });

  it('trois terrains = six binomes : six rangs, pas huit', () => {
    const b = defaultPointsScale(6);
    expect(Object.keys(b)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(b['6']).toBe(35);
  });

  it('cinq terrains = dix binomes : dix rangs, et AUCUN ex aequo', () => {
    // Le defaut : fn_tournament_points retombe sur le dernier seuil, donc un
    // bareme a huit entrees donnait 15 points aux 8e, 9e et 10e.
    const b = defaultPointsScale(10);
    expect(Object.keys(b).length).toBe(10);
    expect(b['8']).toBe(15);
    expect(b['9']).toBe(14);
    expect(b['10']).toBe(13);
  });

  it('chaque rang vaut STRICTEMENT moins que le precedent, jusqu au rang 22', () => {
    for (const n of [4, 6, 8, 10, 12, 16, 22]) {
      const b = defaultPointsScale(n);
      for (let r = 2; r <= n; r++) expect(b[String(r)]).toBeLessThan(b[String(r - 1)]);
    }
  });

  it('au-dela, ex aequo assumes : aucun bareme strict n existe sous 15 points', () => {
    // Le serveur accepte 20 terrains = 40 binomes. Sous 15 il ne reste que
    // quatorze entiers positifs : la stricte decroissance est impossible.
    const b = defaultPointsScale(40);
    expect(b['22']).toBe(1);
    expect(b['40']).toBe(1);
    for (let r = 2; r <= 40; r++) expect(b[String(r)]).toBeLessThanOrEqual(b[String(r - 1)]);
  });

  it('jamais zero ni negatif, meme tres loin', () => {
    const b = defaultPointsScale(24);
    for (const v of Object.values(b)) expect(v).toBeGreaterThan(0);
  });

  it('redimensionner GARDE ce que l organisateur a deja saisi', () => {
    const saisi = { '1': '150', '2': '80', '3': '65', '4': '55', '5': '45', '6': '35', '7': '25', '8': '15' };
    const plus = resizePointsScale(saisi, 10);
    expect(plus['1']).toBe('150');          // sa valeur a lui, pas le defaut
    expect(plus['9']).toBe('14');           // les rangs neufs prennent le defaut
    expect(Object.keys(plus).length).toBe(10);

    const moins = resizePointsScale(saisi, 6);
    expect(moins['1']).toBe('150');
    expect(Object.keys(moins).length).toBe(6);  // les rangs 7 et 8 disparaissent
  });
});

describe("carte d'accueil — plusieurs tournois annonces", () => {
  it('montre le plus proche et COMPTE les autres', () => {
    const a = tournoi('A', '2026-09-10T18:00:00Z');
    const b = tournoi('B', '2026-09-17T18:00:00Z');
    const c = tournoi('C', '2026-09-24T18:00:00Z');
    const pick = homeTournamentPick([c, a, b], new Map(), 'moi');
    expect(pick?.tournament.id).toBe('A');
    expect(pick?.others).toBe(2);
  });

  it('un seul tournoi : aucun autre a signaler', () => {
    const a = tournoi('A', '2026-09-10T18:00:00Z');
    expect(homeTournamentPick([a], new Map(), 'moi')?.others).toBe(0);
  });

  it('ne compte QUE les soirees a venir', () => {
    const a = tournoi('A', '2026-09-10T18:00:00Z');
    const fini = tournoi('FINI', '2026-09-17T18:00:00Z', 'TERMINE');
    const encours = tournoi('LIVE', '2026-09-18T18:00:00Z', 'EN_COURS');
    expect(homeTournamentPick([a, fini, encours], new Map(), 'moi')?.others).toBe(0);
  });

  it('le cas qui motive tout : inscrit a jeudi, un autre cherche des joueurs', () => {
    const jeudi = tournoi('JEUDI', '2026-09-10T18:00:00Z');
    const autre = tournoi('AUTRE', '2026-09-17T18:00:00Z');
    const pick = homeTournamentPick([jeudi, autre], new Map([['JEUDI', [reg('moi')]]]), 'moi');
    expect(pick?.state).toBe('registered');
    expect(pick?.others).toBe(1);   // sans ca, AUTRE serait invisible depuis l'accueil
  });
});
