// Les dérivations d'affichage des tournois — celles que le schéma confie
// explicitement à l'app (« places = court_count x 4 se dérivent à la lecture »).
// Chacune est le port d'une fonction SQL nommée en commentaire : ce test est ce
// qui empêche l'écran de raconter autre chose que le serveur.

import { describe, it, expect } from 'vitest';
import {
  roundMinutesOf, totalDurationMinutes, ROUND_MINUTES, formatLabel, pointsLadder, rankBarHeights, autoValidateLabel,
  groupRegistrations, pairsCountLabel, partnerPath, registerCtaLabel,
  seatCount, teamCount, seatsTaken, waitlistCount, freePlaces, seatsLabel,
  waitExplanation, registerNotice, partnerIntentNotice, myLiveTournament,
  seatedTeams, tournamentPhase, sameSideWarning, levelRangeLabel, priceLabel,
  soloRegistrations, myTournamentState, acceptsRegistrations, acceptsPairing,
  acceptsCheckIn, isFeatureDisabled, matchLiveStatus, validateTournamentScore,
  computeCareerTotals,
  nextRoundIsFinal, missingMatchLabel, countLaterRoundMatches, pointsScaleValid,
  DEFAULT_POINTS_SCALE, statusLabel, statusTone, canOpenCheckIn, stakeLabel,
  groupResultsByTeam, dateBucket, formatTournamentDate,
  monthMatrix, isoDay, timeSlots, defaultPointsScale, resizePointsScale,
  daysUntilLabel, shortFormatLabel, homeTournamentList, isExpiredUnstarted,
  levelAccepted, isThisWeekend, filterTournaments, bestFilterToDrop, activeFilterCount, NO_FILTERS,
  blockedCourts, blockedCourtReason, blockedCourtLabel, type BlockedCourtInput,
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

  it('compte les sièges vides MEME quand quelqu’un attend', () => {
    // CE TEST AFFIRMAIT L'INVERSE, et il avait raison a l'epoque : les sieges
    // appartenaient a la file, pas au prochain arrivant. La regle du
    // siege-aux-binomes l'a rendu faux — un joueur seul en file ne PEUT pas
    // prendre un siege, donc les sieges vides ne lui appartiennent pas.
    //
    // Le cout du maintien de l'ancienne regle, vu a l'ecran : toute
    // inscription passant desormais par la file, un tournoi de 32 places
    // affichait « COMPLET » des son premier inscrit.
    expect(freePlaces([reg('a'), reg('b'), reg('c', 1)], 1)).toBe(2);
  });

  it('vaut zero quand les sieges sont VRAIMENT tous pris', () => {
    expect(freePlaces([reg('a'), reg('b'), reg('c'), reg('d')], 1)).toBe(0);
    // Et la file par-dessus n'y change rien, dans un sens comme dans l'autre.
    expect(freePlaces([reg('a'), reg('b'), reg('c'), reg('d'), reg('e', 1)], 1)).toBe(0);
  });
});

describe('la soiree qui se joue maintenant — myLiveTournament', () => {
  const TO = (id: string, status: any) => ({
    id, name: id, club_id: null, starts_at: '2026-09-11T18:00:00Z', ends_at: null,
    level_min: null, level_max: null, court_count: 8, round_count: 6,
    price_mad: 0, forfeit_games: 0, status, current_round: 2,
    created_by: 'org', created_at: '2026-09-01T00:00:00Z',
  } as any);
  const RG = (tid: string, pid: string, wl: number | null = null) =>
    ({ tournament_id: tid, player_id: pid, waitlist_position: wl });
  // Horloge FIXE, pendant la soiree des fixtures (18:00Z, 6 rotations) : un
  // test qui lit l'horloge reelle casse le jour ou la date de fixture passe.
  const NOW = new Date('2026-09-11T18:30:00Z');

  it('trouve le tournoi en cours ou j ai une place', () => {
    expect(myLiveTournament([TO('t1', 'EN_COURS')], [RG('t1', 'moi')], 'moi', NOW)?.id).toBe('t1');
  });

  it('inclut CHECK_IN et PRET : on est au club, c est la que ca sert', () => {
    for (const s of ['CHECK_IN', 'PRET']) {
      expect(myLiveTournament([TO('t1', s)], [RG('t1', 'moi')], 'moi', NOW)?.id).toBe('t1');
    }
  });

  it('ignore ce qui ne se joue pas', () => {
    for (const s of ['INSCRIPTIONS_OUVERTES', 'COMPLET', 'TERMINE', 'ANNULE']) {
      expect(myLiveTournament([TO('t1', s)], [RG('t1', 'moi')], 'moi', NOW)).toBe(null);
    }
  });

  it('ignore une inscription en LISTE D ATTENTE', () => {
    // Sans siege il n'y a pas de terrain a rejoindre : la banniere menerait a
    // un ecran qui dit « tu ne joues pas cette rotation ».
    expect(myLiveTournament([TO('t1', 'EN_COURS')], [RG('t1', 'moi', 3)], 'moi', NOW)).toBe(null);
  });

  it('ignore un tournoi ou je ne suis pas inscrit', () => {
    expect(myLiveTournament([TO('t1', 'EN_COURS')], [RG('t1', 'autre')], 'moi', NOW)).toBe(null);
  });

  it('pas de banniere pour un pointage JAMAIS LANCE dont la soiree est passee', () => {
    // Sans ca, « c'est ce soir » s'afficherait sur l'accueil indefiniment.
    const lendemain = new Date('2026-09-12T12:00:00Z');
    for (const s of ['CHECK_IN', 'PRET']) {
      expect(myLiveTournament([TO('t1', s)], [RG('t1', 'moi')], 'moi', lendemain)).toBe(null);
    }
  });

  it('un tournoi EN COURS garde sa banniere, meme en retard sur l horaire', () => {
    const lendemain = new Date('2026-09-12T12:00:00Z');
    expect(myLiveTournament([TO('t1', 'EN_COURS')], [RG('t1', 'moi')], 'moi', lendemain)?.id).toBe('t1');
  });
});

