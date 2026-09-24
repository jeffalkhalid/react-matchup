// Un vote doit finir par recevoir une réponse.
//
// Avant, la carte disparaissait au coup d'envoi : les lignes de `predictions`
// étaient écrites et plus jamais relues. Ces tests gardent la boucle fermée —
// et surtout les deux endroits où un verdict pourrait MENTIR : quand la
// composition a changé, et quand le score n'est pas encore validé.
import { describe, it, expect, vi } from 'vitest';
// Ce fichier lit `matches` en bas ; les tests ne parlent qu'au haut, qui est pur.
vi.mock('../supabase', () => ({ supabase: {} }));
import {
  clashWindow, clashPhase, winnerTeam, myVerdict, crowdShare, oddsOutcomeLine,
  clashRank, orderRail, scoreLabel, pairLabel,
  RESULT_DAYS, EN_COURS_HEURES,
  type ClashPhase,
} from '../clashResult';
import { PREDICTION_DAYS, type ClashPlayer, type PredictionCounts } from '../weekendClash';

const now = new Date(2026, 8, 20, 10, 0, 0); // dimanche 20 septembre 2026, 10 h

const joueur = (id: string, team: 'A' | 'B', name = id): ClashPlayer => ({
  id, name, avatarPath: null, memberNumber: null, elo: 1500, team,
});

const paires = {
  teamA: [joueur('a1', 'A', 'Galan Martinez'), joueur('a2', 'A', 'mounir')],
  teamB: [joueur('b1', 'B', 'Alamine'), joueur('b2', 'B', 'merry')],
};

const avis = (A: number, B: number): PredictionCounts => ({ A, B, total: A + B });

describe('la fenêtre du rail', () => {
  it('va de RESULT_DAYS en arrière à PREDICTION_DAYS en avant', () => {
    const { start, end } = clashWindow(now);
    const jours = (d: Date) => Math.round((d.getTime() - now.getTime()) / 86_400_000);
    expect(jours(start)).toBe(-RESULT_DAYS);
    expect(jours(end)).toBe(PREDICTION_DAYS);
  });
});

describe("l'âge d'une carte", () => {
  const resultat = { winnerIds: ['a1', 'a2'], scoreText: '6-4 6-2' };

  it('un score validé termine la carte, même vieille', () => {
    const vieux = new Date(2026, 0, 1).toISOString();
    expect(clashPhase(vieux, resultat, now)).toBe('termine');
  });

  it('avant le coup d envoi, elle est à venir', () => {
    const demain = new Date(2026, 8, 21, 10, 0, 0).toISOString();
    expect(clashPhase(demain, null, now)).toBe('a_venir');
  });

  it('après le coup d envoi et sans score, elle est en cours', () => {
    const ilYAUneHeure = new Date(2026, 8, 20, 9, 0, 0).toISOString();
    expect(clashPhase(ilYAUneHeure, null, now)).toBe('en_cours');
  });

  it('sort du rail quand aucun score n est jamais arrivé', () => {
    // Sans cette borne, un match sans score resterait « en cours » pour
    // toujours et occuperait une place que personne ne peut libérer.
    const avantHier = new Date(now.getTime() - (EN_COURS_HEURES + 1) * 3_600_000).toISOString();
    expect(clashPhase(avantHier, null, now)).toBeNull();
  });

  it('une date illisible ne rend rien', () => {
    expect(clashPhase('pas une date', null, now)).toBeNull();
  });
});

describe('le camp vainqueur', () => {
  it('se lit des deux côtés', () => {
    expect(winnerTeam(paires, ['a1', 'a2'])).toBe('A');
    expect(winnerTeam(paires, ['b1', 'b2'])).toBe('B');
  });

  it('accepte un seul vainqueur connu', () => {
    expect(winnerTeam(paires, ['b2'])).toBe('B');
  });

  it("se tait quand la composition a changé", () => {
    // Le bouton « Changé de partenaire ? » : la partie jouée n'est plus celle
    // qui a été pronostiquée. Trancher ici rendrait un verdict FAUX.
    expect(winnerTeam(paires, ['a1', 'b2'])).toBeNull();
  });

  it('se tait quand aucun vainqueur ne joue cette partie', () => {
    expect(winnerTeam(paires, ['inconnu'])).toBeNull();
    expect(winnerTeam(paires, [])).toBeNull();
  });
});

