// Le signalement d'un score faux, entre la fin de la soirée et la validation.
// Les deux fonctions testées ici sont le MIROIR CÔTÉ ÉCRAN du garde-fou SQL
// de `tournament_reports.sql` : elles servent à ne pas proposer un geste que
// le serveur refusera, jamais à le remplacer.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../supabase', () => ({ supabase: {} }));

import { canReportNow, reportIssue } from '../tournamentReports';

describe('quand un score peut etre signale', () => {
  it('seulement entre la fin de la soiree et la validation', () => {
    // Avant : le desaccord a son propre chemin, l etat `litige`, qui BLOQUE
    // la rotation. Apres : les points sont credites, l ELO a bouge.
    expect(canReportNow('TERMINE')).toBe(true);
    expect(canReportNow('EN_COURS')).toBe(false);
    expect(canReportNow('CLASSEMENT_VALIDE')).toBe(false);
    expect(canReportNow('INSCRIPTIONS_OUVERTES')).toBe(false);
  });
});

describe('ce qui manque pour envoyer un signalement', () => {
  it('reclame les deux chiffres', () => {
    expect(reportIssue(null, null)).toMatch(/score/i);
    expect(reportIssue(6, null)).toMatch(/score/i);
  });

  it('refuse un nul, comme le reste du moteur', () => {
    // Sans vainqueur, la logique de mouvement ne sait pas qui monte. La regle
    // vient de `validateTournamentScore` — on ne la reecrit pas ici.
    expect(reportIssue(5, 5)).toBeTruthy();
    expect(reportIssue(6, 4)).toBe(null);
  });

  it('refuse un score aberrant', () => {
    expect(reportIssue(-1, 4)).toBeTruthy();
    expect(reportIssue(40, 4)).toBeTruthy();
  });
});
