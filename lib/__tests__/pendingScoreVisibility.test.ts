// Le score que J'AI saisi (ou que mon binôme a saisi) doit rester visible.
//
// Une fois soumis, la partie quitte « À venir » et le match n'est pas encore
// dans l'historique validé : sans ces règles, le match disparaissait
// complètement de l'écran du camp qui l'avait saisi.
import { describe, it, expect } from 'vitest';
import { isMyPendingScore, isAuthorsPartner, matchNeedsMyAction } from '../matches';

// Paire gagnante : MOI + BINOME. Paire perdante : ADV1 + ADV2.
const MOI = 'moi', BINOME = 'binome', ADV1 = 'adv1', ADV2 = 'adv2';

const match = (over: Record<string, any> = {}) => ({
  status: 'pending',
  created_by: MOI,
  winner_id: MOI, winner_id_2: BINOME,
  loser_id: ADV1, loser_id_2: ADV2,
  validation_opens_at: null,
  ...over,
});

describe('isAuthorsPartner — qui est du même côté que l\'auteur', () => {
  it('le coéquipier de l\'auteur, oui', () => {
    expect(isAuthorsPartner(match(), BINOME)).toBe(true);
  });
  it('l\'auteur lui-même, non — il est l\'auteur, pas son partenaire', () => {
    expect(isAuthorsPartner(match(), MOI)).toBe(false);
  });
  it('les adversaires, non', () => {
    expect(isAuthorsPartner(match(), ADV1)).toBe(false);
    expect(isAuthorsPartner(match(), ADV2)).toBe(false);
  });
  it('marche aussi quand l\'auteur est du côté perdant', () => {
    const m = match({ created_by: ADV1 });
    expect(isAuthorsPartner(m, ADV2)).toBe(true);
    expect(isAuthorsPartner(m, MOI)).toBe(false);
  });
  it('sans auteur connu, personne n\'est son partenaire', () => {
    expect(isAuthorsPartner(match({ created_by: null }), BINOME)).toBe(false);
  });
  it('un joueur seul de son côté n\'a pas de partenaire', () => {
    expect(isAuthorsPartner(match({ winner_id_2: null }), BINOME)).toBe(false);
  });
});

describe('isMyPendingScore — le match reste visible pour le binôme qui a saisi', () => {
  it('pour celui qui a saisi', () => {
    expect(isMyPendingScore(match(), MOI)).toBe(true);
  });

  it('pour son binôme, qui n\'a rien tapé mais a joué le match', () => {
    expect(isMyPendingScore(match(), BINOME)).toBe(true);
  });

  it('pas pour les adversaires : eux ont une validation à faire, pas une attente', () => {
    expect(isMyPendingScore(match(), ADV1)).toBe(false);
    expect(isMyPendingScore(match(), ADV2)).toBe(false);
  });

  it('ne s\'applique qu\'aux scores en attente', () => {
    expect(isMyPendingScore(match({ status: 'validated' }), MOI)).toBe(false);
    expect(isMyPendingScore(match({ status: 'counter_proposed' }), MOI)).toBe(false);
    expect(isMyPendingScore(match({ status: 'disputed' }), MOI)).toBe(false);
  });

  it('ne dépend PAS de l\'heure d\'ouverture — c\'est mon score, je le vois tout de suite', () => {
    const demain = new Date(Date.now() + 86_400_000).toISOString();
    expect(isMyPendingScore(match({ validation_opens_at: demain }), MOI)).toBe(true);
    expect(isMyPendingScore(match({ validation_opens_at: demain }), BINOME)).toBe(true);
  });
});

describe('les deux règles ne se marchent pas dessus', () => {
  const ouvert = new Date(Date.now() - 3_600_000).toISOString();

  it('personne n\'est à la fois « en attente » et « à valider »', () => {
    const m = match({ validation_opens_at: ouvert });
    for (const qui of [MOI, BINOME, ADV1, ADV2]) {
      const attente = isMyPendingScore(m, qui);
      const aValider = matchNeedsMyAction(m, qui) === 'validate';
      expect(attente && aValider).toBe(false);
    }
  });

  it('chaque camp a sa vue : attente pour l\'un, validation pour l\'autre', () => {
    const m = match({ validation_opens_at: ouvert });
    expect(isMyPendingScore(m, MOI)).toBe(true);
    expect(isMyPendingScore(m, BINOME)).toBe(true);
    expect(matchNeedsMyAction(m, ADV1)).toBe('validate');
    expect(matchNeedsMyAction(m, ADV2)).toBe('validate');
  });

  it('avant l\'heure d\'ouverture, l\'adversaire n\'a toujours rien à faire', () => {
    const plusTard = new Date(Date.now() + 3_600_000).toISOString();
    const m = match({ validation_opens_at: plusTard });
    expect(matchNeedsMyAction(m, ADV1)).toBeNull();
    expect(isMyPendingScore(m, MOI)).toBe(true);
  });
});
