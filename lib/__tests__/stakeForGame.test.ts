// Ce que CE match met en jeu, pour MOI.
//
// Le chiffre n'est jamais le même pour deux joueurs du même match : le
// mouvement dépend de l'écart entre les deux camps (commun aux coéquipiers)
// ET du coefficient personnel, qui suit le nombre de matchs et la fiabilité.
// Un joueur en placement bouge bien plus sur exactement le même match.
//
// Le piège du dossier, encore : le créateur n'a PAS de ligne participants. Le
// lire en oubliant `creator_id` donne trois joueurs sur quatre — donc jamais
// deux contre deux, donc aucun chiffre.
import { describe, it, expect, vi } from 'vitest';
vi.mock('../supabase', () => ({ supabase: {} }));
import {
  stakeSides, stakeOutcomeForGame, stakeOutcomeForJoining,
  bestGain, worstLoss, partnerEloRange,
} from '../stakePreview';
import { padelLevelToElo } from '../theme';

const joueur = (id: string, niveau: number) => ({
  id, elo_score: padelLevelToElo(niveau), win_count: 20, loss_count: 20, fiability_pct: 70,
});

const fiche = (niveau: number) => ({ elo_score: padelLevelToElo(niveau), win_count: 20, loss_count: 20 });

/** Un défi 2v2 complet : le créateur en A_GAU, trois participants. */
const partie = (o: Partial<any> = {}) => ({
  creator_id: 'a', creator_side: 'A_GAU',
  creator: { name: 'A', ...fiche(5) },
  is_challenge: true, game_format: 'competitive', stake_multiplier: 2,
  min_elo: padelLevelToElo(4), max_elo: padelLevelToElo(6),
  participants: [
    { player_id: 'b', status: 'accepted', team_side: 'A_DRO', player: { name: 'B', ...fiche(5) } },
    { player_id: 'c', status: 'accepted', team_side: 'B_GAU', player: { name: 'C', ...fiche(5) } },
    { player_id: 'd', status: 'accepted', team_side: 'B_DRO', player: { name: 'D', ...fiche(5) } },
  ],
  ...o,
});

describe('retrouver mon camp et celui d en face', () => {
  it('je suis le créateur : mon binôme est mon coéquipier, pas un adversaire', () => {
    const s = stakeSides(partie(), 'a');
    expect(s?.partner?.id).toBe('b');
    expect(s?.opponents.map(p => p.id).sort()).toEqual(['c', 'd']);
  });

  it('le créateur joue en face : il compte comme ADVERSAIRE', () => {
    // Sans lire `creator_id`, on ne voyait que trois joueurs et on ne
    // proposait aucun chiffre — alors que la partie était complète.
    const g = partie({
      creator_side: 'B_GAU',
      participants: [
        { player_id: 'b', status: 'accepted', team_side: 'B_DRO', player: fiche(5) },
        { player_id: 'c', status: 'accepted', team_side: 'A_GAU', player: fiche(5) },
        { player_id: 'd', status: 'accepted', team_side: 'A_DRO', player: fiche(5) },
      ],
    });
    const s = stakeSides(g, 'c');
    expect(s?.partner?.id).toBe('d');
    expect(s?.opponents.map(p => p.id).sort()).toEqual(['a', 'b']);
  });

  it('une place tenue par une invitation compte déjà', () => {
    const g = partie({
      participants: [
        { player_id: 'b', status: 'invited', team_side: 'A_DRO', invite_expires_at: new Date(Date.now() + 36e5).toISOString(), player: fiche(5) },
        { player_id: 'c', status: 'accepted', team_side: 'B_GAU', player: fiche(5) },
        { player_id: 'd', status: 'accepted', team_side: 'B_DRO', player: fiche(5) },
      ],
    });
    expect(stakeSides(g, 'a')?.partner?.id).toBe('b');
  });

  it('je ne suis pas dans la partie : rien à dire', () => {
    expect(stakeSides(partie(), 'zoe')).toBeNull();
  });
});

