// L'enjeu d'une partie que je ne fais que REGARDER.
//
// C'est le chiffre qui donne envie d'entrer : le taire dans l'Explorer, c'est
// le réserver à ceux qui sont déjà dedans. Mais je ne sais pas encore quelle
// place je prendrais, ni qui remplira les autres — on projette donc chaque
// place libre, on bouche les trous avec la bande de niveau de la partie, et
// on montre l'enveloppe.
import { describe, it, expect, vi } from 'vitest';
vi.mock('../supabase', () => ({ supabase: {} }));
import { stakeOutcomeForExploring, stakeOutcomeForJoining, bestGain, worstLoss } from '../stakePreview';
import { padelLevelToElo } from '../theme';

const moi = { id: 'z', elo_score: padelLevelToElo(5), win_count: 20, loss_count: 20, fiability_pct: 70 };
const fiche = (niveau: number) => ({ elo_score: padelLevelToElo(niveau), win_count: 20, loss_count: 20 });
const part = (id: string, side: string, niveau = 5) =>
  ({ player_id: id, status: 'accepted', team_side: side, player: fiche(niveau) });

const partie = (o: Partial<any> = {}) => ({
  creator_id: 'a', creator_side: 'A_GAU', creator: { name: 'A', ...fiche(5) },
  game_format: 'competitive', stake_multiplier: 1,
  min_elo: padelLevelToElo(4), max_elo: padelLevelToElo(6),
  participants: [part('b', 'A_DRO'), part('c', 'B_GAU'), part('d', 'B_DRO')],
  ...o,
});

describe('ce que je risque si j entre', () => {
  it('une seule place libre, les trois autres connus : chiffre exact', () => {
    const g = partie({ participants: [part('b', 'A_DRO'), part('c', 'B_GAU')] });
    const r = stakeOutcomeForExploring(g, moi);
    expect(r?.exact).toBe(true);
    expect(bestGain(r!.outcome)).toBeGreaterThan(0);
    expect(worstLoss(r!.outcome)).toBeLessThan(0);
  });

  it('deux places libres : une fourchette, et on le dit', () => {
    const g = partie({ participants: [part('b', 'A_DRO'), part('c', 'B_GAU')].slice(0, 1) });
    const r = stakeOutcomeForExploring(g, moi);
    expect(r?.exact).toBe(false);
    expect(bestGain(r!.outcome)).toBeGreaterThan(0);
  });

  it('la fourchette englobe le cas exact', () => {
    // Deux places libres : l'enveloppe ne peut pas être plus étroite que le
    // scénario où l'on connaît tout le monde.
    const flou = stakeOutcomeForExploring(partie({ participants: [part('b', 'A_DRO')] }), moi)!;
    const net = stakeOutcomeForExploring(partie({ participants: [part('b', 'A_DRO'), part('c', 'B_GAU')] }), moi)!;
    expect(bestGain(flou.outcome)).toBeGreaterThanOrEqual(bestGain(net.outcome));
  });

  it('plus la partie est forte, plus elle rapporte', () => {
    const forte = partie({
      min_elo: padelLevelToElo(6), max_elo: padelLevelToElo(7),
      participants: [part('b', 'A_DRO', 6.5), part('c', 'B_GAU', 6.5), part('d', 'B_DRO', 6.5)].slice(0, 2),
      creator: { name: 'A', ...fiche(6.5) },
    });
    const faible = partie({ participants: [part('b', 'A_DRO', 3.5), part('c', 'B_GAU', 3.5)] , creator: { name: 'A', ...fiche(3.5) } });
    expect(bestGain(stakeOutcomeForExploring(forte, moi)!.outcome))
      .toBeGreaterThan(bestGain(stakeOutcomeForExploring(faible, moi)!.outcome));
  });

  it('un amical ne met rien en jeu', () => {
    expect(stakeOutcomeForExploring(partie({ game_format: 'friendly', participants: [part('b', 'A_DRO')] }), moi)).toBeNull();
  });

  it('partie complète : plus de place, rien à projeter', () => {
    expect(stakeOutcomeForExploring(partie(), moi)).toBeNull();
  });

  it("j'y suis déjà : ce n'est plus une projection d'entrée", () => {
    const g = partie({ participants: [part('b', 'A_DRO'), { player_id: 'z', status: 'accepted', team_side: 'B_GAU', player: fiche(5) }] });
    expect(stakeOutcomeForExploring(g, moi)).toBeNull();
  });

  it('places libres mais aucune bande de niveau : on se tait', () => {
    const g = partie({ min_elo: null, max_elo: null, participants: [part('b', 'A_DRO')] });
    expect(stakeOutcomeForExploring(g, moi)).toBeNull();
  });
});

describe('un défi à relever donne le même chiffre par les deux chemins', () => {
  it("l'Explorer et « À relever » ne peuvent pas se contredire", () => {
    // Sur un défi, les camps sont fixes : les seules places libres sont en
    // face du créateur. Les deux fonctions doivent donc tomber d'accord.
    const defi = partie({
      is_challenge: true, stake_multiplier: 2,
      participants: [part('b', 'A_DRO')],
    });
    const parExplorer = stakeOutcomeForExploring(defi, moi)!;
    const parRelever = stakeOutcomeForJoining(defi, moi, null)!;
    expect(bestGain(parExplorer.outcome)).toBeCloseTo(bestGain(parRelever.outcome), 5);
    expect(worstLoss(parExplorer.outcome)).toBeCloseTo(worstLoss(parRelever.outcome), 5);
  });
});
