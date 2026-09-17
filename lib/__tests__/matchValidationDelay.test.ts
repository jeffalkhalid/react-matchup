// Délai avant qu'un score saisi soit validable par l'adversaire.
//
// RÈGLE (demande utilisateur 2026-09-16) : un score ne s'ouvre à la validation
// qu'à l'heure du match + 1h30, et jamais moins de 30 min après la saisie
// (match commencé en retard). Avant cette heure, l'adversaire ne voit RIEN :
// ni score, ni notification, ni pastille de cloche.
//
// L'heure d'ouverture est calculée par le SERVEUR (colonne
// matches.validation_opens_at) ; ici on vérifie la lecture côté app, source
// unique partagée par la cloche, le lobby et les notifications.
import { describe, it, expect } from 'vitest';
import { matchNeedsMyAction, isValidationOpen } from '../matches';

const MOI = 'me';
const PARTENAIRE = 'partner';
const ADVERSAIRE_1 = 'opp1';

// Score saisi par l'adversaire : c'est moi qui dois valider.
const soumisParAdversaire = (opensAt: string | null) => ({
  status: 'pending',
  created_by: ADVERSAIRE_1,
  winner_id: ADVERSAIRE_1,
  winner_id_2: 'opp2',
  loser_id: MOI,
  loser_id_2: PARTENAIRE,
  validation_opens_at: opensAt,
});

const T20H = new Date('2026-09-16T20:00:00Z');
const T20H30 = new Date('2026-09-16T20:30:00Z');

describe('ouverture de la validation', () => {
  it('avant l’heure : l’adversaire n’a rien à faire', () => {
    const m = soumisParAdversaire('2026-09-16T20:30:00Z');
    expect(matchNeedsMyAction(m, MOI, T20H)).toBeNull();
    expect(isValidationOpen(m, T20H)).toBe(false);
  });

  it('à l’heure pile : la validation s’ouvre', () => {
    const m = soumisParAdversaire('2026-09-16T20:30:00Z');
    expect(matchNeedsMyAction(m, MOI, T20H30)).toBe('validate');
    expect(isValidationOpen(m, T20H30)).toBe(true);
  });

  it('après l’heure : validation possible', () => {
    const m = soumisParAdversaire('2026-09-16T20:30:00Z');
    expect(matchNeedsMyAction(m, MOI, new Date('2026-09-16T23:00:00Z'))).toBe('validate');
  });

  it('score sans heure d’ouverture (match d’avant la règle) : validable', () => {
    const m = soumisParAdversaire(null);
    expect(matchNeedsMyAction(m, MOI, T20H)).toBe('validate');
    expect(isValidationOpen(m, T20H)).toBe(true);
  });

  it('l’auteur du score n’a jamais rien à valider, avant comme après', () => {
    const m = { ...soumisParAdversaire('2026-09-16T20:30:00Z'), created_by: MOI, winner_id: MOI };
    expect(matchNeedsMyAction(m, MOI, T20H)).toBeNull();
    expect(matchNeedsMyAction(m, MOI, T20H30)).toBeNull();
  });

  it('le partenaire de l’auteur non plus', () => {
    const m = {
      status: 'pending', created_by: ADVERSAIRE_1,
      winner_id: ADVERSAIRE_1, winner_id_2: MOI,
      loser_id: 'opp2', loser_id_2: 'opp3',
      validation_opens_at: '2026-09-16T20:30:00Z',
    };
    expect(matchNeedsMyAction(m, MOI, T20H30)).toBeNull();
  });

  it('une contestation à résoudre n’attend pas l’heure d’ouverture', () => {
    // Elle ne peut survenir qu'APRÈS l'ouverture ; l'auteur doit pouvoir
    // trancher sans délai supplémentaire.
    const m = {
      status: 'counter_proposed', created_by: MOI,
      winner_id: MOI, winner_id_2: PARTENAIRE, loser_id: ADVERSAIRE_1, loser_id_2: 'opp2',
      validation_opens_at: '2026-09-16T23:00:00Z',
    };
    expect(matchNeedsMyAction(m, MOI, T20H30)).toBe('resolve');
  });

  it('sans horloge fournie, se lit à l’instant présent', () => {
    const passe = soumisParAdversaire(new Date(Date.now() - 60_000).toISOString());
    const futur = soumisParAdversaire(new Date(Date.now() + 60 * 60_000).toISOString());
    expect(matchNeedsMyAction(passe, MOI)).toBe('validate');
    expect(matchNeedsMyAction(futur, MOI)).toBeNull();
  });
});
