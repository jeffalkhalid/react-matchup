import { describe, it, expect, vi } from 'vitest';
vi.mock('../supabase', () => ({ supabase: {} }));
import { invitingDuo, invitationTitle, invitationDatePill } from '../hubInvitation';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const p = (id: string, name: string) => ({ id, name } as any);

describe('invitingDuo — qui invite, pour le titre de la carte', () => {
  it('le créateur + le premier autre joueur confirmé (hors moi)', () => {
    const game = {
      creator_id: 'yassir', creator: p('yassir', 'Yassir B.'),
      participants: [
        { player_id: 'me', status: 'invited', player: p('me', 'Moi') },
        { player_id: 'kenza', status: 'accepted', player: p('kenza', 'Kenza E.') },
      ],
    };
    const duo = invitingDuo(game, 'me');
    expect(duo.map(x => x.id)).toEqual(['yassir', 'kenza']);
  });

  it('ne montre que le créateur si personne d\'autre n\'est confirmé', () => {
    const game = {
      creator_id: 'yassir', creator: p('yassir', 'Yassir B.'),
      participants: [{ player_id: 'me', status: 'invited', player: p('me', 'Moi') }],
    };
    expect(invitingDuo(game, 'me').map(x => x.id)).toEqual(['yassir']);
  });

  it('exclut le spectateur lui-même même s\'il apparaît accepté (garde-fou)', () => {
    const game = {
      creator_id: 'yassir', creator: p('yassir', 'Yassir B.'),
      participants: [{ player_id: 'me', status: 'accepted', player: p('me', 'Moi') }],
    };
    expect(invitingDuo(game, 'me').map(x => x.id)).toEqual(['yassir']);
  });
});

describe('invitationTitle — le titre « X & Y cherchent un 4e »', () => {
  it('deux joueurs → forme plurielle avec prénoms', () => {
    expect(invitationTitle([p('a', 'Yassir Benali'), p('b', 'Kenza El Amrani')]))
      .toBe('Yassir & Kenza cherchent un 4ᵉ');
  });
  it('un seul joueur → forme singulière', () => {
    expect(invitationTitle([p('a', 'Yassir Benali')])).toBe('Yassir cherche un 4ᵉ');
  });
  it('aucun joueur → repli neutre', () => {
    expect(invitationTitle([])).toBe('On cherche un 4ᵉ');
  });
});

describe('invitationDatePill — « JEU. · 20H »', () => {
  it('jour abrégé + heure ronde', () => {
    // Jeudi 17 septembre 2026, 20h00.
    expect(invitationDatePill(new Date(2026, 8, 17, 20, 0).toISOString())).toBe('JEU. · 20H');
  });
  it('ajoute les minutes si l\'heure n\'est pas ronde', () => {
    expect(invitationDatePill(new Date(2026, 8, 17, 20, 30).toISOString())).toBe('JEU. · 20H30');
  });
});

describe("la requete ramene ce que la carte utilise", () => {
  // La carte lisait game.spots_available sans jamais le demander : un refus
  // repartait donc de 0 et ecrasait le vrai compte de places libres. Meme
  // piege pour la nature et la mise, affichees depuis.
  const source = readFileSync(join(__dirname, "..", "hubInvitation.ts"), "utf8");
  const requete = source.slice(source.indexOf("const SELECT"), source.indexOf("].join("));

  it.each(["spots_available", "game_format", "stake_multiplier", "is_challenge"])(
    "demande %s",
    (colonne) => { expect(requete).toContain(colonne); },
  );
});
