// « Amène ton partenaire » : le bouton existait, personne ne pouvait le voir.
//
// Défi nominatif : Khalid défie Lebron. Le binôme de Khalid accepte, le
// serveur invite Lebron, Lebron relève le défi… et se retrouve seul dans son
// camp, sans aucun moyen d'y amener quelqu'un (vu sur téléphone le
// 2026-09-23 : « je me retrouve avec Lebron dans la partie sans binôme »).
//
// Le bouton était écrit, mais dans une branche INATTEIGNABLE : un siège à
// pourvoir n'existe QUE pour un joueur déjà accepté (partnerSeatToFill), et
// la fiche traitait « je suis accepté » AVANT d'y arriver. Deux conditions
// que le code croyait complémentaires et qui sont en fait la même.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
vi.mock('../supabase', () => ({ supabase: {} }));
import { partnerSeatToFill, partnerSeatAfterAccepting } from '../games';

const ROOT = join(__dirname, '..', '..');

/** Le défi de la capture : Khalid (créateur, A) + son binôme, Lebron en B. */
function defiCible(lebron: { status: string }) {
  return {
    is_challenge: true, is_targeted: true, status: 'open',
    creator_id: 'khalid', creator_side: 'A_GAU',
    participants: [
      { id: 'p-kay2',   player_id: 'kay2',   status: 'accepted',    team_side: 'A_DRO' },
      { id: 'p-lebron', player_id: 'lebron', status: lebron.status, team_side: 'B_GAU' },
    ],
  };
}

describe('les deux conditions sont la même', () => {
  it("le siège à pourvoir n'existe que pour un joueur DÉJÀ accepté", () => {
    // C'est la démonstration du bug : toute branche qui traite « accepté »
    // avant « siège à pourvoir » rend la seconde inatteignable.
    expect(partnerSeatToFill(defiCible({ status: 'invited' }) as any, 'lebron')).toBeNull();
    expect(partnerSeatToFill(defiCible({ status: 'accepted' }) as any, 'lebron')).toBe('B_DRO');
  });
});

describe('accepter le défi ouvre le choix du partenaire', () => {
  it('Lebron accepte : son camp lui réclame un siège', () => {
    expect(partnerSeatAfterAccepting(defiCible({ status: 'invited' }) as any, 'p-lebron', 'lebron')).toBe('B_DRO');
  });

  it('le binôme du créateur, lui, n\'a rien à pourvoir', () => {
    const g = {
      ...defiCible({ status: 'invited' }),
      participants: [
        { id: 'p-kay2', player_id: 'kay2', status: 'invited', team_side: 'A_DRO' },
      ],
    };
    expect(partnerSeatAfterAccepting(g as any, 'p-kay2', 'kay2')).toBeNull();
  });

  it('un défi ouvert (non nominatif) ne réclame rien : il se relève à deux', () => {
    const g = { ...defiCible({ status: 'invited' }), is_targeted: false };
    expect(partnerSeatAfterAccepting(g as any, 'p-lebron', 'lebron')).toBeNull();
  });

  it('camp déjà complet : plus rien à pourvoir', () => {
    const g = {
      ...defiCible({ status: 'invited' }),
      participants: [
        { id: 'p-kay2',   player_id: 'kay2',   status: 'accepted', team_side: 'A_DRO' },
        { id: 'p-lebron', player_id: 'lebron', status: 'invited',  team_side: 'B_GAU' },
        { id: 'p-ami',    player_id: 'ami',    status: 'accepted', team_side: 'B_DRO' },
      ],
    };
    expect(partnerSeatAfterAccepting(g as any, 'p-lebron', 'lebron')).toBeNull();
  });
});

describe('le bouton est dans une branche que le joueur atteint', () => {
  it("« Amène ton partenaire » vit dans la branche du joueur accepté", () => {
    const src = readFileSync(join(ROOT, 'app', '(tabs)', 'GameDetailsSheet.tsx'), 'utf8');
    const accepte = src.indexOf('if (isAccepted && myParticipant)');
    const suivante = src.indexOf('if (alreadyIn)');
    const bouton = src.indexOf('Amène ton partenaire');
    expect(accepte).toBeGreaterThan(-1);
    expect(suivante).toBeGreaterThan(accepte);
    // Hors de cet intervalle, le bouton est écrit mais jamais rendu.
    expect(bouton).toBeGreaterThan(accepte);
    expect(bouton).toBeLessThan(suivante);
  });
});
