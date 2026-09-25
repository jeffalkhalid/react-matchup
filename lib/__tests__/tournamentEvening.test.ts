import { describe, it, expect, vi } from 'vitest';

// lib/tournaments charge le client Supabase, qui exige les variables
// d'environnement. Les fonctions testees ici sont PURES.
vi.mock('../supabase', () => ({ supabase: {} }));

import {
  courtState, eveningCourts, myCourt, blockingLabel, blocks, needsHuman, courtsDone,
  roundLabel, secondsLeft, formatCountdown, shouldTickClock, shouldSyncAlarms,
  tournamentEveningIsLive, courtTone, bumpGames, courtRowLabel, courtProgress, endsAt, courtMovement,
  type CourtState, type CourtView,
} from '../tournamentEvening';

const M = (o: any = {}) => ({
  id: 'm1', tournament_id: 't', round_no: 2, court_no: 3,
  team_a: 'A', team_b: 'B', games_a: null, games_b: null,
  forfeited_team: null, confirmed_at: null, started_at: null, ...o,
});
const T = (id: string, p1: string, p2: string) =>
  ({ id, tournament_id: 't', player1_id: p1, player2_id: p2, withdrawn: false });
const E = (matchId: string, player: string, a: number, b: number) => ({
  id: `${matchId}-${player}`, tournament_id: 't', match_id: matchId,
  player_id: player, games_a: a, games_b: b, entered_at: '2026-09-11T20:20:00Z',
});

// Le chrono n'entre pas en jeu dans les tests qui suivent (sauf le dernier
// describe, qui le teste explicitement) : round/now arbitraires, sans effet
// puisque ces matchs se resolvent avant meme d'atteindre la branche chrono.
const RM = 15;
const N = 0;

const EQUIPES = [T('A', 'mina', 'alamine'), T('B', 'admin', 'devq')];

describe('l etat d un terrain', () => {
  it('A DEMARRER quand personne n a lance le chrono — et ca bloque', () => {
    expect(courtState(M(), [], [], RM, N)).toBe('a_demarrer');
    expect(blocks('a_demarrer')).toBe(true);
  });

  it('PROVISOIRE quand un seul camp a saisi — et ca ne bloque PAS', () => {
    // La distinction que `matchLiveStatus` ne fait pas : il rend « awaiting »
    // dans les deux cas. Les confondre ferait afficher « en attente » sur un
    // terrain qui n'empeche rien, et paniquer a chaque rotation.
    const m = M({ games_a: 6, games_b: 4 });
    expect(courtState(m, [E('m1', 'mina', 6, 4)], [], RM, N)).toBe('provisoire');
    expect(blocks('provisoire')).toBe(false);
  });

  it('ACQUIS quand les deux camps concordent', () => {
    const m = M({ games_a: 6, games_b: 4, confirmed_at: '2026-09-11T20:21:00Z' });
    expect(courtState(m, [E('m1', 'mina', 6, 4)], [E('m1', 'admin', 6, 4)], RM, N)).toBe('acquis');
  });

  it('LITIGE quand ils se contredisent — et ca bloque', () => {
    // Dans une montante le score decide OU L'ON VA : un camp lese descend,
    // l'autre monte, et la rotation suivante se joue contre les mauvais
    // adversaires. Ca ne se rattrape pas apres coup.
    const m = M({ games_a: 6, games_b: 4 });
    expect(courtState(m, [E('m1', 'mina', 6, 4)], [E('m1', 'admin', 4, 6)], RM, N)).toBe('litige');
    expect(blocks('litige')).toBe(true);
  });

  it('EXEMPT sans adversaire, FORFAIT quand un camp a declare', () => {
    expect(courtState(M({ team_b: null }), [], [], RM, N)).toBe('exempt');
    expect(courtState(M({ forfeited_team: 'B' }), [], [], RM, N)).toBe('forfait');
  });
});

