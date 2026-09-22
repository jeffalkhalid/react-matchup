// Défi NOMINATIF : l'adversaire désigné amène son propre partenaire.
//
// On défie une personne, pas une paire. Rien ne le permettait : toutes les
// invitations partaient de l'assistant de création, donc un défi nominatif
// restait à trois pour toujours.
import { describe, it, expect, vi } from 'vitest';
vi.mock('../supabase', () => ({ supabase: {} }));
import { partnerSeatToFill } from '../games';

const part = (player_id: string, team_side: string, status = 'accepted') => ({ player_id, team_side, status });

/** Un défi nominatif : mon binôme en A, Galan désigné et confirmé en B. */
const defiNominatif = (participants: any[], over: any = {}) => ({
  is_challenge: true, is_targeted: true, status: 'open',
  participants, ...over,
});

describe('qui peut amener un partenaire', () => {
  it("l'adversaire confirmé voit le siège libre de son camp", () => {
    const g = defiNominatif([part('binome', 'A_DRO'), part('galan', 'B_GAU')]);
    expect(partnerSeatToFill(g, 'galan')).toBe('B_DRO');
  });

  it("le siège rendu est celui qui reste — l'autre côté marche aussi", () => {
    const g = defiNominatif([part('binome', 'A_DRO'), part('galan', 'B_DRO')]);
    expect(partnerSeatToFill(g, 'galan')).toBe('B_GAU');
  });

  it('une fois le camp complet, il n’y a plus rien à pourvoir', () => {
    const g = defiNominatif([part('binome', 'A_DRO'), part('galan', 'B_GAU'), part('ami', 'B_DRO')]);
    expect(partnerSeatToFill(g, 'galan')).toBeNull();
  });

  it("une invitation en cours occupe déjà la place", () => {
    // Sinon on inviterait deux personnes pour un seul siège.
    const g = defiNominatif([
      part('binome', 'A_DRO'), part('galan', 'B_GAU'),
      { player_id: 'ami', team_side: 'B_DRO', status: 'invited', invite_expires_at: new Date(Date.now() + 3600_000).toISOString() },
    ]);
    expect(partnerSeatToFill(g, 'galan')).toBeNull();
  });
});

describe('qui ne le peut pas', () => {
  it("un adversaire qui n'a pas encore accepté", () => {
    const g = defiNominatif([part('binome', 'A_DRO'), part('galan', 'B_GAU', 'invited')]);
    expect(partnerSeatToFill(g, 'galan')).toBeNull();
  });

  it('le binôme du créateur — ce camp est déjà formé', () => {
    const g = defiNominatif([part('binome', 'A_DRO'), part('galan', 'B_GAU')]);
    expect(partnerSeatToFill(g, 'binome')).toBeNull();
  });

  it("quelqu'un qui n'est pas dans la partie", () => {
    const g = defiNominatif([part('binome', 'A_DRO'), part('galan', 'B_GAU')]);
    expect(partnerSeatToFill(g, 'inconnu')).toBeNull();
  });

  it("sur un défi OUVERT : le camp adverse se remplit par candidature de binôme", () => {
    const g = defiNominatif([part('binome', 'A_DRO'), part('galan', 'B_GAU')], { is_targeted: false });
    expect(partnerSeatToFill(g, 'galan')).toBeNull();
  });

  it('sur une partie ordinaire, la question ne se pose pas', () => {
    const g = defiNominatif([part('binome', 'A_DRO'), part('galan', 'B_GAU')], { is_challenge: false });
    expect(partnerSeatToFill(g, 'galan')).toBeNull();
  });

  it('sur une partie annulée ou déjà scorée, plus personne ne complète', () => {
    const parts = [part('binome', 'A_DRO'), part('galan', 'B_GAU')];
    expect(partnerSeatToFill(defiNominatif(parts, { status: 'cancelled' }), 'galan')).toBeNull();
    expect(partnerSeatToFill(defiNominatif(parts, { status: 'closed' }), 'galan')).toBeNull();
  });
});
