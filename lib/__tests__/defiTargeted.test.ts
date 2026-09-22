// Défi CIBLÉ : les adversaires ne sont prévenus qu'après l'acceptation du
// binôme du créateur. Pendant le brouillon, ils sont seulement NOTÉS sur le
// défi (open_games.target_players), jamais invités (aucune ligne
// game_participants, aucune notification).
//
// Deux fonctions pures :
//  - defiCreationPlan : que publier à la création (handlePublish) selon le
//    type de partie ;
//  - targetedOpponentsLine : la phrase affichée dans la fiche pendant le
//    brouillon d'un défi ciblé (créateur ou partenaire invité).
import { describe, it, expect, vi } from 'vitest';
vi.mock('../supabase', () => ({ supabase: {} }));

import { defiCreationPlan, targetedOpponentsLine } from '../defis';

describe('defiCreationPlan', () => {
  it('partie normale : tout le monde est invité, ouverte tout de suite', () => {
    const plan = defiCreationPlan({
      gameType: 'Amical',
      isTargeted: false,
      players: [
        { id: 'p1', name: 'Yasmine', team_side: 'A_DRO' },
        { id: 'p2', name: 'Omar', team_side: 'B_GAU' },
        { id: 'p3', name: 'Sara', team_side: 'B_DRO' },
      ],
    });
    expect(plan.status).toBe('open');
    expect(plan.invites).toEqual([
      { player_id: 'p1', team_side: 'A_DRO' },
      { player_id: 'p2', team_side: 'B_GAU' },
      { player_id: 'p3', team_side: 'B_DRO' },
    ]);
    expect(plan.targetPlayers).toBeNull();
  });

  it("team_side absent → 'A_GAU' par défaut", () => {
    const plan = defiCreationPlan({
      gameType: 'Compétitif',
      isTargeted: false,
      players: [{ id: 'p1', name: 'Yasmine' }],
    });
    expect(plan.invites).toEqual([{ player_id: 'p1', team_side: 'A_GAU' }]);
  });

  it('défi OUVERT (non ciblé) : brouillon, seul le partenaire (Team A) est invité', () => {
    const plan = defiCreationPlan({
      gameType: 'Défi',
      isTargeted: false,
      players: [{ id: 'partner', name: 'Yasmine', team_side: 'A_DRO' }],
    });
    expect(plan.status).toBe('draft');
    expect(plan.invites).toEqual([{ player_id: 'partner', team_side: 'A_DRO' }]);
    expect(plan.targetPlayers).toBeNull();
  });

  it('défi CIBLÉ : brouillon, seul le partenaire invité — les adversaires vont dans targetPlayers', () => {
    const plan = defiCreationPlan({
      gameType: 'Défi',
      isTargeted: true,
      players: [
        { id: 'partner', name: 'Yasmine', team_side: 'A_DRO' },
        { id: 'opp1', name: 'Omar', team_side: 'B_GAU' },
        { id: 'opp2', name: 'Sara', team_side: 'B_DRO' },
      ],
    });
    expect(plan.status).toBe('draft');
    expect(plan.invites).toEqual([{ player_id: 'partner', team_side: 'A_DRO' }]);
    expect(plan.targetPlayers).toEqual([
      { player_id: 'opp1', team_side: 'B_GAU', name: 'Omar' },
      { player_id: 'opp2', team_side: 'B_DRO', name: 'Sara' },
    ]);
  });

  it('défi CIBLÉ sans adversaires fournis : targetPlayers reste null', () => {
    const plan = defiCreationPlan({
      gameType: 'Défi',
      isTargeted: true,
      players: [{ id: 'partner', name: 'Yasmine', team_side: 'A_DRO' }],
    });
    expect(plan.targetPlayers).toBeNull();
  });
});

describe('targetedOpponentsLine', () => {
  const opponents = [{ name: 'Omar' }, { name: 'Sara' }];

  it('vue créateur : annonce que les adversaires seront prévenus', () => {
    const line = targetedOpponentsLine(
      { status: 'draft', is_targeted: true, target_players: opponents },
      'creator',
    );
    expect(line).toBe('Omar & Sara seront prévenus dès que ton binôme accepte');
  });

  it('vue partenaire invité : annonce qui il affrontera', () => {
    const line = targetedOpponentsLine(
      { status: 'draft', is_targeted: true, target_players: opponents },
      'partner',
    );
    expect(line).toBe('Vous affronterez Omar & Sara — ils seront prévenus dès que tu acceptes');
  });

  it('null quand le défi n’est plus un brouillon (déjà publié)', () => {
    const line = targetedOpponentsLine(
      { status: 'open', is_targeted: true, target_players: opponents },
      'creator',
    );
    expect(line).toBeNull();
  });

  it("null quand ce n'est pas un défi ciblé", () => {
    const line = targetedOpponentsLine(
      { status: 'draft', is_targeted: false, target_players: opponents },
      'creator',
    );
    expect(line).toBeNull();
  });

  it('null quand aucun adversaire n’est encore noté', () => {
    const line = targetedOpponentsLine(
      { status: 'draft', is_targeted: true, target_players: null },
      'creator',
    );
    expect(line).toBeNull();
    const empty = targetedOpponentsLine(
      { status: 'draft', is_targeted: true, target_players: [] },
      'creator',
    );
    expect(empty).toBeNull();
  });
});

describe("defier UNE personne — elle choisira son binome", () => {
  const moiEtBinome = [
    { id: 'binome', name: 'Kenza', team_side: 'A_DRO' },
  ];

  it("un seul adversaire designe est bien NOTE sur le defi", () => {
    // Le bug : « Defier » depuis un profil et « Revanche » placaient un
    // adversaire a l ecran, puis le jetaient a la publication.
    const plan = defiCreationPlan({
      gameType: 'Défi',
      isTargeted: true,
      players: [...moiEtBinome, { id: 'galan', name: 'Galan', team_side: 'B_GAU' }],
    });
    expect(plan.targetPlayers).toEqual([{ player_id: 'galan', team_side: 'B_GAU', name: 'Galan' }]);
  });

  it("il n est pas invite tout de suite — le serveur s en charge", () => {
    const plan = defiCreationPlan({
      gameType: 'Défi',
      isTargeted: true,
      players: [...moiEtBinome, { id: 'galan', name: 'Galan', team_side: 'B_GAU' }],
    });
    expect(plan.invites.map(i => i.player_id)).toEqual(['binome']);
    expect(plan.status).toBe('draft');
  });

  it("le siege adverse libre reste libre : une seule cible, une seule ligne", () => {
    const plan = defiCreationPlan({
      gameType: 'Défi',
      isTargeted: true,
      players: [...moiEtBinome, { id: 'galan', name: 'Galan', team_side: 'B_GAU' }],
    });
    expect(plan.targetPlayers).toHaveLength(1);
  });

  it("sans adversaire designe, rien n est note et le defi part ouvert", () => {
    const plan = defiCreationPlan({ gameType: 'Défi', isTargeted: false, players: moiEtBinome });
    expect(plan.targetPlayers).toBeNull();
  });
});