describe('les terrains de la rotation', () => {
  const matches = [
    M({ id: 'm1', court_no: 3, team_a: 'A', team_b: 'B' }),
    M({ id: 'm2', court_no: 1, team_a: 'C', team_b: 'D', games_a: 6, games_b: 2,
        confirmed_at: '2026-09-11T20:21:00Z' }),
    M({ id: 'm3', court_no: 2, team_a: 'E', team_b: 'F' }),
    M({ id: 'm9', court_no: 9, round_no: 1, team_a: 'A', team_b: 'B' }),
  ];
  const teams = [...EQUIPES, T('C', 'c1', 'c2'), T('D', 'd1', 'd2'),
    T('E', 'e1', 'e2'), T('F', 'f1', 'f2')];

  it('ne garde que la rotation EN COURS', () => {
    const c = eveningCourts(matches, teams, [], 'mina', 2, RM, N);
    expect(c.map(x => x.courtNo)).toEqual([1, 2, 3]);
  });

  it('trie par NUMERO de terrain, pas par etat', () => {
    // C'est l'ordre du gymnase, le seul que tout le monde partage. Trier par
    // etat ferait sauter les cartes d'une rotation a l'autre alors qu'on
    // cherche « le terrain 5 » avec les yeux.
    const c = eveningCourts(matches, teams, [], 'mina', 2, RM, N);
    expect(c.map(x => x.courtNo)).toEqual([1, 2, 3]);
  });

  it('marque MON terrain, et lui seul', () => {
    const c = eveningCourts(matches, teams, [], 'mina', 2, RM, N);
    expect(c.filter(x => x.mine).map(x => x.courtNo)).toEqual([3]);
    expect(myCourt(c)?.courtNo).toBe(3);
  });

  it('me trouve aussi quand je suis dans le camp B', () => {
    const c = eveningCourts(matches, teams, [], 'devq', 2, RM, N);
    expect(myCourt(c)?.courtNo).toBe(3);
  });

  it('rend null quand je ne joue pas cette rotation', () => {
    expect(myCourt(eveningCourts(matches, teams, [], 'inconnu', 2, RM, N))).toBe(null);
  });

  it('range les saisies du bon cote', () => {
    // Une saisie rangee du mauvais cote ferait passer un accord pour un
    // litige : `matchLiveStatus` compare les camps OPPOSES.
    const e = [E('m1', 'mina', 6, 4), E('m1', 'admin', 6, 4)];
    const m = matches.map(x => x.id === 'm1'
      ? M({ ...x, games_a: 6, games_b: 4, confirmed_at: 'x' }) : x);
    const c = eveningCourts(m, teams, e, 'mina', 2, RM, N);
    expect(c.find(x => x.courtNo === 3)!.state).toBe('acquis');
  });
});

describe('ce qui bloque, dit a tout le monde', () => {
  const vue = (courtNo: number, state: any) =>
    ({ matchId: `m${courtNo}`, courtNo, state, mine: false, gamesA: null, gamesB: null,
       secondsLeft: null });

  it('ne dit rien quand rien ne bloque', () => {
    expect(blockingLabel([vue(1, 'acquis'), vue(2, 'provisoire')])).toBe(null);
  });

  it('distingue les trois manques sans score, et le desaccord', () => {
    // Trois manques differents, trois gestes differents : aller chercher
    // quatre joueurs, attendre la fin du chrono, ou demander a deux camps de
    // se mettre d'accord.
    const txt = blockingLabel([
      vue(5, 'a_demarrer'), vue(6, 'en_cours'), vue(9, 'temps_ecoule'), vue(8, 'litige'),
    ])!;
    expect(txt).toContain('Terrain 5 : pas encore commencé');
    expect(txt).toContain('Terrain 6 : en cours');
    expect(txt).toContain('Terrain 9 : temps écoulé — score attendu');
    expect(txt).toContain('Terrain 8 : les deux camps ne disent pas la même chose');
  });

  it('groupe les terrains de meme manque', () => {
    expect(blockingLabel([vue(5, 'a_demarrer'), vue(7, 'a_demarrer')]))
      .toBe('Terrains 5, 7 : pas encore commencé');
  });
});

