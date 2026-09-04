import { describe, it, expect } from 'vitest';
import {
  actionLabel, actionTone, actionSummary, timeLabel, dayLabel,
  groupByDay, nextCursor, type AdminAction,
} from '../adminLog';

const now = new Date(2026, 8, 4, 18, 30, 0);

const act = (over: Partial<AdminAction> = {}): AdminAction => ({
  id: over.id ?? 'a1',
  action: 'match_valide_force',
  entity_table: 'matches',
  entity_id: 'm1',
  details: {},
  created_at: now.toISOString(),
  actor_name: 'Arbitre',
  subject_name: null,
  subject_id: null,
  ...over,
});

describe('libelles', () => {
  it('traduit les codes connus', () => {
    expect(actionLabel('match_annule')).toBe('Match annulé');
    expect(actionLabel('frmt_bloque')).toBe('Revendication FRMT bloquée');
  });

  it('UN CODE INCONNU s affiche tel quel, il ne disparait pas', () => {
    // Le journal doit survivre a l'ajout d'un type d'action cote serveur :
    // une decision qu'on ne sait pas nommer reste une decision.
    expect(actionLabel('action_ajoutee_plus_tard')).toBe('action_ajoutee_plus_tard');
    expect(actionTone('action_ajoutee_plus_tard')).toBe('muted');
  });

  it('donne une couleur aux actions lourdes', () => {
    expect(actionTone('match_annule')).toBe('danger');
    expect(actionTone('frmt_lie')).toBe('success');
  });
});

describe('resume d une decision', () => {
  it('montre le score AVANT et APRES quand il a change', () => {
    const a = act({ details: { score_avant: '6-3, 7-5', score_apres: '6-3, 5-7' } });
    expect(actionSummary(a)).toBe('6-3, 7-5 → 6-3, 5-7');
  });

  it('NE MET PAS de fleche quand le score n a pas bouge', () => {
    // « 6-3, 7-5 → 6-3, 7-5 » remplirait le journal de fleches vides : on
    // annule un match sans toucher au score, c'est le cas le plus courant.
    const a = act({ details: { score_avant: '6-3, 7-5', score_apres: '6-3, 7-5' } });
    expect(actionSummary(a)).toBe('6-3, 7-5');
  });

  it('nomme le joueur concerne', () => {
    const a = act({
      action: 'frmt_bloque', entity_table: 'players',
      subject_name: 'Youssef', details: { nom: 'Youssef' },
    });
    expect(actionSummary(a)).toBe('Youssef');
  });

  it('retombe sur le nom du detail quand le joueur a ete supprime', () => {
    // subject_id est mis a NULL a la suppression du compte : le nom garde en
    // detail est alors la seule trace de qui etait concerne.
    const a = act({
      action: 'frmt_bloque', entity_table: 'players',
      subject_name: null, details: { nom: 'Compte supprimé' },
    });
    expect(actionSummary(a)).toBe('Compte supprimé');
  });

  it('traduit le genre en clair', () => {
    const a = act({
      action: 'genre_modifie', entity_table: 'players',
      subject_name: 'Sofia', details: { de: 'male', vers: 'female' },
    });
    expect(actionSummary(a)).toBe('Sofia · Homme → Femme');
  });

  it('ne casse pas sur des details absents', () => {
    expect(actionSummary(act({ details: null }))).toBe('');
  });
});

describe('dates', () => {
  it('donne l heure avec deux chiffres aux minutes', () => {
    expect(timeLabel(new Date(2026, 8, 4, 9, 5).toISOString())).toBe('9h05');
  });

  it('dit aujourd hui, hier, puis la date', () => {
    expect(dayLabel(new Date(2026, 8, 4, 2, 0).toISOString(), now)).toBe('Aujourd’hui');
    expect(dayLabel(new Date(2026, 8, 3, 23, 0).toISOString(), now)).toBe('Hier');
    expect(dayLabel(new Date(2026, 7, 28, 12, 0).toISOString(), now)).toMatch(/28 août/);
  });

  it('ne plante pas sur une date illisible', () => {
    expect(dayLabel('pas une date', now)).toBe('Date inconnue');
    expect(timeLabel('pas une date')).toBe('');
  });
});

describe('regroupement par journee', () => {
  it('regroupe et garde l ordre d arrivee dans chaque groupe', () => {
    const g = groupByDay([
      act({ id: '1', created_at: new Date(2026, 8, 4, 18, 0).toISOString() }),
      act({ id: '2', created_at: new Date(2026, 8, 4, 9, 0).toISOString() }),
      act({ id: '3', created_at: new Date(2026, 8, 3, 20, 0).toISOString() }),
    ], now);
    expect(g).toHaveLength(2);
    expect(g[0].label).toBe('Aujourd’hui');
    expect(g[0].items.map(i => i.id)).toEqual(['1', '2']);
    expect(g[1].label).toBe('Hier');
  });

  it('UNE DECISION DE 23 H reste dans sa journee locale', () => {
    // Piege du fuseau : une cle de jour construite sur toISOString ferait
    // basculer les decisions du soir sur le lendemain a l'est de Greenwich.
    const soir = new Date(2026, 8, 4, 23, 30).toISOString();
    const matin = new Date(2026, 8, 4, 7, 0).toISOString();
    const g = groupByDay([act({ id: 's', created_at: soir }), act({ id: 'm', created_at: matin })], now);
    expect(g).toHaveLength(1);
    expect(g[0].items.map(i => i.id)).toEqual(['s', 'm']);
  });

  it('une liste vide ne produit aucun groupe', () => {
    expect(groupByDay([], now)).toEqual([]);
  });
});

describe('pagination par curseur', () => {
  it('rend la date de la DERNIERE ligne, celle par ou continuer', () => {
    const vieux = new Date(2026, 8, 1, 10, 0).toISOString();
    const c = nextCursor([act({ id: '1' }), act({ id: '2', created_at: vieux })]);
    expect(c).toBe(vieux);
  });

  it('rend null quand il n y a plus rien', () => {
    expect(nextCursor([])).toBe(null);
  });
});
