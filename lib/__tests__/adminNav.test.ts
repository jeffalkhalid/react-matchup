import { describe, it, expect } from 'vitest';
import {
  GROUPS, ALL_TABS, HEADER_TABS, TAB_LABEL,
  groupOfTab, defaultTab, isDrillDown, subTabs,
  type AdminTab,
} from '../adminNav';

describe('l invariant : aucun onglet ne doit devenir injoignable', () => {
  it('TOUT onglet appartient a un groupe, sauf ceux de l en-tete', () => {
    // Un onglet oublie dans GROUPS existe, fonctionne, et personne ne peut
    // plus l'ouvrir. Ca ne se voit pas a la relecture, seulement a l'usage.
    const dansGroupes = GROUPS.flatMap(g => g.tabs);
    const attendus = ALL_TABS.filter(t => !HEADER_TABS.includes(t));
    expect([...dansGroupes].sort()).toEqual([...attendus].sort());
  });

  it('aucun onglet n est dans DEUX groupes', () => {
    const dansGroupes = GROUPS.flatMap(g => g.tabs);
    expect(new Set(dansGroupes).size).toBe(dansGroupes.length);
  });

  it('chaque onglet a un libelle', () => {
    for (const t of ALL_TABS) {
      expect(TAB_LABEL[t], `libelle manquant pour ${t}`).toBeTruthy();
    }
  });

  it('les quatre groupes du handoff, dans cet ordre', () => {
    expect(GROUPS.map(g => g.label)).toEqual(['File', 'Données', 'Config', 'Tournois']);
  });
});

describe('appartenance', () => {
  it('range chaque onglet ou il faut', () => {
    expect(groupOfTab('queue')).toBe('file');
    expect(groupOfTab('disputes')).toBe('file');
    expect(groupOfTab('players')).toBe('donnees');
    expect(groupOfTab('settings')).toBe('config');
    expect(groupOfTab('tournaments')).toBe('tournois');
  });

  it('le journal n appartient a AUCUN groupe : il vit dans l en-tete', () => {
    expect(groupOfTab('journal')).toBe(null);
  });
});

describe('point d entree d un groupe', () => {
  it('ouvre la FILE et non un ecran de moderation', () => {
    // Taper « File » doit rendre la file, pas le dernier litige consulte.
    expect(defaultTab('file')).toBe('queue');
  });

  it('donne le premier onglet des autres groupes', () => {
    expect(defaultTab('donnees')).toBe('frmt');
    expect(defaultTab('config')).toBe('badges');
    expect(defaultTab('tournois')).toBe('tournaments');
  });
});

describe('approfondissement', () => {
  it('les trois ecrans de moderation en sont, la file non', () => {
    // Sans ce retour, on descend dans un litige et plus rien ne dit
    // comment remonter a la file.
    expect(isDrillDown('disputes')).toBe(true);
    expect(isDrillDown('reports')).toBe(true);
    expect(isDrillDown('gender')).toBe(true);
    expect(isDrillDown('queue')).toBe(false);
  });

  it('un onglet d un autre groupe n en est pas un', () => {
    expect(isDrillDown('players')).toBe(false);
    expect(isDrillDown('journal')).toBe(false);
  });
});

describe('sous-onglets', () => {
  it('la FILE n en montre aucun : on y descend par les dossiers', () => {
    expect(subTabs('file')).toEqual([]);
  });

  it('un groupe a UN SEUL onglet n en montre aucun non plus', () => {
    // Une rangee d'un seul bouton est du bruit.
    expect(subTabs('tournois')).toEqual([]);
  });

  it('les groupes a plusieurs onglets les listent', () => {
    expect(subTabs('donnees')).toEqual(['frmt', 'players', 'games']);
    expect(subTabs('config')).toEqual(['badges', 'settings']);
  });
});