describe('la jauge de la soiree', () => {
  const vue = (courtNo: number, state: any) =>
    ({ matchId: `m${courtNo}`, courtNo, state, mine: false, gamesA: null, gamesB: null,
       secondsLeft: null });

  it('compte un terrain PROVISOIRE comme fini', () => {
    // Son score est effectif, il n'empeche rien. Ne compter que les acquis
    // afficherait un retard qui n'existe pas et pousserait a relancer des
    // gens qui ont deja fait leur part.
    expect(courtsDone([vue(1, 'acquis'), vue(2, 'provisoire'), vue(3, 'a_demarrer')]))
      .toEqual({ done: 2, total: 3 });
  });

  it('ne compte pas les exempts dans le total', () => {
    expect(courtsDone([vue(1, 'acquis'), vue(2, 'exempt')]))
      .toEqual({ done: 1, total: 1 });
  });

  it('un forfait est fini, il n attend rien', () => {
    expect(courtsDone([vue(1, 'forfait')])).toEqual({ done: 1, total: 1 });
  });
});

describe('le libelle de rotation', () => {
  it('se lit sans calcul', () => {
    expect(roundLabel(2, 6)).toBe('Rotation 2 sur 6');
  });
});

describe('le chrono d un terrain', () => {
  const DEBUT = '2026-09-24T20:00:00.000Z';
  const t = (iso: string) => new Date(iso).getTime();

  it('rend le temps restant en secondes', () => {
    expect(secondsLeft(DEBUT, 15, t('2026-09-24T20:05:00.000Z'))).toBe(600);
  });

  it('rend un nombre negatif quand le temps est depasse', () => {
    expect(secondsLeft(DEBUT, 15, t('2026-09-24T20:17:00.000Z'))).toBe(-120);
  });

  it('rend null tant que le terrain n a pas demarre', () => {
    expect(secondsLeft(null, 15, t(DEBUT))).toBeNull();
  });

  it('dit « a demarrer » tant que personne n a lance le chrono', () => {
    const c = eveningCourts([M({ started_at: null })], EQUIPES, [], 'mina', 2, 15, t(DEBUT));
    expect(c[0].state).toBe('a_demarrer');
  });

  it('dit « en cours » pendant les quinze minutes', () => {
    const c = eveningCourts([M({ started_at: DEBUT })], EQUIPES, [], 'mina', 2, 15,
      t('2026-09-24T20:05:00.000Z'));
    expect(c[0].state).toBe('en_cours');
  });

  it('dit « temps ecoule » apres la fin, tant qu aucun score n est saisi', () => {
    const c = eveningCourts([M({ started_at: DEBUT })], EQUIPES, [], 'mina', 2, 15,
      t('2026-09-24T20:16:00.000Z'));
    expect(c[0].state).toBe('temps_ecoule');
  });

  it('un score saisi l emporte sur le chrono', () => {
    const c = eveningCourts([M({ started_at: DEBUT, games_a: 6, games_b: 3 })], EQUIPES,
      [E('m1', 'mina', 6, 3)], 'mina', 2, 15, t('2026-09-24T20:05:00.000Z'));
    expect(c[0].state).toBe('provisoire');
  });

  it('les trois etats sans score bloquent la rotation suivante', () => {
    expect(blocks('a_demarrer')).toBe(true);
    expect(blocks('en_cours')).toBe(true);
    expect(blocks('temps_ecoule')).toBe(true);
    expect(blocks('provisoire')).toBe(false);
  });
});

describe('le compte a rebours affiche', () => {
  it('formate en mm:ss', () => {
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(59)).toBe('00:59');
    expect(formatCountdown(60)).toBe('01:00');
    expect(formatCountdown(605)).toBe('10:05');
  });

  it('n affiche jamais un temps negatif — au-dela de zero c est temps_ecoule qui parle', () => {
    expect(formatCountdown(-45)).toBe('00:00');
  });

  it('arrondit', () => {
    expect(formatCountdown(59.6)).toBe('01:00');
  });
});

