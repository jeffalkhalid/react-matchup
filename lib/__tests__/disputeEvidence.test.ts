import { describe, it, expect } from 'vitest';
import {
  parseRawSets, flipSets, counterNeedsFlip, liveNeedsFlip, liveSets,
  buildEvidence, evidenceVerdict, setsToText, reversesWinner, initialSets, campTrust,
  campHistory, historyLabel,
} from '../disputeEvidence';

const S = (a: number, b: number) => ({ a, b });

describe('lecture brute des sets', () => {
  it('accepte les virgules, les espaces et les barres obliques', () => {
    expect(parseRawSets('6-3, 7-5')).toEqual([S(6, 3), S(7, 5)]);
    expect(parseRawSets('6-3 7-5')).toEqual([S(6, 3), S(7, 5)]);
    expect(parseRawSets('6/3,7/5')).toEqual([S(6, 3), S(7, 5)]);
  });

  it('ne normalise PAS : 3-6 reste 3-6', () => {
    // C'est toute la raison d'etre de ce parseur separe. parseSetsLocal de
    // matchView remettrait le vainqueur devant et effacerait le litige.
    expect(parseRawSets('3-6, 4-6')).toEqual([S(3, 6), S(4, 6)]);
  });

  it('ignore ce qui n est pas un set', () => {
    expect(parseRawSets('6-3, abandon, 7-5')).toEqual([S(6, 3), S(7, 5)]);
    expect(parseRawSets('')).toEqual([]);
    expect(parseRawSets(null)).toEqual([]);
  });
});

describe('orientation du score conteste', () => {
  const m = { winner_id: 'W1', winner_id_2: 'W2' };

  it('le contestataire du camp declare vainqueur ecrit deja dans le bon sens', () => {
    expect(counterNeedsFlip({ ...m, counter_by: 'W1' })).toBe(false);
    expect(counterNeedsFlip({ ...m, counter_by: 'W2' })).toBe(false);
  });

  it('le contestataire du camp perdant ecrit a l envers', () => {
    expect(counterNeedsFlip({ ...m, counter_by: 'L1' })).toBe(true);
  });

  it('sans contestataire connu, on ne retourne rien', () => {
    expect(counterNeedsFlip({ ...m, counter_by: null })).toBe(false);
  });

  it('UNE CONTESTATION QUI INVERSE LE RESULTAT reste visible apres orientation', () => {
    // Le perdant declare pretend avoir gagne 6-3 6-4. Il l'ecrit son camp
    // d'abord. Dans le repere commun, cela doit apparaitre comme 3-6 4-6 :
    // l'inverse exact de la version initiale, et non un accord.
    const brut = parseRawSets('6-3, 6-4');
    const oriente = counterNeedsFlip({ ...m, counter_by: 'L1' }) ? flipSets(brut) : brut;
    expect(oriente).toEqual([S(3, 6), S(4, 6)]);
    const rows = buildEvidence(parseRawSets('6-3, 6-4'), oriente, null);
    expect(rows.every(r => r.differs)).toBe(true);
  });
});

describe('orientation du score en direct', () => {
  it('suit le camp ou se trouve le vainqueur declare', () => {
    expect(liveNeedsFlip(['A', 'B'], ['C', 'D'], 'A')).toBe(false);
    expect(liveNeedsFlip(['A', 'B'], ['C', 'D'], 'C')).toBe(true);
  });

  it('vainqueur introuvable ou inconnu : on ne devine pas', () => {
    expect(liveNeedsFlip(['A', 'B'], ['C', 'D'], 'Z')).toBe(null);
    expect(liveNeedsFlip(['A', 'B'], ['C', 'D'], null)).toBe(null);
  });

  it('ecarte la source plutot que de l afficher de travers', () => {
    const state = { sets: [{ t1: 6, t2: 3 }] };
    expect(liveSets(state, ['A'], ['C'], 'Z')).toBe(null);
  });

  it('ramene les sets du direct dans le repere commun', () => {
    const state = { sets: [{ t1: 6, t2: 3 }, { t1: 4, t2: 6 }] };
    expect(liveSets(state, ['A'], ['C'], 'A')).toEqual([S(6, 3), S(4, 6)]);
    expect(liveSets(state, ['A'], ['C'], 'C')).toEqual([S(3, 6), S(6, 4)]);
  });

  it('le set EN COURS a 0-0 n est pas une preuve', () => {
    // A l'abandon, l'etat porte un set entame a 0-0. Le garder ajouterait une
    // ligne « 0-0 » qui contredirait les deux versions sans rien prouver.
    const state = { sets: [{ t1: 6, t2: 3 }, { t1: 0, t2: 0 }] };
    expect(liveSets(state, ['A'], ['C'], 'A')).toEqual([S(6, 3)]);
  });

  it('un direct entierement vide ne compte pas comme source', () => {
    expect(liveSets({ sets: [] }, ['A'], ['C'], 'A')).toBe(null);
    expect(liveSets(null, ['A'], ['C'], 'A')).toBe(null);
  });
});

