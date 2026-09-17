// Décompte des matchs : les AMICAUX comptent (décision utilisateur 2026-09-16).
// Le bug d'origine : l'accueil disait 5 (compteurs classés du serveur) et la
// liste des matchs 6 (tout), pour le même joueur.
import { describe, it, expect, vi } from 'vitest';
// lib/playerStats importe le client Supabase (pour les requêtes) ; la
// fonction testée ici est pure, on neutralise donc la connexion.
vi.mock('../supabase', () => ({ supabase: {} }));
import { totalsFromMatches, EMPTY_TOTALS } from '../playerStats';

const MOI = 'moi';
const gagne = (second?: string) => ({ winner_id: MOI, winner_id_2: second ?? 'x', loser_id: 'a', loser_id_2: 'b' });
const perdu = () => ({ winner_id: 'a', winner_id_2: 'b', loser_id: MOI, loser_id_2: 'x' });

describe('totaux d’un joueur', () => {
  it('compte tous les matchs de la liste, sans distinction de type', () => {
    // 5 compétitifs + 1 amical = 6 : la liste ne porte pas le type, c'est
    // justement ce qui garantit qu'aucun match n'est écarté en douce.
    const t = totalsFromMatches([gagne(), gagne(), gagne(), gagne(), gagne(), gagne()], MOI);
    expect(t.played).toBe(6);
    expect(t.wins).toBe(6);
    expect(t.winRate).toBe(100);
  });

  it('sépare victoires et défaites', () => {
    const t = totalsFromMatches([gagne(), perdu(), gagne(), perdu()], MOI);
    expect(t).toEqual({ played: 4, wins: 2, losses: 2, winRate: 50 });
  });

  it('reconnaît le joueur en deuxième place de son camp', () => {
    const t = totalsFromMatches([{ winner_id: 'a', winner_id_2: MOI, loser_id: 'b', loser_id_2: 'c' }], MOI);
    expect(t.wins).toBe(1);
  });

  it('ignore les matchs où le joueur n’est pas', () => {
    const t = totalsFromMatches([{ winner_id: 'a', winner_id_2: 'b', loser_id: 'c', loser_id_2: 'd' }], MOI);
    expect(t).toEqual(EMPTY_TOTALS);
  });

  it('aucun match : 0 %, pas une division par zéro', () => {
    expect(totalsFromMatches([], MOI)).toEqual(EMPTY_TOTALS);
  });
});