describe('faut-il faire tourner l horloge', () => {
  const vue = (courtNo: number, state: any) =>
    ({ matchId: `m${courtNo}`, courtNo, state, mine: false, gamesA: null, gamesB: null,
       secondsLeft: null });

  it('oui, des qu un terrain decompte', () => {
    expect(shouldTickClock([vue(1, 'a_demarrer'), vue(2, 'en_cours')])).toBe(true);
  });

  it('non, un ecran de terrains finis ou pas encore lances n a rien a redessiner chaque seconde', () => {
    expect(shouldTickClock([vue(1, 'acquis'), vue(2, 'a_demarrer'), vue(3, 'temps_ecoule')]))
      .toBe(false);
  });

  it('non, aucun terrain', () => {
    expect(shouldTickClock([])).toBe(false);
  });
});

describe('faut-il laisser l effet des sonneries agir', () => {
  const PRET = { alarmesPretes: true, loading: false, hasTournament: true, hasPlayer: true };

  it('faux au montage frais : la memoire restauree ne doit pas encore etre touchee', () => {
    // Le cas precis du bug corrige : alarmesPretes est deja vrai (stockage +
    // porte, tout en local) mais les donnees du tournoi n ont pas fini
    // d arriver par le reseau — courts est vide, mien est null, et ca
    // ressemble a « je ne joue pas », a tort.
    expect(shouldSyncAlarms({ ...PRET, loading: true, hasTournament: false, hasPlayer: false }))
      .toBe(false);
  });

  it('faux tant que la porte/memoire des alarmes n est pas prete, meme donnees chargees', () => {
    expect(shouldSyncAlarms({ ...PRET, alarmesPretes: false })).toBe(false);
  });

  it('faux si le tournoi n est pas charge', () => {
    expect(shouldSyncAlarms({ ...PRET, hasTournament: false })).toBe(false);
  });

  it('faux si le joueur n est pas charge', () => {
    expect(shouldSyncAlarms({ ...PRET, hasPlayer: false })).toBe(false);
  });

  it('faux tant que le chargement n est pas termine, meme si tournoi et joueur sont deja la', () => {
    // Chargement en cours mais anciennes valeurs de t/player encore en etat :
    // le doute profite a « ne rien toucher ».
    expect(shouldSyncAlarms({ ...PRET, loading: true })).toBe(false);
  });

  it('vrai seulement quand tout est reuni', () => {
    expect(shouldSyncAlarms(PRET)).toBe(true);
  });
});

// Relecture finale (2026-09-24) : l'alarme rouge doit vouloir dire quelque
// chose. `blocks` reste le prédicat d'AVANCEMENT du moteur — d'autres lecteurs
// en dépendent — et `needsHuman` devient celui de l'alarme.
describe('needsHuman — l alarme rouge ne veut dire qu une chose', () => {
  it('un terrain tout juste tiré ou en train de jouer n appelle personne', () => {
    // C'est le déroulement NORMAL d'une rotation. Le peindre en rouge, c'est
    // crier pendant l'essentiel de chaque quart d'heure sur seize téléphones,
    // et l'alarme finit par vouloir dire « ils jouent ».
    expect(needsHuman('a_demarrer')).toBe(false);
    expect(needsHuman('en_cours')).toBe(false);
  });

  it('mais tous les deux BLOQUENT bien l avancement — les deux questions restent distinctes', () => {
    expect(blocks('a_demarrer')).toBe(true);
    expect(blocks('en_cours')).toBe(true);
  });

  it('le temps écoulé sans score et le désaccord, eux, réclament quelqu un', () => {
    expect(needsHuman('temps_ecoule')).toBe(true);
    expect(needsHuman('litige')).toBe(true);
  });

  it('rien à faire sur un score déjà là, un forfait ou un repos', () => {
    expect(needsHuman('provisoire')).toBe(false);
    expect(needsHuman('acquis')).toBe(false);
    expect(needsHuman('forfait')).toBe(false);
    expect(needsHuman('exempt')).toBe(false);
  });
});

