// « Qui joue déjà ce jour-là » — la fenêtre par JOURNÉE de la carte Dispos.
//
// Différente du ±2 h : la carte raisonne par jour. Un joueur invité à une
// partie de demain continuait d'y figurer comme libre, et on repartait monter
// un deuxième match avec les mêmes personnes.
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Ce que la fausse base rend, par table. Rempli par chaque test. */
const base: Record<string, any[]> = { game_participants: [], open_games: [] };
/** Les filtres appliqués, pour vérifier qu'on ne lit que le confirmé. */
const filtres: { table: string; col: string; val: unknown }[] = [];
let panne = false;

vi.mock('../supabase', () => {
  const requete = (table: string) => {
    const chaine: any = {
      select: () => chaine,
      in: () => chaine,
      eq: (col: string, val: unknown) => { filtres.push({ table, col, val }); return chaine; },
      then: (resolve: (r: any) => void) =>
        resolve(panne ? { data: null, error: { message: 'reseau' } } : { data: base[table] ?? [], error: null }),
    };
    return chaine;
  };
  return { supabase: { from: (table: string) => requete(table) } };
});

import { fetchEngagedInRange } from '../slotConflict';

const JOUR_DEBUT = new Date(2026, 8, 22, 8, 0, 0);   // mardi 22 sept., 8 h
const JOUR_FIN = new Date(2026, 8, 23, 0, 0, 0);     // mercredi 23, minuit
const iso = (h: number, jour = 22) => new Date(2026, 8, jour, h, 0, 0).toISOString();

const participation = (id: string, date: string | null, statut = 'open') => ({
  player_id: id, game: date == null ? null : { match_date: date, status: statut },
});
const partieCreee = (id: string, date: string | null, statut = 'open') => ({
  creator_id: id, match_date: date, status: statut,
});

beforeEach(() => {
  base.game_participants = [];
  base.open_games = [];
  filtres.length = 0;
  panne = false;
});

describe('fetchEngagedInRange — qui est déjà pris ce jour-là', () => {
  it('une participation dans la journée rend le joueur indisponible', async () => {
    base.game_participants = [participation('lebron', iso(19))];
    const pris = await fetchEngagedInRange(['lebron'], JOUR_DEBUT, JOUR_FIN);
    expect([...pris]).toEqual(['lebron']);
  });

  it("une partie la veille ou le lendemain ne compte pas", async () => {
    base.game_participants = [participation('lebron', iso(19, 21)), participation('rita', iso(10, 23))];
    expect((await fetchEngagedInRange(['lebron', 'rita'], JOUR_DEBUT, JOUR_FIN)).size).toBe(0);
  });

  it("le CRÉATEUR compte aussi — il n'a pas de ligne de participation", async () => {
    // Le piège récurrent : ne lire que game_participants laisse
    // l'organisateur passer pour libre à sa propre heure.
    base.open_games = [partieCreee('alamine', iso(14))];
    expect([...await fetchEngagedInRange(['alamine'], JOUR_DEBUT, JOUR_FIN)]).toEqual(['alamine']);
  });

  it('une partie annulée ou scorée ne prend plus personne', async () => {
    base.game_participants = [participation('lebron', iso(19), 'cancelled')];
    base.open_games = [partieCreee('alamine', iso(14), 'closed')];
    expect((await fetchEngagedInRange(['lebron', 'alamine'], JOUR_DEBUT, JOUR_FIN)).size).toBe(0);
  });

  it('on ne lit que les participations acceptées', async () => {
    await fetchEngagedInRange(['lebron'], JOUR_DEBUT, JOUR_FIN);
    expect(filtres).toContainEqual({ table: 'game_participants', col: 'status', val: 'accepted' });
  });

  it('une partie sans date ne prend personne', async () => {
    base.game_participants = [participation('lebron', null)];
    base.open_games = [partieCreee('alamine', null)];
    expect((await fetchEngagedInRange(['lebron', 'alamine'], JOUR_DEBUT, JOUR_FIN)).size).toBe(0);
  });

  it("le début de la fenêtre compte, la fin non — minuit appartient au jour d'après", async () => {
    base.game_participants = [participation('debut', JOUR_DEBUT.toISOString()), participation('fin', JOUR_FIN.toISOString())];
    expect([...await fetchEngagedInRange(['debut', 'fin'], JOUR_DEBUT, JOUR_FIN)]).toEqual(['debut']);
  });

  it('sans joueur à vérifier, aucune requête à faire', async () => {
    expect((await fetchEngagedInRange([], JOUR_DEBUT, JOUR_FIN)).size).toBe(0);
    expect(filtres).toEqual([]);
  });

  it('une fenêtre vide ou à l’envers ne marque personne', async () => {
    base.game_participants = [participation('lebron', iso(19))];
    expect((await fetchEngagedInRange(['lebron'], JOUR_FIN, JOUR_DEBUT)).size).toBe(0);
  });

  it('en cas de panne réseau, personne n’est marqué pris', async () => {
    // Mieux vaut laisser inviter — le serveur refusera le chevauchement —
    // que de griser tout le monde sur une erreur passagère.
    panne = true;
    base.game_participants = [participation('lebron', iso(19))];
    expect((await fetchEngagedInRange(['lebron'], JOUR_DEBUT, JOUR_FIN)).size).toBe(0);
  });
});