describe('le chiffre que je vois', () => {
  const moi = joueur('a', 5);

  it('gain positif, perte négative', () => {
    const r = stakeOutcomeForGame(partie(), moi);
    expect(r?.exact).toBe(true);
    expect(bestGain(r!.outcome)).toBeGreaterThan(0);
    expect(worstLoss(r!.outcome)).toBeLessThan(0);
  });

  it('la mise multiplie le mouvement', () => {
    const x1 = stakeOutcomeForGame(partie({ stake_multiplier: 1 }), moi)!;
    const x3 = stakeOutcomeForGame(partie({ stake_multiplier: 3 }), moi)!;
    expect(bestGain(x3.outcome)).toBeGreaterThan(bestGain(x1.outcome));
  });

  it('battre plus fort rapporte plus', () => {
    const fort = partie({
      participants: [
        { player_id: 'b', status: 'accepted', team_side: 'A_DRO', player: fiche(5) },
        { player_id: 'c', status: 'accepted', team_side: 'B_GAU', player: fiche(6.5) },
        { player_id: 'd', status: 'accepted', team_side: 'B_DRO', player: fiche(6.5) },
      ],
    });
    expect(bestGain(stakeOutcomeForGame(fort, moi)!.outcome))
      .toBeGreaterThan(bestGain(stakeOutcomeForGame(partie(), moi)!.outcome));
  });

  it('deux coéquipiers ne voient PAS le même chiffre', () => {
    // Même match, même camp : B est en placement, donc son coefficient est
    // bien plus élevé. C'est la vérité du moteur, pas un écart d'arrondi — et
    // c'est pour ça que chacun voit SON chiffre.
    const debutant = { id: 'b', elo_score: padelLevelToElo(5), win_count: 1, loss_count: 1, fiability_pct: 30 };
    const vuParA = stakeOutcomeForGame(partie(), moi)!;
    const vuParB = stakeOutcomeForGame(partie(), debutant)!;
    expect(bestGain(vuParB.outcome)).toBeGreaterThan(bestGain(vuParA.outcome));
  });

  it('un amical ne met rien en jeu', () => {
    expect(stakeOutcomeForGame(partie({ game_format: 'friendly' }), moi)).toBeNull();
  });

  it('sans binôme, la bande prend le relais — comme pour le camp d en face', () => {
    // Cette règle disait l'inverse : camp adverse incomplet → on projette sur
    // la bande (test suivant), mon camp incomplet → silence. Deux situations
    // identiques, deux réponses différentes. Le silence tombait pile sur le
    // défi reçu, au moment où le chiffre sert le plus.
    const g = partie({ participants: partie().participants.filter((p: any) => p.team_side !== 'A_DRO') });
    const e = stakeOutcomeForGame(g, moi);
    expect(e).not.toBeNull();
    expect(e?.exact).toBe(false);
  });

  it('camp adverse incomplet : la bande du défi prend le relais', () => {
    const g = partie({ participants: partie().participants.filter((p: any) => p.player_id !== 'd') });
    const r = stakeOutcomeForGame(g, moi);
    expect(r?.exact).toBe(false);
    expect(bestGain(r!.outcome)).toBeGreaterThan(0);
  });

  it('camp adverse incomplet ET aucune bande (défi ciblé) : rien', () => {
    const g = partie({
      min_elo: null, max_elo: null,
      participants: partie().participants.filter((p: any) => p.player_id !== 'd'),
    });
    expect(stakeOutcomeForGame(g, moi)).toBeNull();
  });
});

describe('avant de relever : je ne suis pas encore dans la partie', () => {
  const moi = joueur('z', 5);
  /** Un défi publié : le camp du créateur est complet, l autre est vide. */
  const aRelever = () => partie({
    participants: [
      { player_id: 'b', status: 'accepted', team_side: 'A_DRO', player: fiche(5) },
    ],
  });

  it('avec un binôme choisi : chiffre exact', () => {
    const r = stakeOutcomeForJoining(aRelever(), moi, joueur('y', 5));
    expect(r?.exact).toBe(true);
    expect(bestGain(r!.outcome)).toBeGreaterThan(0);
    expect(worstLoss(r!.outcome)).toBeLessThan(0);
  });

  it('sans binôme : une fourchette, pas un chiffre', () => {
    const r = stakeOutcomeForJoining(aRelever(), moi, null);
    expect(r?.exact).toBe(false);
    expect(bestGain(r!.outcome)).toBeGreaterThan(0);
  });

  it('le camp du créateur incomplet : rien à annoncer', () => {
    expect(stakeOutcomeForJoining(partie({ participants: [] }), moi, joueur('y', 5))).toBeNull();
  });

  it('mes adversaires sont le camp du créateur, quel que soit son côté', () => {
    const g = partie({
      creator_side: 'B_DRO',
      participants: [
        { player_id: 'b', status: 'accepted', team_side: 'B_GAU', player: fiche(5) },
      ],
    });
    expect(stakeOutcomeForJoining(g, moi, joueur('y', 5))?.exact).toBe(true);
  });
});