describe('le routage d un push de tournoi', () => {
  it('une rotation tirée et un abandon arrivent PENDANT la soirée', () => {
    // La spec §6 dit « le Mode soirée si la soirée tourne » : un abandon
    // arrive lui aussi en pleine rotation, et renvoyer son destinataire sur
    // la fiche l oblige à retrouver le Mode soirée à la main.
    expect(tournamentEveningIsLive('round')).toBe(true);
    expect(tournamentEveningIsLive('forfeit')).toBe(true);
  });

  it('un classement validé arrive APRÈS : plus de terrain à rejoindre', () => {
    expect(tournamentEveningIsLive('validated')).toBe(false);
  });

  it('un kind inconnu ou absent ne mène pas au Mode soirée', () => {
    expect(tournamentEveningIsLive('silent')).toBe(false);
    expect(tournamentEveningIsLive(undefined)).toBe(false);
    expect(tournamentEveningIsLive(null)).toBe(false);
  });
});

describe('un repos n est pas « mon terrain »', () => {
  it('le binôme exempté ne voit pas TON TERRAIN, mais la carte de repos', () => {
    // Le bye porte le binôme côté A, sans adversaire. Marqué `mine`, l écran
    // affichait un VS avec un côté vide et une saisie que le serveur refuse
    // (`bye_match`). Arrive dès que le nombre de binômes est impair.
    const bye = M({ id: 'bye', court_no: 4, team_a: 'A', team_b: null });
    const c = eveningCourts([bye], EQUIPES, [], 'mina', 2, RM, N);
    expect(c[0].state).toBe('exempt');
    expect(c[0].mine).toBe(false);
    expect(myCourt(c)).toBe(null);
  });

  it('un vrai match du même binôme reste bien le mien', () => {
    const c = eveningCourts([M()], EQUIPES, [], 'mina', 2, RM, N);
    expect(c[0].mine).toBe(true);
  });
});

describe('le ton d un terrain', () => {
  const TOUS: CourtState[] = [
    'a_demarrer', 'en_cours', 'temps_ecoule', 'provisoire',
    'litige', 'acquis', 'forfait', 'exempt',
  ];

  it('l alerte suit EXACTEMENT needsHuman, pour les huit etats', () => {
    // Le lien est teste plutot que recopie : deux tables de correspondance
    // separees auraient derive au premier etat ajoute, et c est precisement
    // cette derive qui a mis quatre etats sur huit en rouge.
    for (const s of TOUS) {
      expect(courtTone(s) === 'alert').toBe(needsHuman(s));
    }
  });

  it('jouer n est pas une alerte : un terrain tire ou en jeu n est jamais rouge', () => {
    expect(courtTone('a_demarrer')).toBe('neutral');
    expect(courtTone('en_cours')).toBe('live');
  });

  it('un score provisoire se distingue d un acquis, et le repos reste neutre', () => {
    expect(courtTone('provisoire')).toBe('provisional');
    expect(courtTone('acquis')).toBe('done');
    expect(courtTone('forfait')).toBe('neutral');
    expect(courtTone('exempt')).toBe('neutral');
  });
});

describe('le pas d un compteur de jeux', () => {
  it('part de rien, et ne descend jamais sous zero', () => {
    // Rien de saisi, l ecran affiche « — » : le premier « + » doit donner 1,
    // pas 0 — sinon il faut deux appuis pour annoncer un jeu.
    expect(bumpGames('', 1)).toBe('1');
    expect(bumpGames('', -1)).toBe('0');
    expect(bumpGames('0', -1)).toBe('0');
    expect(bumpGames('6', -1)).toBe('5');
  });

  it('ne depasse pas deux chiffres', () => {
    // Le plafond du champ de saisie qu il remplace, conserve tel quel.
    expect(bumpGames('99', 1)).toBe('99');
    expect(bumpGames('9', 1)).toBe('10');
  });
});

