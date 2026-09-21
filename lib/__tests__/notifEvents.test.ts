// Cartes de la cloche : binôme groupé, promotion de défi, événements serveur.
import { describe, it, expect, vi } from 'vitest';
vi.mock('../supabase', () => ({ supabase: {} }));

import {
  buildJoinedItems, eventToItem, lockedDefiItem, participationsCoveredByEvents, eventIcon,
  type JoinedRow, type NotificationEventRow,
} from '../notifEvents';

const T = '2026-09-17T10:00:00.000Z';
const defi = new Map([['g1', { location: 'Padel 4 Maroc', is_challenge: true }]]);
const partie = new Map([['g2', { location: 'COC Padel', is_challenge: false }]]);

const row = (id: string, over: Partial<JoinedRow> = {}): JoinedRow => ({
  id, game_id: 'g1', player_id: `p-${id}`, approvals: [], created_at: T,
  team_side: 'B_GAU', player: { name: id }, ...over,
});

describe('binôme adverse : une seule carte', () => {
  it('regroupe les deux membres inscrits au même instant', () => {
    const items = buildJoinedItems([row('Karim'), row('Sofia', { team_side: 'B_DRO' })], defi);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('⚔️ Nouveau binôme adverse');
    expect(items[0].subtitle).toBe('Karim & Sofia relèvent le défi à Padel 4 Maroc');
  });

  it("l'identifiant ne dépend pas de l'ordre de lecture (suppression persistante)", () => {
    const a = buildJoinedItems([row('Karim'), row('Sofia')], defi)[0].id;
    const b = buildJoinedItems([row('Sofia'), row('Karim')], defi)[0].id;
    expect(a).toBe(b);
  });

  it('deux binômes à des instants différents restent deux cartes', () => {
    const items = buildJoinedItems([
      row('Karim'), row('Sofia'),
      row('Omar', { created_at: '2026-09-17T11:00:00.000Z' }), row('Nadia', { created_at: '2026-09-17T11:00:00.000Z' }),
    ], defi);
    expect(items.map(i => i.subtitle)).toEqual([
      'Karim & Sofia relèvent le défi à Padel 4 Maroc',
      'Omar & Nadia relèvent le défi à Padel 4 Maroc',
    ]);
  });

  it('le partenaire du créateur (côté A) garde sa carte individuelle, qui dit « défi »', () => {
    const items = buildJoinedItems([row('pagpag', { team_side: 'A_DRO' })], defi);
    expect(items[0].title).toBe('👋 Nouveau joueur');
    expect(items[0].subtitle).toBe('pagpag a rejoint le défi à Padel 4 Maroc');
  });

  it('une partie normale ne regroupe rien', () => {
    const items = buildJoinedItems(
      [row('A', { game_id: 'g2' }), row('B', { game_id: 'g2' })], partie);
    expect(items.map(i => i.subtitle)).toEqual(['A a rejoint la partie à COC Padel', 'B a rejoint la partie à COC Padel']);
  });
});

describe('binôme retenu', () => {
  it('promu de la file : le dit', () => {
    const it0 = lockedDefiItem({ id: 'a1', game_id: 'g1', queued_at: T, game: { location: 'Padel 4 Maroc' } });
    expect(it0.title).toBe('⚔️ Vous avez rejoint le défi');
    expect(it0.subtitle).toBe("Une place s'est libérée. Votre binôme relève le défi à Padel 4 Maroc — rendez-vous sur le terrain !");
  });

  it('verrouillé directement : pas de « place libérée »', () => {
    const it0 = lockedDefiItem({ id: 'a1', game_id: 'g1', queued_at: null, game: { location: 'Padel 4 Maroc' } });
    expect(it0.title).toBe('⚔️ Défi confirmé');
    expect(it0.subtitle).not.toContain('libérée');
  });
});

describe('événements serveur', () => {
  const ev = (over: Partial<NotificationEventRow>): NotificationEventRow => ({
    id: 'e1', kind: 'defi_binome_left', title: 'T', body: 'B', route: '/(tabs)/matchmaking',
    game_id: 'g1', ref: null, created_at: T, ...over,
  });

  it("une annulation s'affiche comme une annulation, le reste comme une info", () => {
    expect(eventToItem(ev({ kind: 'defi_cancelled' })).type).toBe('cancelled');
    expect(eventToItem(ev({ kind: 'defi_reopened' })).type).toBe('joined');
  });

  it('une promotion de liste d\'attente ne double pas la carte « Nouveau joueur »', () => {
    const couverts = participationsCoveredByEvents([ev({ kind: 'joined_from_waitlist', ref: 'part-9' })]);
    const items = buildJoinedItems(
      [row('X', { id: 'part-9', game_id: 'g2' }), row('Y', { id: 'part-10', game_id: 'g2' })],
      partie, couverts);
    expect(items.map(i => i.id)).toEqual(['joined-part-10']);
  });
});

describe("l icone dit ce que la carte raconte", () => {
  // Toutes ces cartes portent le type « joined » — leur COMPORTEMENT (info
  // supprimable). L ecran en tirait une medaille, celle des trophees.
  const evenement = (kind: string): NotificationEventRow => ({
    id: "e1", kind, title: "T", body: "B", route: null,
    game_id: "g1", ref: null, created_at: T,
  });

  it("une arrivee montre des joueurs, jamais une medaille", () => {
    const items = buildJoinedItems(
      [{ id: "p1", game_id: "g2", player_id: "u1", created_at: T, player: { name: "Rita" } }],
      partie,
    );
    expect(items[0].icon).toBe("users");
    expect(items[0].icon).not.toBe("medal");
  });

  it("un binome adverse montre les fers croises", () => {
    const rows: JoinedRow[] = [
      { id: "p1", game_id: "g1", player_id: "u1", created_at: T, team_side: "B0", player: { name: "Karim" } },
      { id: "p2", game_id: "g1", player_id: "u2", created_at: T, team_side: "B1", player: { name: "Sofia" } },
    ];
    expect(buildJoinedItems(rows, defi)[0].icon).toBe("swords");
  });

  it("un defi confirme montre les fers croises, pas une medaille", () => {
    const item = lockedDefiItem({ id: "a1", game_id: "g1", game: { location: "Padel 4 Maroc" } });
    expect(item.icon).toBe("swords");
    expect(item.icon).not.toBe("medal");
  });

  it("un depart et une annulation ne se ressemblent pas", () => {
    expect(eventIcon("defi_binome_left")).toBe("logOut");
    expect(eventIcon("defi_cancelled")).toBe("x");
    expect(eventIcon("defi_binome_left")).not.toBe(eventIcon("defi_cancelled"));
  });

  it("une promotion reste une arrivee", () => {
    expect(eventIcon("promoted")).toBe("users");
    expect(eventIcon("joined_from_waitlist")).toBe("users");
  });

  it("un genre inconnu retombe sur la cloche plutot que sur un trophee", () => {
    expect(eventIcon("quelque_chose_de_neuf")).toBe("bell");
  });

  it("l evenement serveur emporte son icone", () => {
    expect(eventToItem(evenement("defi_cancelled")).icon).toBe("x");
    expect(eventToItem(evenement("defi_reopened")).icon).toBe("repeat");
  });
});