describe('mon verdict', () => {
  it('juste quand j avais choisi les vainqueurs', () => {
    expect(myVerdict('A', 'A')).toBe('juste');
  });

  it('raté quand j avais choisi les autres', () => {
    expect(myVerdict('B', 'A')).toBe('rate');
  });

  it('sans prono quand je n avais pas voté', () => {
    expect(myVerdict(null, 'A')).toBe('sans_prono');
    expect(myVerdict(undefined, 'A')).toBe('sans_prono');
  });

  it("indécidable quand le vainqueur n'est pas identifiable", () => {
    expect(myVerdict('A', null)).toBe('indecidable');
  });

  it("l'absence de prono passe AVANT l'indécidable", () => {
    // Dire « la composition a changé » à quelqu'un qui n'avait rien
    // pronostiqué, c'est lui répondre à une question qu'il n'a pas posée.
    expect(myVerdict(null, null)).toBe('sans_prono');
  });
});

describe('la part des PAGUISTES', () => {
  it('compte ceux qui avaient choisi les vainqueurs', () => {
    expect(crowdShare(avis(35, 65), 'B')).toBe(65);
    expect(crowdShare(avis(35, 65), 'A')).toBe(35);
  });

  it('ne rend rien sans vainqueur ni sans avis', () => {
    expect(crowdShare(avis(3, 5), null)).toBeNull();
    expect(crowdShare(avis(0, 0), 'A')).toBeNull();
  });
});

describe('ce qu ILS avaient vu, sur mon match', () => {
  it('ils me voyaient perdre et j ai gagné', () => {
    expect(oddsOutcomeLine(avis(2, 8), 'A', 'A')).toBe('Tu leur as donné tort.');
  });

  it('ils me voyaient perdre et j ai perdu', () => {
    expect(oddsOutcomeLine(avis(2, 8), 'A', 'B')).toBe('Ils avaient vu juste.');
  });

  it('ils me voyaient gagner et j ai gagné', () => {
    expect(oddsOutcomeLine(avis(8, 2), 'A', 'A')).toBe("Confirmé. Ils t'avaient vu gagner.");
  });

  it('ils me voyaient gagner et j ai perdu', () => {
    expect(oddsOutcomeLine(avis(8, 2), 'A', 'B')).toBe("Pas cette fois. Ils t'avaient vu gagner.");
  });

  it("ils n'arrivaient pas à trancher", () => {
    expect(oddsOutcomeLine(avis(5, 5), 'A', 'A')).toBe("Ils n'arrivaient pas à trancher. Tu as tranché.");
    expect(oddsOutcomeLine(avis(5, 5), 'A', 'B')).toBe("Ils n'arrivaient pas à trancher.");
  });

  it('on parle d EUX, jamais « du club »', () => {
    // Même voix qu'avant le match (`oddsLine`). La carte ne doit pas changer
    // de bouche entre la question et la réponse.
    const toutes = [
      oddsOutcomeLine(avis(2, 8), 'A', 'A'), oddsOutcomeLine(avis(2, 8), 'A', 'B'),
      oddsOutcomeLine(avis(8, 2), 'A', 'A'), oddsOutcomeLine(avis(8, 2), 'A', 'B'),
      oddsOutcomeLine(avis(5, 5), 'A', 'A'),
    ].join(' ');
    expect(toutes).not.toMatch(/club/i);
  });

  it('se tait sans camp, sans vainqueur ou sans avis', () => {
    expect(oddsOutcomeLine(avis(5, 3), null, 'A')).toBeNull();
    expect(oddsOutcomeLine(avis(5, 3), 'A', null)).toBeNull();
    expect(oddsOutcomeLine(avis(0, 0), 'A', 'A')).toBeNull();
  });
});