describe('ce qui se lit a droite d une ligne de l echelle', () => {
  const C = (o: Partial<CourtView>): CourtView => ({
    matchId: 'm', courtNo: 1, state: 'a_demarrer', mine: false,
    gamesA: null, gamesB: null, secondsLeft: null, ...o,
  });

  it('dit l etat en toutes lettres, et le score des qu il y en a un', () => {
    expect(courtRowLabel(C({ state: 'a_demarrer' }))).toBe('À démarrer');
    expect(courtRowLabel(C({ state: 'en_cours', secondsLeft: 402 }))).toBe('En jeu · 06:42');
    expect(courtRowLabel(C({ state: 'temps_ecoule' }))).toBe('Temps écoulé');
    expect(courtRowLabel(C({ state: 'provisoire', gamesA: 6, gamesB: 3 }))).toBe('6 – 3 · saisi');
    expect(courtRowLabel(C({ state: 'litige' }))).toBe('Litige');
    expect(courtRowLabel(C({ state: 'acquis', gamesA: 6, gamesB: 4 }))).toBe('6 – 4 ✓');
    expect(courtRowLabel(C({ state: 'forfait' }))).toBe('Forfait');
    expect(courtRowLabel(C({ state: 'exempt' }))).toBe('Exempté');
  });

  it('ne casse pas quand le chrono ou le score manque', () => {
    // `secondsLeft` est nul tant que personne n a lance le chrono ; une ligne
    // amputee vaut mieux qu un « En jeu · NaN:NaN ».
    expect(courtRowLabel(C({ state: 'en_cours', secondsLeft: null }))).toBe('En jeu');
    expect(courtRowLabel(C({ state: 'acquis', gamesA: null, gamesB: null }))).toBe('Acquis');
  });
});

describe('la barre d avancement d un terrain', () => {
  it('va de 0 au depart a 1 a la fin du chrono', () => {
    expect(courtProgress(900, 15)).toBe(0);      // rien de joue
    expect(courtProgress(450, 15)).toBe(0.5);    // moitie
    expect(courtProgress(0, 15)).toBe(1);        // chrono fini
  });

  it('reste dans ses bornes quand la donnee est absente ou aberrante', () => {
    // Chrono jamais lance : pas de barre du tout, pas une barre pleine.
    expect(courtProgress(null, 15)).toBe(0);
    // Le serveur peut rendre un reste superieur a la duree (duree raccourcie
    // apres coup) ou negatif (horloges desaccordees).
    expect(courtProgress(1200, 15)).toBe(0);
    expect(courtProgress(-60, 15)).toBe(1);
    expect(courtProgress(300, 0)).toBe(0);
  });
});

describe('l heure a laquelle le chrono d un terrain tombe a zero', () => {
  it('ajoute la duree de la rotation au depart du chrono', () => {
    const fin = endsAt('2026-09-25T19:14:00.000Z', 15);
    expect(fin?.toISOString()).toBe('2026-09-25T19:29:00.000Z');
  });

  it('rend null quand il n y a rien a annoncer', () => {
    // Chrono jamais lance : annoncer une heure de fin serait une invention.
    expect(endsAt(null, 15)).toBe(null);
    expect(endsAt('pas une date', 15)).toBe(null);
  });
});

describe('ce que la rotation precedente a change pour moi', () => {
  it('lit la montee et la descente dans le SENS de l echelle', () => {
    // Le Terrain 1 est le plus fort : monter, c est voir son numero BAISSER.
    // Le sens inverse est l erreur naturelle, et elle annoncerait a chacun
    // l exact contraire de ce qu il vient de faire.
    expect(courtMovement(3, 2)).toBe('monte');
    expect(courtMovement(2, 3)).toBe('descend');
    expect(courtMovement(2, 2)).toBe('reste');
  });

  it('n annonce rien quand il n y a pas de rotation precedente', () => {
    expect(courtMovement(null, 1)).toBe(null);
  });
});