describe('ce qui va arriver au partenaire — partnerIntentNotice', () => {
  it('nomme la personne, dans les quatre cas', () => {
    for (const p of ['instant', 'request', 'direct', 'blocked'] as const) {
      expect(partnerIntentNotice(p, 'Karim')).toContain('Karim');
    }
  });

  it('ne promet un binome IMMEDIAT que sur le chemin instantane', () => {
    // Le bandeau d'avant disait la meme chose pour tout le monde. Croire
    // qu'on est apparie alors qu'on attend une reponse, c'est arriver a deux
    // le soir du tournoi et decouvrir qu'on n'y est pas.
    expect(partnerIntentNotice('instant', 'Karim')).toMatch(/dès ton inscription/);
    expect(partnerIntentNotice('request', 'Karim')).toMatch(/s’il accepte/);
    expect(partnerIntentNotice('direct', 'Karim')).toMatch(/décidera/);
  });

  it('ne dit JAMAIS qu on inscrit quelqu un a sa place', () => {
    // L'inscription d'office a ete supprimee par
    // tournament_partner_invite.sql ; le texte la decrivait encore.
    //
    // On vise l'AFFIRMATION fautive, pas les mots : le cas « direct » dit
    // « rien n'est inscrit en son nom », ce qui est exactement l'inverse et
    // qu'il faut garder.
    for (const p of ['instant', 'request', 'direct', 'blocked'] as const) {
      expect(partnerIntentNotice(p, 'Karim')).not.toMatch(/inscrit sans rien déclarer/);
      expect(partnerIntentNotice(p, 'Karim')).not.toMatch(/côté « les deux »/);
    }
    expect(partnerIntentNotice('direct', 'Karim')).toMatch(/rien n’est inscrit en son nom/);
  });

  it('dit qu un joueur DEJA inscrit a declare ses propres choix', () => {
    for (const p of ['instant', 'request'] as const) {
      expect(partnerIntentNotice(p, 'Karim')).toMatch(/déjà inscrit/);
    }
    expect(partnerIntentNotice('direct', 'Karim')).toMatch(/pas encore inscrit/);
  });
});

describe('pourquoi j’attends — waitExplanation', () => {
  it('sans binome, on parle de PARTENAIRE, jamais de place', () => {
    // Le texte disait « ta place se prendra des qu'il s'en libere une » a
    // quelqu'un qui voyait trente sieges vides. Ce n'est pas une place qui
    // lui manque.
    const txt = waitExplanation({ hasPartner: false, pairingOpen: true });
    expect(txt).toContain('binôme');
    expect(txt).not.toMatch(/plein|complet/i);
  });

  it('avec un binome, attendre veut bien dire qu il n y a plus de place', () => {
    // `fn_tournament_promote_waitlist` assied tout binome qui tient, a chaque
    // geste : un binome qui attend est forcement un binome sans siege.
    expect(waitExplanation({ hasPartner: true, pairingOpen: true }))
      .toMatch(/places sont prises/i);
  });

  it('une fois le tournoi lance, on ne promet plus rien', () => {
    for (const hasPartner of [true, false]) {
      expect(waitExplanation({ hasPartner, pairingOpen: false }))
        .toMatch(/démarré/i);
    }
  });
});