describe('la bande admissible du binôme', () => {
  it('se déduit de la moyenne exigée : c est la paire qui doit tenir dans la bande', () => {
    // La règle affichée dans « Choisis ton binôme » porte sur la MOYENNE du
    // duo. À niveau 5 dans une bande 4-6, mon binôme peut donc descendre plus
    // bas que 4 et monter plus haut que 6.
    const bande = partnerEloRange(padelLevelToElo(5), padelLevelToElo(4), padelLevelToElo(6));
    expect(bande![0]).toBeLessThan(padelLevelToElo(4));
    expect(bande![1]).toBeGreaterThan(padelLevelToElo(6));
  });

  it('sans bande, on ne borne rien', () => {
    expect(partnerEloRange(1500, null, null)).toBeNull();
  });
});

describe('un défi reçu, avant d avoir trouvé son binôme', () => {
  // Le cas vu sur téléphone : on est invité seul face à une paire connue, et
  // la carte n'affichait AUCUN enjeu — au moment précis où le chiffre sert le
  // plus, puisqu'il faut décider de relever ou non.
  const defiRecu = (o: Partial<any> = {}) => partie({
    participants: [
      { player_id: 'b', status: 'accepted', team_side: 'A_DRO', player: { name: 'B', ...fiche(4.4) } },
      { player_id: 'moi', status: 'invited', team_side: 'B_GAU', player: { name: 'Moi', ...fiche(4.9) } },
    ],
    ...o,
  });

  it('rend quand même les camps, avec un binôme absent', () => {
    const s = stakeSides(defiRecu(), 'moi');
    expect(s).not.toBeNull();
    expect(s?.partner).toBeNull();
    expect(s?.opponents.map(p => p.id).sort()).toEqual(['a', 'b']);
  });

  it('projette un enjeu, annoncé comme une fourchette', () => {
    const e = stakeOutcomeForGame(defiRecu(), joueur('moi', 4.9));
    expect(e).not.toBeNull();
    expect(e?.exact).toBe(false);
    // Un gain se compte en positif, une perte en négatif : c'est la carte qui
    // met la couleur, pas le signe.
    expect(bestGain(e!.outcome)).toBeGreaterThan(0);
    expect(worstLoss(e!.outcome)).toBeLessThan(0);
  });

  it('se tait sans bande : inventer un binôme serait inventer un chiffre', () => {
    const e = stakeOutcomeForGame(defiRecu({ min_elo: null, max_elo: null }), joueur('moi', 4.9));
    expect(e).toBeNull();
  });

  it('se tait quand le camp d en face est lui aussi incomplet', () => {
    const e = stakeOutcomeForGame(
      defiRecu({ participants: [{ player_id: 'moi', status: 'invited', team_side: 'B_GAU', player: { name: 'Moi', ...fiche(4.9) } }] }),
      joueur('moi', 4.9),
    );
    expect(e).toBeNull();
  });

  it('une fois le binôme arrivé, le chiffre devient exact', () => {
    const complet = defiRecu({
      participants: [
        { player_id: 'b', status: 'accepted', team_side: 'A_DRO', player: { name: 'B', ...fiche(4.4) } },
        { player_id: 'moi', status: 'accepted', team_side: 'B_GAU', player: { name: 'Moi', ...fiche(4.9) } },
        { player_id: 'bin', status: 'accepted', team_side: 'B_DRO', player: { name: 'Bin', ...fiche(4.6) } },
      ],
    });
    const e = stakeOutcomeForGame(complet, joueur('moi', 4.9));
    expect(e?.exact).toBe(true);
  });
});