describe("l'ordre du rail : ce que chaque carte me doit", () => {
  it('range la récompense devant, la nouvelle derrière', () => {
    expect(clashRank('termine', 'A')).toBeLessThan(clashRank('a_venir', null));
    expect(clashRank('a_venir', null)).toBeLessThan(clashRank('en_cours', null));
    expect(clashRank('en_cours', null)).toBeLessThan(clashRank('termine', null));
  });

  const carte = (nom: string, phase: ClashPhase, matchDate: string, mien: 'A' | 'B' | null = null) =>
    ({ nom, phase, matchDate, mien });

  it('ordonne un rail complet', () => {
    const rail = [
      carte('nouvelle', 'termine', '2026-09-19T10:00:00Z'),
      carte('a-voter-loin', 'a_venir', '2026-09-25T10:00:00Z'),
      carte('en-cours', 'en_cours', '2026-09-20T09:00:00Z'),
      carte('ma-recompense', 'termine', '2026-09-18T10:00:00Z', 'A'),
      carte('a-voter-proche', 'a_venir', '2026-09-21T10:00:00Z'),
    ];
    expect(orderRail(rail).map(x => x.nom)).toEqual([
      'ma-recompense', 'a-voter-proche', 'a-voter-loin', 'en-cours', 'nouvelle',
    ]);
  });

  it('à venir : le plus proche d abord ; joué : le plus récent d abord', () => {
    const aVenir = orderRail([
      carte('loin', 'a_venir', '2026-09-30T10:00:00Z'),
      carte('proche', 'a_venir', '2026-09-21T10:00:00Z'),
    ]);
    expect(aVenir.map(x => x.nom)).toEqual(['proche', 'loin']);

    const joues = orderRail([
      carte('ancien', 'termine', '2026-09-15T10:00:00Z', 'A'),
      carte('recent', 'termine', '2026-09-19T10:00:00Z', 'A'),
    ]);
    expect(joues.map(x => x.nom)).toEqual(['recent', 'ancien']);
  });

  it('ne touche pas au tableau qu on lui donne', () => {
    const rail = [carte('x', 'a_venir', '2026-09-21T10:00:00Z'), carte('y', 'termine', '2026-09-19T10:00:00Z', 'A')];
    const avant = rail.map(x => x.nom);
    orderRail(rail);
    expect(rail.map(x => x.nom)).toEqual(avant);
  });

  it('voter ne fait pas sauter une carte ailleurs dans le rail', () => {
    // Le rang d'une partie à venir ne dépend PAS de mon pronostic : sans ça,
    // la carte changerait de place sous le doigt au moment du vote.
    expect(clashRank('a_venir', null)).toBe(clashRank('a_venir', 'A'));
  });
});

describe('le score affiché', () => {
  it('se lit toujours du côté des vainqueurs', () => {
    // `score_text` est stocké tel que saisi : quand un perdant saisit le
    // score, les colonnes sont inversées. Les deux doivent se lire pareil.
    expect(scoreLabel('6-4 3-6 10-7')).toBe('6 - 4 · 3 - 6 · 10 - 7');
    expect(scoreLabel('4-6 6-3 7-10')).toBe('6 - 4 · 3 - 6 · 10 - 7');
  });

  it('rend une chaîne vide quand il n y a pas de score', () => {
    expect(scoreLabel(null)).toBe('');
    expect(scoreLabel('')).toBe('');
  });
});

describe('le nom d une paire', () => {
  it('garde les prénoms, dans l ordre', () => {
    expect(pairLabel(paires.teamA)).toBe('Galan / mounir');
    expect(pairLabel(paires.teamB)).toBe('Alamine / merry');
  });
});
