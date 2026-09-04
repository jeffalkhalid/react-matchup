import { describe, it, expect } from 'vitest';
import { nextTournamentAction, type Tournament, type TournamentStatus } from '../tournaments';

const t = (status: TournamentStatus, current_round = 0, round_count = 6, court_count = 4): Tournament =>
  ({ id: 'T', name: 'T', club_id: null, starts_at: '2026-09-11T18:00:00Z', ends_at: null,
     level_min: null, level_max: null, court_count, round_count, price_mad: 0,
     forfeit_games: 0, status, current_round, created_by: 'o', created_at: '2026-09-01T00:00:00Z' } as Tournament);

describe("l'action du moment sur un tournoi", () => {
  it('propose le geste attendu a chaque etape', () => {
    expect(nextTournamentAction(t('COMPLET'), 8).label).toBe('Ouvrir le pointage');
    expect(nextTournamentAction(t('CHECK_IN'), 8).label).toBe('Démarrer le tournoi');
    expect(nextTournamentAction(t('PRET'), 8).label).toBe('Démarrer le tournoi');
    expect(nextTournamentAction(t('TERMINE'), 8).label).toBe('Valider le classement');
  });

  it('compte le tour SUIVANT, jamais celui qui vient d etre joue', () => {
    // Le piege : afficher « Generer le tour 3 » quand le 3 est deja joue
    // enverrait l organisateur refaire ce qui est fait.
    expect(nextTournamentAction(t('EN_COURS', 0), 8).label).toBe('Générer le tour 1');
    expect(nextTournamentAction(t('EN_COURS', 3), 8).label).toBe('Générer le tour 4');
  });

  it('un tournoi annule ne propose AUCUNE action', () => {
    const a = nextTournamentAction(t('ANNULE'), 8);
    expect(a.label).toBeNull();
    expect(a.subtitle).toContain('annulé');
  });

  it('un classement valide ne propose plus qu une lecture', () => {
    const a = nextTournamentAction(t('CLASSEMENT_VALIDE'), 8);
    expect(a.label).toBe('Voir le classement');
    expect((a as any).tone).toBe('dark');   // disponible, pas urgent
  });

  it('le sous-titre dit toujours POURQUOI l action est proposee', () => {
    expect(nextTournamentAction(t('INSCRIPTIONS_OUVERTES'), 5).subtitle).toContain('5 binômes sur 8');
    expect(nextTournamentAction(t('EN_COURS', 3), 8).subtitle).toContain('Rotation 3 sur 6');
    expect(nextTournamentAction(t('TERMINE'), 8).subtitle).toContain('en attente');
  });

  it('le format s adapte au nombre de terrains', () => {
    expect(nextTournamentAction(t('COMPLET', 0, 6, 2), 4).subtitle).toContain('4 binômes · 2 terrains');
  });
});