describe('tableau de comparaison', () => {
  it('marque les sets qui divergent', () => {
    const rows = buildEvidence(parseRawSets('6-3, 7-5'), parseRawSets('6-3, 5-7'), null);
    expect(rows.map(r => r.differs)).toEqual([false, true]);
  });

  it('UN SET PRESENT D UN SEUL COTE ne disparait pas du tableau', () => {
    // Le desaccord « il y a eu un troisieme set » est un desaccord comme un
    // autre : s'aligner sur la plus courte des deux versions l'effacerait.
    const rows = buildEvidence(parseRawSets('6-3, 5-7, 6-2'), parseRawSets('6-3, 5-7'), null);
    expect(rows).toHaveLength(3);
    expect(rows[2].differs).toBe(true);
    expect(rows[2].counter).toBe(null);
  });

  it('dit set par set qui le direct appuie', () => {
    const rows = buildEvidence(
      parseRawSets('6-3, 7-5'),
      parseRawSets('6-3, 5-7'),
      parseRawSets('6-3, 5-7'),
    );
    expect(rows[0].liveBacks).toBe('both');    // les deux versions d accord
    expect(rows[1].liveBacks).toBe('counter');
  });

  it('un set que le direct contredit des deux cotes', () => {
    const rows = buildEvidence(parseRawSets('7-5'), parseRawSets('5-7'), parseRawSets('6-4'));
    expect(rows[0].liveBacks).toBe('neither');
  });
});

describe('conclusion', () => {
  const verdict = (ini: string, con: string, live: string | null) =>
    evidenceVerdict(buildEvidence(
      parseRawSets(ini), parseRawSets(con), live === null ? null : parseRawSets(live),
    ));

  it('sans direct, elle ne tranche pas', () => {
    expect(verdict('6-3, 7-5', '6-3, 5-7', null).supports).toBe('none');
  });

  it('deux versions identiques : le desaccord est ailleurs', () => {
    expect(verdict('6-3, 7-5', '6-3, 7-5', '6-3, 7-5').supports).toBe('none');
  });

  it('confirme la version initiale', () => {
    const v = verdict('6-3, 7-5', '6-3, 5-7', '6-3, 7-5');
    expect(v.supports).toBe('initial');
    expect(v.label).toContain('initiale');
  });

  it('confirme la version contestee', () => {
    expect(verdict('6-3, 7-5', '6-3, 5-7', '6-3, 5-7').supports).toBe('counter');
  });

  it('NE COMPTE PAS les sets sur lesquels tout le monde est d accord', () => {
    // Les deux versions s accordent sur le set 1. Si cet accord comptait, le
    // direct « appuierait les deux » et la conclusion deviendrait floue alors
    // qu il tranche nettement le seul set litigieux.
    const v = verdict('6-3, 7-5', '6-3, 5-7', '6-3, 5-7');
    expect(v.supports).toBe('counter');
  });

  it('un direct qui ne correspond a aucune des deux le dit', () => {
    const v = verdict('7-5', '5-7', '6-4');
    expect(v.supports).toBe('neither');
    expect(v.label).toContain('aucune');
  });

  it('un direct qui tranche un set et en contredit un autre ne tranche pas', () => {
    const v = verdict('6-3, 7-5', '4-6, 5-7', '6-3, 6-4');
    expect(v.supports).toBe('neither');
  });
});

describe('recomposition du texte', () => {
  it('rend le format attendu par le champ de saisie', () => {
    expect(setsToText([S(6, 3), S(7, 5)])).toBe('6-3, 7-5');
    expect(setsToText([])).toBe('');
  });
});

describe('renversement du vainqueur', () => {
  it('repere la version qui change QUI a gagne', () => {
    expect(reversesWinner(parseRawSets('6-3, 6-4'))).toBe(false);
    expect(reversesWinner(parseRawSets('3-6, 4-6'))).toBe(true);
    expect(reversesWinner(parseRawSets('6-3, 4-6, 3-6'))).toBe(true);
  });

  it('une version vide ne renverse rien', () => {
    expect(reversesWinner([])).toBe(false);
  });

  it('un desaccord qui ne touche QUE le detail des jeux ne renverse pas', () => {
    expect(reversesWinner(parseRawSets('6-3, 7-5'))).toBe(false);
    expect(reversesWinner(parseRawSets('6-4, 7-6'))).toBe(false);
  });
});

