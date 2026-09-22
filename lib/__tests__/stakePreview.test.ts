// Ce que la mise change vraiment — projection en niveau, avant de publier.
//
// L'assistant annonçait « Points ELO gagnés/perdus : ×2 » sans dire multiplié
// par quoi. Le calcul ci-dessous est celui du serveur (simulateElo), nourri de
// la configuration reelle.
import { describe, it, expect, vi } from 'vitest';
vi.mock('../supabase', () => ({ supabase: {} }));
import {
  stakeOutcome, stakeOutcomeForBand, formatLevelDelta, formatLevelRange,
  type StakePlayer,
} from '../stakePreview';
import { padelLevelToElo } from '../theme';

const j = (id: string, niveau: number, fiab = 70): StakePlayer => ({
  id, elo_score: padelLevelToElo(niveau),
  win_count: 12, loss_count: 8, last_match_at: new Date().toISOString(), fiability_pct: fiab,
});

// La configuration de la capture : binome 5.41 + 3.89 contre 4.94 et 4.87.
const MOI = j('moi', 5.41);
const BINOME = j('bin', 3.89);
const ADVERSAIRES = [j('a1', 4.94), j('a2', 4.87)];

describe('la mise change vraiment quelque chose', () => {
  it('une victoire fait monter, une defaite fait descendre', () => {
    const o = stakeOutcome(MOI, BINOME, ADVERSAIRES, 2)!;
    expect(o.winMin).toBeGreaterThan(0);
    expect(o.loseMax).toBeLessThan(0);
  });

  it('doubler la mise double a peu pres le mouvement', () => {
    const x2 = stakeOutcome(MOI, BINOME, ADVERSAIRES, 2)!;
    const x4 = stakeOutcome(MOI, BINOME, ADVERSAIRES, 4)!;
    expect(x4.winMin).toBeGreaterThan(x2.winMin * 1.5);
  });

  it('l ecart entre x2 et x4 se voit sur l echelle de niveau', () => {
    // Le point qui decidait de l affichage : si l ecart etait de deux
    // centiemes, montrer le chiffre aurait demontre que la mise ne sert a rien.
    const x2 = stakeOutcome(MOI, BINOME, ADVERSAIRES, 2)!;
    const x4 = stakeOutcome(MOI, BINOME, ADVERSAIRES, 4)!;
    expect(x4.winMin - x2.winMin).toBeGreaterThanOrEqual(0.05);
  });

  it('un score large rapporte plus qu un score serre', () => {
    const o = stakeOutcome(MOI, BINOME, ADVERSAIRES, 2)!;
    expect(o.winMax).toBeGreaterThan(o.winMin);
  });

  it('une fiabilite basse fait bouger davantage', () => {
    // Elle pese plus que la mise : un chiffre qui l ignorerait serait faux
    // pour la moitie des joueurs.
    const sur = stakeOutcome(j('moi', 5.41, 90), BINOME, ADVERSAIRES, 2)!;
    const flou = stakeOutcome(j('moi', 5.41, 50), BINOME, ADVERSAIRES, 2)!;
    expect(flou.winMin).toBeGreaterThan(sur.winMin);
  });

  it('le niveau de depart est celui du joueur', () => {
    expect(stakeOutcome(MOI, BINOME, ADVERSAIRES, 2)!.level).toBeCloseTo(5.41, 1);
  });
});

describe('on n invente jamais un adversaire', () => {
  it('sans binome, rien a annoncer', () => {
    expect(stakeOutcome(MOI, null, ADVERSAIRES, 2)).toBeNull();
  });

  it('avec un seul adversaire connu, rien non plus', () => {
    expect(stakeOutcome(MOI, BINOME, [ADVERSAIRES[0]], 2)).toBeNull();
  });

  it('sans moi, rien', () => {
    expect(stakeOutcome(null, BINOME, ADVERSAIRES, 2)).toBeNull();
  });
});

describe('defi ouvert — la fourchette vient de la bande', () => {
  it('une bande large donne une fourchette plus large qu une bande etroite', () => {
    const etroite = stakeOutcomeForBand(MOI, BINOME, 4.5, 4.7, 2)!;
    const large = stakeOutcomeForBand(MOI, BINOME, 3.0, 7.0, 2)!;
    expect(large.winMax - large.winMin).toBeGreaterThan(etroite.winMax - etroite.winMin);
  });

  it('sans binome, rien a annoncer', () => {
    expect(stakeOutcomeForBand(MOI, null, 4, 6, 2)).toBeNull();
  });
});

describe('l ecriture des variations', () => {
  it('signe visible et virgule decimale', () => {
    expect(formatLevelDelta(0.14)).toBe('+0,14');
    expect(formatLevelDelta(-0.21)).toBe('−0,21');
  });

  it('zero ne porte pas de signe', () => {
    expect(formatLevelDelta(0)).toBe('0,00');
  });

  it('une fourchette qui se referme s ecrit une seule fois', () => {
    expect(formatLevelRange(0.14, 0.14)).toBe('+0,14');
    expect(formatLevelRange(0.14, 0.21)).toBe('+0,14 à +0,21');
  });
});