describe('ce qu’on annonce avant de s’inscrire — registerNotice', () => {
  it('avec des places libres : on explique la regle des binomes', () => {
    const txt = registerNotice(30);
    expect(txt).toContain('binôme');
    expect(txt).not.toMatch(/plein|toutes les places/i);
  });

  it('sans place : on le dit franchement', () => {
    expect(registerNotice(0)).toMatch(/toutes les places sont prises/i);
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

describe('pastille d echeance', () => {
  const now = new Date(2026, 8, 4, 10, 0, 0);   // ven. 4 sept. 2026, 10h

  it('ce soir, demain, puis J-N en JOURS DE CALENDRIER', () => {
    expect(daysUntilLabel(new Date(2026, 8, 4, 19, 0).toISOString(), now)).toBe('CE SOIR');
    // Demain 9h = dans 23 h : « DEMAIN », pas « J-0 ».
    expect(daysUntilLabel(new Date(2026, 8, 5, 9, 0).toISOString(), now)).toBe('DEMAIN');
    expect(daysUntilLabel(new Date(2026, 8, 11, 19, 0).toISOString(), now)).toBe('J-7');
  });

  it('une soiree passee ne dit pas J-négatif', () => {
    expect(daysUntilLabel(new Date(2026, 8, 1, 19, 0).toISOString(), now)).toBe('PASSÉ');
  });
});

describe('libelle de format court', () => {
  it('reprend la forme de la maquette', () => {
    expect(shortFormatLabel(3, 5)).toBe('DOUBLE · NIV. 3-5');
    expect(shortFormatLabel(3, null)).toBe('DOUBLE · NIV. 3+');
    expect(shortFormatLabel(null, 5)).toBe('DOUBLE · NIV. 5 MAX');
    expect(shortFormatLabel(null, null)).toBe('DOUBLE · TOUS NIVEAUX');
  });

  it('garde la decimale quand il y en a une', () => {
    expect(shortFormatLabel(3.5, 5)).toBe('DOUBLE · NIV. 3.5-5');
  });
});

describe('liste des soirees pour l accueil', () => {
  // Horloge FIXE, avant toutes les fixtures : ces tests portent sur le tri
  // et le comptage, pas sur l'expiration (testee plus bas).
  const AVANT = new Date('2026-09-01T00:00:00Z');
  it('les rend TOUTES, de la plus proche a la plus lointaine', () => {
    const a = tournoi('A', '2026-09-10T18:00:00Z');
    const b = tournoi('B', '2026-09-17T18:00:00Z');
    const l = homeTournamentList([b, a], new Map(), 'moi', AVANT);
    expect(l.map(e => e.tournament.id)).toEqual(['A', 'B']);
  });

  it('compte les places en JOUEURS, pas en binomes', () => {
    // 4 terrains = 16 places joueurs (8 binomes). La maquette montrait 6/8,
    // en binomes : c est l unite de toute l app qui gagne, pas la maquette.
    const t = tournoi('T', '2026-09-10T18:00:00Z');
    const l = homeTournamentList([t], new Map([['T', [reg('a'), reg('b'), reg('c')]]]), 'moi', AVANT);
    expect(l[0].taken).toBe(3);
    expect(l[0].total).toBe(16);
  });

  it('dit ou j en suis sur chacune', () => {
    const a = tournoi('A', '2026-09-10T18:00:00Z');
    const b = tournoi('B', '2026-09-17T18:00:00Z');
    const l = homeTournamentList([a, b], new Map([['A', [reg('moi')]], ['B', [reg('moi', 2)]]]), 'moi', AVANT);
    expect(l[0].state).toBe('registered');
    expect(l[1].state).toBe('waitlisted');
  });

  it('ecarte ce qui n est pas a venir', () => {
    const fini = tournoi('F', '2026-09-10T18:00:00Z', 'TERMINE');
    const live = tournoi('L', '2026-09-11T18:00:00Z', 'EN_COURS');
    expect(homeTournamentList([fini, live], new Map(), 'moi', AVANT)).toEqual([]);
  });

  it('ecarte un tournoi JAMAIS LANCE dont la soiree est passee', () => {
    // Aucune liste ne regardait la date : une soiree morte restait proposee,
    // inscription comprise.
    const passe = tournoi('P', '2026-09-10T18:00:00Z');
    const futur = tournoi('F', '2026-09-17T18:00:00Z');
    const l = homeTournamentList([passe, futur], new Map(), 'moi', new Date('2026-09-12T00:00:00Z'));
    expect(l.map(e => e.tournament.id)).toEqual(['F']);
  });
});

describe('un tournoi jamais lance, et passe — isExpiredUnstarted', () => {
  // 6 rotations de 20 min a partir de 18:00Z : fin prevue a 20:00Z.
  const T = (status: any, o: any = {}) => ({
    status, starts_at: '2026-09-10T18:00:00Z', round_count: 6, round_minutes: 20, ...o,
  });

  it('reste visible EN RETARD sur l heure de debut : on pointe encore', () => {
    // Couper a starts_at ferait disparaitre le tournoi en plein pointage.
    expect(isExpiredUnstarted(T('CHECK_IN'), new Date('2026-09-10T18:25:00Z'))).toBe(false);
    expect(isExpiredUnstarted(T('INSCRIPTIONS_OUVERTES'), new Date('2026-09-10T19:59:00Z'))).toBe(false);
  });

  it('reste visible pendant la DEMI-HEURE qui suit la fin supposee', () => {
    // Demande de l'utilisateur : une soiree lancee en retard deborde d'autant,
    // on ne fait pas disparaitre un tournoi qu'on est peut-etre en train de
    // lancer. Fin supposee 20:00Z, limite 20:30Z incluse.
    expect(isExpiredUnstarted(T('CHECK_IN'), new Date('2026-09-10T20:01:00Z'))).toBe(false);
    expect(isExpiredUnstarted(T('PRET'), new Date('2026-09-10T20:30:00Z'))).toBe(false);
  });

  it('expire une fois passee la fin supposee PLUS une demi-heure', () => {
    for (const s of ['INSCRIPTIONS_OUVERTES', 'COMPLET', 'CHECK_IN', 'PRET']) {
      expect(isExpiredUnstarted(T(s), new Date('2026-09-10T20:31:00Z')), s).toBe(true);
    }
  });

  it('ne touche JAMAIS un tournoi lance, termine, annule ou en brouillon', () => {
    const tard = new Date('2026-09-20T00:00:00Z');
    for (const s of ['EN_COURS', 'TERMINE', 'CLASSEMENT_VALIDE', 'ANNULE', 'BROUILLON']) {
      expect(isExpiredUnstarted(T(s), tard), s).toBe(false);
    }
  });

  it('prend la duree par defaut quand round_minutes manque', () => {
    const t = T('PRET', { round_minutes: null });
    // Fin supposee avec la duree par defaut, PLUS la demi-heure de marge.
    const limite = new Date('2026-09-10T18:00:00Z').getTime()
      + (totalDurationMinutes(6, ROUND_MINUTES) + 30) * 60_000;
    expect(isExpiredUnstarted(t, new Date(limite - 60_000))).toBe(false);
    expect(isExpiredUnstarted(t, new Date(limite + 60_000))).toBe(true);
  });

  it('une date illisible ne fait rien disparaitre', () => {
    expect(isExpiredUnstarted(T('CHECK_IN', { starts_at: 'bof' }), new Date('2030-01-01'))).toBe(false);
  });
});

// ── Filtres de la liste ────────────────────────────────────────────────────
const withLevel = (id: string, iso: string, min: number | null, max: number | null, club: string | null = null) =>
  ({ ...tournoi(id, iso), level_min: min, level_max: max, club_id: club } as Tournament);

describe('filtres de la liste', () => {
  const now = new Date(2026, 8, 9, 12, 0);   // mercredi 9 sept. 2026

  it('« mon niveau » : une borne absente n exclut personne', () => {
    expect(levelAccepted(withLevel('A', '2026-09-11T18:00:00Z', 3, 5), 4)).toBe(true);
    expect(levelAccepted(withLevel('A', '2026-09-11T18:00:00Z', 3, 5), 2)).toBe(false);
    expect(levelAccepted(withLevel('A', '2026-09-11T18:00:00Z', 3, null), 9)).toBe(true);
    expect(levelAccepted(withLevel('A', '2026-09-11T18:00:00Z', null, null), 1)).toBe(true);
    // Niveau inconnu : le filtre ne peut rien affirmer, il ne masque rien.
    expect(levelAccepted(withLevel('A', '2026-09-11T18:00:00Z', 3, 5), null)).toBe(true);
  });

  it('« ce week-end » ne prend que samedi et dimanche qui viennent', () => {
    expect(isThisWeekend(new Date(2026, 8, 12, 19, 0).toISOString(), now)).toBe(true);  // samedi
    expect(isThisWeekend(new Date(2026, 8, 13, 19, 0).toISOString(), now)).toBe(true);  // dimanche
    expect(isThisWeekend(new Date(2026, 8, 11, 19, 0).toISOString(), now)).toBe(false); // vendredi
    expect(isThisWeekend(new Date(2026, 8, 26, 19, 0).toISOString(), now)).toBe(false); // samedi d'apres
  });

  it('les filtres se CUMULENT, et le masque dit le PREMIER qui recale', () => {
    const entries = [
      { tournament: withLevel('OK',    '2026-09-12T18:00:00Z', 3, 5, 'c1') },
      { tournament: withLevel('NIV',   '2026-09-12T18:00:00Z', 6, 8, 'c1') },
      { tournament: withLevel('SEM',   '2026-09-11T18:00:00Z', 3, 5, 'c1') },
      { tournament: withLevel('CLUB',  '2026-09-12T18:00:00Z', 3, 5, 'c2') },
    ];
    const ctx = { myLevel: 4, freeById: new Map(entries.map(e => [e.tournament.id, 8])), now };
    const out = filterTournaments(entries, { level: true, weekend: true, clubId: 'c1', free: false }, ctx);
    expect(out.kept.map(e => e.tournament.id)).toEqual(['OK']);
    expect(out.hidden.map(h => h.reason)).toEqual(['level', 'weekend', 'clubId']);
  });

  it('« places libres » masque ce qui est plein', () => {
    const entries = [
      { tournament: withLevel('LIBRE', '2026-09-12T18:00:00Z', null, null) },
      { tournament: withLevel('PLEIN', '2026-09-12T18:00:00Z', null, null) },
    ];
    const ctx = { myLevel: 4, freeById: new Map([['LIBRE', 4], ['PLEIN', 0]]), now };
    const out = filterTournaments(entries, { ...NO_FILTERS, free: true }, ctx);
    expect(out.kept.map(e => e.tournament.id)).toEqual(['LIBRE']);
    expect(out.hidden[0].reason).toBe('free');
  });

  it('propose de retirer le filtre qui REVELE LE PLUS — jamais un cul-de-sac', () => {
    const entries = [
      { tournament: withLevel('A', '2026-09-12T18:00:00Z', 3, 5, 'c2') },
      { tournament: withLevel('B', '2026-09-12T18:00:00Z', 3, 5, 'c2') },
      { tournament: withLevel('C', '2026-09-12T18:00:00Z', 3, 5, 'c2') },
      { tournament: withLevel('D', '2026-09-11T18:00:00Z', 3, 5, 'c1') },
    ];
    const ctx = { myLevel: 4, freeById: new Map(entries.map(e => [e.tournament.id, 8])), now };
    // Filtre club c1 + week-end : rien ne passe. Retirer « club » revele 3,
    // retirer « week-end » n en revele qu un : c est « club » qu on propose.
    const best = bestFilterToDrop(entries, { level: false, weekend: true, clubId: 'c1', free: false }, ctx);
    expect(best?.key).toBe('clubId');
    expect(best?.unlocked).toBe(3);
  });

  it('ne propose jamais de retirer un filtre INACTIF, ni un retrait sans gain', () => {
    const entries = [{ tournament: withLevel('A', '2026-09-12T18:00:00Z', 3, 5, 'c1') }];
    const ctx = { myLevel: 4, freeById: new Map([['A', 8]]), now };
    expect(bestFilterToDrop(entries, NO_FILTERS, ctx)).toBeNull();
    // Le filtre est actif mais tout passe deja : rien a gagner.
    expect(bestFilterToDrop(entries, { ...NO_FILTERS, level: true }, ctx)).toBeNull();
  });

  it('compte les filtres actifs', () => {
    expect(activeFilterCount(NO_FILTERS)).toBe(0);
    expect(activeFilterCount({ level: true, weekend: true, clubId: 'c1', free: true })).toBe(4);
  });
});

describe('duree d une rotation', () => {
  it('retombe sur le defaut tant que la colonne n existe pas', () => {
    // round_minutes est optionnel : avant que la migration soit appliquee, la
    // colonne est absente et les ecrans doivent afficher la meme chose
    // qu'avant, pas un blanc.
    expect(roundMinutesOf(undefined)).toBe(ROUND_MINUTES);
    expect(roundMinutesOf(null)).toBe(ROUND_MINUTES);
    expect(roundMinutesOf({})).toBe(ROUND_MINUTES);
    expect(roundMinutesOf({ round_minutes: null })).toBe(ROUND_MINUTES);
  });

  it('ignore une valeur aberrante plutot que d afficher « 0 min »', () => {
    expect(roundMinutesOf({ round_minutes: 0 })).toBe(ROUND_MINUTES);
    expect(roundMinutesOf({ round_minutes: -5 })).toBe(ROUND_MINUTES);
  });

  it('respecte la valeur du tournoi', () => {
    expect(roundMinutesOf({ round_minutes: 20 })).toBe(20);
  });

  it('la duree totale est le produit des deux', () => {
    expect(totalDurationMinutes(6, 20)).toBe(120);
    expect(totalDurationMinutes(4, 15)).toBe(60);
  });

  it('un nombre negatif ne produit pas une duree negative', () => {
    expect(totalDurationMinutes(-3, 15)).toBe(0);
    expect(totalDurationMinutes(6, -15)).toBe(0);
  });

  it('le libelle de format porte la duree du tournoi, pas la constante', () => {
    expect(formatLabel(2, 6, 20)).toBe('2 terrains · 6 rotations de 20 min');
    expect(formatLabel(2, 6)).toBe('2 terrains · 6 rotations de 15 min');
  });
});

describe('inscrits groupes par binome', () => {
  const R = (id: string, name: string, elo: number | null, waitlist: number | null = null) => ({
    tournament_id: 't', player_id: id, side: 'BOTH' as any, open_to_join: false,
    waitlist_position: waitlist, check_in_status: 'PENDING' as any,
    registered_at: '2026-09-01T00:00:00Z',
    player: { id, name, elo_score: elo },
  });
  const T = (id: string, p1: string, p2: string, withdrawn = false) =>
    ({ id, tournament_id: 't', player1_id: p1, player2_id: p2, withdrawn });
  const Q = (id: string, from: string, to: string) => ({
    id, tournament_id: 't', from_player: from, to_player: to,
    status: 'pending' as const, created_at: '2026-09-01T00:00:00Z',
  });

  it('reunit les deux joueurs d une equipe', () => {
    const p = groupRegistrations([R('a', 'Alamine', 6.5), R('k', 'Kay2', 6.0)], [T('e1', 'a', 'k')]);
    expect(p).toHaveLength(1);
    expect(p[0].a.name).toBe('Alamine');
    expect(p[0].b?.name).toBe('Kay2');
  });

  it('un joueur SANS equipe reste seul, il ne disparait pas', () => {
    const p = groupRegistrations([R('a', 'Alamine', 6.5)], []);
    expect(p).toHaveLength(1);
    expect(p[0].b).toBe(null);
  });

  it('une equipe RETIREE ne forme plus un binome', () => {
    // Ses membres redeviennent des joueurs seuls : les afficher ensemble
    // laisserait croire a une paire qui ne jouera pas.
    const p = groupRegistrations(
      [R('a', 'Alamine', 6.5), R('k', 'Kay2', 6.0)],
      [T('e1', 'a', 'k', true)],
    );
    expect(p).toHaveLength(2);
    expect(p.every(x => x.b === null)).toBe(true);
  });

  it('une equipe dont un membre n est PLUS INSCRIT n affiche pas de fantome', () => {
    const p = groupRegistrations([R('a', 'Alamine', 6.5)], [T('e1', 'a', 'disparu')]);
    expect(p).toHaveLength(1);
    expect(p[0].b).toBe(null);
    expect(p[0].a.name).toBe('Alamine');
  });

  it('un binome dont UNE MOITIE attend, attend en entier', () => {
    // Le serveur refuse cet etat (waitlist_mismatch) ; par securite on prend
    // le statut le plus defavorable plutot que d annoncer une place acquise.
    const p = groupRegistrations(
      [R('a', 'Alamine', 6.5), R('k', 'Kay2', 6.0, 3)],
      [T('e1', 'a', 'k')],
    );
    expect(p[0].waiting).toBe(true);
  });

  it('ordonne : binomes assis, binomes en file, puis les joueurs seuls', () => {
    // L'ORDRE A CHANGE, et l'ancien ne departageait plus rien : il mettait
    // toute la file en dernier, ce qui marchait tant qu'un joueur seul
    // pouvait etre assis. Depuis la regle du siege-aux-binomes, TOUS les
    // solos attendent — le critere « en file » ne separait plus que des
    // egaux. On lit maintenant qui joue, puis qui en est le plus pres (un
    // binome en file n'attend qu'un siege), puis qui cherche encore.
    const p = groupRegistrations(
      [R('a', 'A', 6), R('b', 'B', 6), R('c', 'C', 6), R('d', 'D', 6, 1), R('e', 'E', 6, 2)],
      [T('e1', 'a', 'b'), T('e2', 'd', 'e')],
    );
    expect(p.map(x => (x.b ? (x.waiting ? 'binome en file' : 'binome assis') : 'seul')))
      .toEqual(['binome assis', 'binome en file', 'seul']);
  });

  it('REUNIT deux joueurs qu une demande lie, dans UNE carte', () => {
    // Ils apparaissaient dans deux cartes separees : « isoles alors qu'ils
    // sont lies ». C'est « qui est avec qui » qu'on cherche dans cette liste.
    const p = groupRegistrations(
      [R('a', 'Admin', 4.2, 1), R('d', 'DevQ', 3.8, 2)],
      [], 'a', [Q('q1', 'a', 'd')],
    );
    expect(p).toHaveLength(1);
    expect(p[0].b).not.toBe(null);
    // Mais PAS comme un binome forme : rien n'a encore ete accepte.
    expect(p[0].tentative).toBe(true);
    expect([p[0].a.id, p[0].b!.id].sort()).toEqual(['a', 'd']);
  });

  it('me met a GAUCHE de ma propre carte', () => {
    // On lit sa propre situation avant celle des autres.
    const p = groupRegistrations(
      [R('a', 'Admin', 4.2, 1), R('d', 'DevQ', 3.8, 2)],
      [], 'd', [Q('q1', 'a', 'd')],
    );
    expect(p[0].a.id).toBe('d');
    expect(p[0].a.mine).toBe(true);
  });

  it('un binome SOUS SABLIER n est pas compte comme binome', () => {
    // Annoncer « 1 binome » sur un appariement que personne n'a accepte
    // ferait croire la place acquise.
    const p = groupRegistrations(
      [R('a', 'Admin', 4.2, 1), R('d', 'DevQ', 3.8, 2)],
      [], 'a', [Q('q1', 'a', 'd')],
    );
    expect(pairsCountLabel(p)).toBe('2 joueurs');
  });

  it('ne fusionne PAS quand un des deux est courtise par plusieurs', () => {
    // Reunir admin avec l'un de ses deux demandeurs designerait un vainqueur
    // que personne n'a choisi.
    const p = groupRegistrations(
      [R('a', 'Admin', 4.2, 1), R('d', 'DevQ', 3.8, 2), R('k', 'Kay', 5.0, 3)],
      [], 'a', [Q('q1', 'd', 'a'), Q('q2', 'k', 'a')],
    );
    expect(p).toHaveLength(3);
    expect(p.every(x => !x.tentative)).toBe(true);
    expect(p.find(x => x.a.id === 'a')!.pending.map(x => x.name)).toEqual(['DevQ', 'Kay']);
  });

  it('accumule PLUSIEURS candidats sur le meme joueur', () => {
    // Deux personnes peuvent demander le meme joueur seul — c'est meme le cas
    // interessant : celui qui recoit doit choisir.
    const p = groupRegistrations(
      [R('a', 'Admin', 4.2, 1), R('d', 'DevQ', 3.8, 2), R('k', 'Kay', 5.0, 3)],
      [], 'a',
      [Q('q1', 'd', 'a'), Q('q2', 'k', 'a')],
    );
    const admin = p.find(x => x.a.id === 'a')!;
    // Tries par nom : sans ordre stable, la carte « saute » d'un chargement a
    // l'autre.
    expect(admin.pending.map(x => x.name)).toEqual(['DevQ', 'Kay']);
  });

  it('ignore une demande deja repondue', () => {
    const p = groupRegistrations(
      [R('a', 'Admin', 4.2, 1), R('d', 'DevQ', 3.8, 2)], [], 'a',
      [{ ...Q('q1', 'a', 'd'), status: 'declined' as const }],
    );
    expect(p.every(x => x.pending.length === 0)).toBe(true);
  });

  it('ignore une demande vers quelqu un qui a DEJA un binome', () => {
    // Promettre un binome impossible est pire que se taire.
    const p = groupRegistrations(
      [R('a', 'Admin', 4.2), R('b', 'Bea', 5.0), R('d', 'DevQ', 3.8, 1)],
      [T('e1', 'a', 'b')], 'd',
      [Q('q1', 'd', 'a')],
    );
    expect(p.find(x => x.a.id === 'd')!.pending).toEqual([]);
    expect(p.find(x => x.key === 'e1')!.pending).toEqual([]);
  });

  it('une demande vers un non-inscrit ne s affiche pas', () => {
    // Depuis tournament_partner_invite.sql, on invite quelqu'un qui n'est pas
    // encore inscrit : il n'a pas de carte, on ne peut rien y accrocher.
    const p = groupRegistrations(
      [R('a', 'Admin', 4.2, 1)], [], 'a', [Q('q1', 'a', 'inconnu')],
    );
    expect(p[0].pending).toEqual([]);
  });

  it('un binome forme n a plus aucune demande en cours affichee', () => {
    const p = groupRegistrations(
      [R('a', 'Admin', 4.2), R('b', 'Bea', 5.0)],
      [T('e1', 'a', 'b')], 'a', [Q('q1', 'a', 'b')],
    );
    expect(p[0].pending).toEqual([]);
  });

  it('un TIERS ne voit aucune demande, et c est voulu', () => {
    // La policy de lecture restreint ces lignes aux deux interesses. On a
    // essaye de compenser par un COMPTE anonyme (« devQ a 1 demande ») :
    // retire le 2026-09-10 apres essai. Sur une soiree ou deux joueurs seuls
    // se sont demandes, les DEUX cartes affichaient « 1 demande » — le compte
    // ne cachait plus rien, et c'est justement le cas frequent en debut
    // d'inscriptions. Un nombre n'est anonyme que noye dans le nombre.
    const p = groupRegistrations(
      [R('a', 'Admin', 4.2, 1), R('d', 'DevQ', 3.8, 2)],
      [], 'tiers', [],
    );
    expect(p.every(x => x.pending.length === 0)).toBe(true);
  });

  it('marque MON inscription', () => {
    const p = groupRegistrations([R('a', 'A', 6), R('k', 'K', 6)], [T('e1', 'a', 'k')], 'k');
    expect(p[0].a.mine).toBe(false);
    expect(p[0].b?.mine).toBe(true);
  });

  it('le compte distingue joueurs et binomes', () => {
    const p = groupRegistrations(
      [R('a', 'A', 6), R('b', 'B', 6), R('c', 'C', 6)],
      [T('e1', 'a', 'b')],
    );
    expect(pairsCountLabel(p)).toBe('3 joueurs · 1 binôme');
  });

  it('sans aucun binome, le compte ne parle que de joueurs', () => {
    expect(pairsCountLabel(groupRegistrations([R('a', 'A', 6)], []))).toBe('1 joueur');
  });
});

describe('choisir un partenaire deja inscrit', () => {
  const ctx = (registered: string[], soloOpen: [string, boolean][] = []) => ({
    registered: new Set(registered),
    soloOpen: new Map(soloOpen),
  });

  it('un joueur NON inscrit recoit une invitation', () => {
    // Depuis tournament_partner_invite.sql, il n'est plus inscrit d'office :
    // une demande part et il decide.
    expect(partnerPath('x', ctx([]))).toBe('direct');
  });

  it('un inscrit resté SEUL et OUVERT forme le binome aussitot', () => {
    // C'est le cas que l'ecran grisait : precisement la personne avec qui on
    // veut jouer.
    expect(partnerPath('x', ctx(['x'], [['x', true]]))).toBe('instant');
  });

  it('un inscrit seul mais SUR ACCORD recoit une demande', () => {
    expect(partnerPath('x', ctx(['x'], [['x', false]]))).toBe('request');
  });

  it('un inscrit DEJA EN BINOME reste hors de portee', () => {
    // Absent de soloOpen = il a deja une equipe.
    expect(partnerPath('x', ctx(['x']))).toBe('blocked');
  });

  it('le bouton annonce ce qu il va faire', () => {
    expect(registerCtaLabel('instant')).toContain('former le binôme');
    expect(registerCtaLabel('request')).toContain('inviter');
    // « Nous inscrire » mentirait : dans les deux cas une demande part.
    expect(registerCtaLabel('direct')).toContain('inviter');
    expect(registerCtaLabel(null)).toBe('S’inscrire');
  });
});

// Ce qui bloque la rotation, du point de vue de l'organisateur (relecture
// finale, 2026-09-24). La règle vivait en ligne dans `admin.tsx` et disait
// « zéro saisie » : elle ratait les deux blocages les plus probables.
describe('blockedCourts — la même règle que le serveur, pas une seconde lecture', () => {
  const MINUTES = 15;
  const T0 = Date.parse('2026-09-24T20:00:00Z');
  const court = (o: Partial<BlockedCourtInput> = {}): BlockedCourtInput => ({
    id: 'm1', courtNo: 3, hasOpponent: true,
    forfeitedTeam: null, confirmedAt: null, gamesA: null,
    startedAt: null, createdAt: '2026-09-24T20:00:00Z',
    teamAEntries: [], teamBEntries: [], ...o,
  });
  // 15 minutes de rotation : à T0 + 20 min, tout seuil est franchi.
  const APRES = T0 + 20 * 60_000;

  it('un repos n’attend aucun score', () => {
    expect(blockedCourtReason(court({ hasOpponent: false }), MINUTES, APRES)).toBe(null);
  });

  it('un match confirmé ou forfaité ne bloque rien', () => {
    expect(blockedCourtReason(court({ confirmedAt: '2026-09-24T20:10:00Z', gamesA: 6 }), MINUTES, APRES))
      .toBe(null);
    expect(blockedCourtReason(court({ forfeitedTeam: 'A', gamesA: 0 }), MINUTES, APRES)).toBe(null);
  });

  it('un score PROVISOIRE (un seul camp) ne bloque rien, même longtemps après', () => {
    // Il compte déjà : le lister ferait relancer des gens qui ont fait leur part.
    expect(blockedCourtReason(
      court({ gamesA: 6, startedAt: '2026-09-24T20:00:00Z', teamAEntries: [entry(6, 3)] }),
      MINUTES, APRES)).toBe(null);
  });

  it('LE DÉSACCORD bloque, tout de suite, sans attendre aucun délai', () => {
    // C'est le seul état qui réclame vraiment l'organisateur, et le seul que
    // l'ancienne règle (« zéro saisie ») ne voyait jamais : il y a DEUX
    // saisies. Deux scores contraires ne s'accordent pas d'eux-mêmes en
    // attendant.
    const litige = court({
      gamesA: 6, startedAt: '2026-09-24T20:00:00Z',
      teamAEntries: [entry(6, 3)], teamBEntries: [entry(3, 6)],
    });
    expect(blockedCourtReason(litige, MINUTES, T0 + 60_000)).toBe('litige');
    expect(blockedCourtReason(litige, MINUTES, APRES)).toBe('litige');
  });

  it('LE CHRONO JAMAIS LANCÉ bloque une fois la durée d’un tour passée', () => {
    // L'ancienne règle ne pouvait PAS le voir : rien à compter depuis
    // `started_at`, qui est nul. Ces quatre joueurs n'ont eu aucune sonnerie
    // locale non plus — personne, nulle part, n'était prévenu.
    const c = court({ startedAt: null, createdAt: '2026-09-24T20:00:00Z' });
    expect(blockedCourtReason(c, MINUTES, T0 + 10 * 60_000)).toBe(null);
    expect(blockedCourtReason(c, MINUTES, APRES)).toBe('sans_chrono');
  });

  it('le terrain MUET (chrono lancé, pas de score) bloque après sa durée', () => {
    const c = court({ startedAt: '2026-09-24T20:05:00Z', createdAt: '2026-09-24T20:00:00Z' });
    // Le temps se compte depuis le DÉPART du chrono, pas depuis le tirage :
    // à 20h19 ce terrain joue encore, alors qu'un compte depuis `createdAt`
    // l'aurait déjà déclaré en retard.
    expect(blockedCourtReason(c, MINUTES, T0 + 19 * 60_000)).toBe(null);
    expect(blockedCourtReason(c, MINUTES, T0 + 25 * 60_000)).toBe('muet');
  });

  it('sans aucun repère de temps, on n’invente pas un blocage', () => {
    expect(blockedCourtReason(court({ startedAt: null, createdAt: null }), MINUTES, APRES)).toBe(null);
  });

  it('la liste ne garde que les bloqués, triés par numéro de terrain', () => {
    const l = blockedCourts([
      court({ id: 'm5', courtNo: 4, confirmedAt: '2026-09-24T20:10:00Z', gamesA: 6 }),
      court({ id: 'm2', courtNo: 3 }),
      court({ id: 'm1', courtNo: 1, startedAt: '2026-09-24T20:00:00Z' }),
    ], MINUTES, APRES);
    expect(l.map(c => [c.courtNo, c.reason])).toEqual([[1, 'muet'], [3, 'sans_chrono']]);
  });

  it('trois motifs, trois phrases — on ne dit pas « pas de score » à un désaccord', () => {
    expect(blockedCourtLabel('litige')).toBe('les deux camps ne disent pas la même chose');
    expect(blockedCourtLabel('sans_chrono')).toBe('chrono jamais lancé, pas de score');
    expect(blockedCourtLabel('muet')).toBe('pas de score');
  });
});

describe('le bareme, tel qu il se lit sur la fiche', () => {
  it('range les rangs par NUMERO, pas par chaine de caracteres', () => {
    // Les cles de `points_scale` sont des chaines JSON. Un tri naif mettrait
    // « 10 » entre « 1 » et « 2 », et la fiche annoncerait un bareme faux.
    const t = { points_scale: { '1': 100, '10': 5, '2': 80 } } as any;
    expect(pointsLadder(t).map(r => r.rank)).toEqual([1, 2, 10]);
  });

  it('retombe sur le bareme par defaut quand la colonne manque', () => {
    // `points_scale` n est pas dans les colonnes lues par la fiche sur les
    // installations anciennes : mieux vaut le bareme du schema que rien.
    expect(pointsLadder({} as any)[0]).toEqual({ rank: 1, points: 100 });
    expect(pointsLadder(null)).toHaveLength(8);
  });

  it('ecarte ce qui n est pas un nombre plutot que de l afficher', () => {
    const t = { points_scale: { '1': 100, '2': 'abc', '3': 65 } } as any;
    expect(pointsLadder(t).map(r => r.rank)).toEqual([1, 3]);
  });
});

describe('la hauteur des barres de « Mon parcours »', () => {
  it('donne la plus haute au MEILLEUR rang, pas au plus grand nombre', () => {
    // Finir 2e est mieux que finir 6e : la barre doit monter quand le rang
    // BAISSE. Prendre le rang tel quel dessinerait la courbe a l'envers.
    const h = rankBarHeights([6, 4, 2, 3]);
    expect(h[2]).toBeGreaterThan(h[1]);   // 2e plus haut que 4e
    expect(h[1]).toBeGreaterThan(h[0]);   // 4e plus haut que 6e
    expect(Math.max(...h)).toBeLessThanOrEqual(1);
    expect(Math.min(...h)).toBeGreaterThan(0);
  });

  it('tient debout avec une seule soiree ou des rangs identiques', () => {
    // Une seule barre n a rien a quoi se comparer : elle occupe sa hauteur
    // pleine plutot que de s ecraser a un huitieme.
    expect(rankBarHeights([3])).toEqual([1]);
    expect(rankBarHeights([5, 5])).toEqual([1, 1]);
    expect(rankBarHeights([])).toEqual([]);
  });
});

describe('l echeance de validation automatique, dite au joueur', () => {
  const NOW = new Date('2026-10-01T20:00:00+01:00');

  it('dit « demain » plutot qu une date que personne ne compte', () => {
    expect(autoValidateLabel('2026-10-02T11:00:00Z', NOW)).toMatch(/demain/i);
  });

  it('dit « aujourd hui » quand c est le jour meme', () => {
    // 20:00Z tombe le 1er au soir en heure locale ; 22:30Z serait deja le 2.
    // La comparaison porte sur le JOUR CIVIL local, pas sur un ecart d heures.
    expect(autoValidateLabel('2026-10-01T20:00:00Z', NOW)).toMatch(/aujourd/i);
  });

  it('passe a la date au-dela de demain', () => {
    const l = autoValidateLabel('2026-10-05T11:00:00Z', NOW);
    expect(l).not.toMatch(/demain|aujourd/i);
    expect(l).toMatch(/5/);
  });

  it('ne dit rien quand il n y a pas d echeance', () => {
    expect(autoValidateLabel(null, NOW)).toBe(null);
  });
});