describe('version initiale dans le repere commun', () => {
  it('remet le vainqueur a gauche meme quand le PERDANT a saisi le score', () => {
    // score_text est stocke tel que saisi : un perdant qui saisit tape son
    // camp d'abord. Sans normalisation, la colonne « Saisi » afficherait
    // 3-6 4-6 pour un match que le camp de gauche a gagne.
    expect(initialSets('3-6, 4-6')).toEqual([S(6, 3), S(6, 4)]);
    expect(initialSets('6-3, 6-4')).toEqual([S(6, 3), S(6, 4)]);
  });

  it('un score vide ne produit aucun set', () => {
    expect(initialSets(null)).toEqual([]);
  });
});

describe('confiance d un camp', () => {
  it('fait la moyenne des joueurs du camp', () => {
    expect(campTrust([{ fiability_pct: 80 }, { fiability_pct: 60 }])).toBe(70);
    expect(campTrust([{ fiability_pct: 55 }])).toBe(55);
  });

  it('ignore les joueurs sans valeur plutot que de les compter pour zero', () => {
    // Un simple qui n'a pas de second joueur, ou un profil neuf : le compter
    // comme 0 ferait passer un camp fiable pour douteux.
    expect(campTrust([{ fiability_pct: 80 }, null])).toBe(80);
    expect(campTrust([{ fiability_pct: 80 }, { fiability_pct: null }])).toBe(80);
  });

  it('rend null quand personne n a de valeur, jamais 0', () => {
    expect(campTrust([null, undefined])).toBe(null);
    expect(campTrust([])).toBe(null);
  });
});

describe('historique d un camp', () => {
  const M = (id: string, by: string | null, joueurs: string[]) => ({
    id, counter_by: by,
    winner_id: joueurs[0] ?? null, winner_id_2: joueurs[1] ?? null,
    loser_id: joueurs[2] ?? null, loser_id_2: joueurs[3] ?? null,
  });

  it('separe AVOIR CONTESTE de AVOIR ETE CONTESTE', () => {
    // Les additionner melangerait celui qui conteste tout et celui que tout
    // le monde conteste : ce ne sont pas les memes joueurs.
    const passe = [
      M('m1', 'A', ['A', 'B', 'X', 'Y']),   // A a conteste
      M('m2', 'Z', ['A', 'B', 'Z', 'W']),   // A s'est fait contester
      M('m3', 'A', ['A', 'B', 'P', 'Q']),   // A a conteste
    ];
    expect(campHistory(passe, ['A', 'B'], 'encours')).toEqual({ contested: 2, wasContested: 1 });
  });

  it('EXCLUT le litige en cours', () => {
    // Sans exclusion, tout litige afficherait « a deja conteste une fois » en
    // parlant de celui qu'on est en train de lire.
    const passe = [M('encours', 'A', ['A', 'B', 'X', 'Y'])];
    expect(campHistory(passe, ['A', 'B'], 'encours')).toEqual({ contested: 0, wasContested: 0 });
  });

  it('ignore les matchs ou le camp n a pas joue', () => {
    const passe = [M('m1', 'X', ['X', 'Y', 'Z', 'W'])];
    expect(campHistory(passe, ['A', 'B'], 'encours')).toEqual({ contested: 0, wasContested: 0 });
  });

  it('ignore les matchs sans contestation', () => {
    const passe = [M('m1', null, ['A', 'B', 'X', 'Y'])];
    expect(campHistory(passe, ['A', 'B'], 'encours')).toEqual({ contested: 0, wasContested: 0 });
  });

  it('un simple (un seul joueur) compte comme son camp', () => {
    const passe = [M('m1', 'A', ['A', null as any, 'X', null as any])];
    expect(campHistory(passe, ['A', null], 'encours')).toEqual({ contested: 1, wasContested: 0 });
  });

  it('le libelle accorde le singulier et se TAIT quand il n y a rien', () => {
    expect(historyLabel({ contested: 0, wasContested: 0 })).toBe('');
    expect(historyLabel({ contested: 1, wasContested: 0 })).toBe('a contesté une fois');
    expect(historyLabel({ contested: 2, wasContested: 1 })).toBe('a contesté 2 fois · contesté une fois');
  });
});
