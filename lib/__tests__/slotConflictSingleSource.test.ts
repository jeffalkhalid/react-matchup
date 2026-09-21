// Garde-fou : la fenêtre « déjà pris à cette heure-là » ne s'écrit qu'une fois.
//
// La règle a été recopiée à la main trois fois (assistant de création, lobby,
// onglet Défi) avant d'atterrir dans lib/slotConflict. Chaque copie a fini par
// diverger en silence : l'onglet Défi ignorait encore les parties ORGANISÉES,
// si bien que l'organisateur d'une partie à 14 h était proposé comme binôme
// pour un défi à 14 h — jusqu'à ce que le serveur refuse, bien plus tard.
//
// Deux contrôles : plus aucune fenêtre de 2 h écrite en dur, et les deux écrans
// qui choisissent des joueurs passent bien par la fonction partagée.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const DIRS = ['app', 'components', 'hooks', 'lib'];
const AUTORISE = join('lib', 'slotConflict.ts');

/** 2 h en millisecondes, sous les formes qu'on écrit spontanément. */
const DEUX_HEURES = /2\s*\*\s*60\s*\*\s*60\s*\*\s*1000|\b7200000\b|120\s*\*\s*60\s*\*\s*1000/;

/** Les écrans où l'on désigne un joueur pour un créneau donné. */
const CHOISISSENT_DES_JOUEURS = [
  join('app', '(tabs)', 'CreateWizard.tsx'),
  join('app', '(tabs)', 'matchmaking.tsx'),
];

function fichiers(dir: string): string[] {
  const out: string[] = [];
  for (const nom of readdirSync(dir)) {
    if (nom === 'node_modules' || nom === '__tests__' || nom.startsWith('.')) continue;
    const p = join(dir, nom);
    if (statSync(p).isDirectory()) out.push(...fichiers(p));
    else if (p.endsWith('.tsx') || p.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('la fenêtre de chevauchement a une seule source', () => {
  it('la détection attrape les écritures en dur (test du test)', () => {
    expect(DEUX_HEURES.test('if (ecart < 2 * 60 * 60 * 1000) pris.add(id);')).toBe(true);
    expect(DEUX_HEURES.test('const FENETRE = 7200000;')).toBe(true);
    expect(DEUX_HEURES.test('const FENETRE = 120 * 60 * 1000;')).toBe(true);
    // Ce qu'il ne faut PAS confondre : la durée de jeu et la marge, qui vivent
    // dans lib/slotConflict et s'additionnent pour donner la fenêtre.
    expect(DEUX_HEURES.test('const MATCH_DURATION_MS = 90 * 60 * 1000;')).toBe(false);
    expect(DEUX_HEURES.test('overlapsSlot(Date.parse(g.match_date), slotTs)')).toBe(false);
  });

  it('aucun fichier ne réécrit la fenêtre en dur', () => {
    const fautifs = DIRS.flatMap(d => fichiers(join(ROOT, d)))
      .filter(p => relative(ROOT, p) !== AUTORISE)
      .filter(p => DEUX_HEURES.test(readFileSync(p, 'utf8')))
      .map(p => relative(ROOT, p));
    expect(fautifs).toEqual([]);
  });

  it('les écrans qui choisissent un joueur passent par la fonction partagée', () => {
    const sans = CHOISISSENT_DES_JOUEURS.filter(rel => {
      const src = readFileSync(join(ROOT, rel), 'utf8');
      return !/fetchBusyPlayerIds/.test(src);
    });
    expect(sans).toEqual([]);
  });

  it('la fonction partagée lit AUSSI les parties organisées', () => {
    const src = readFileSync(join(ROOT, AUTORISE), 'utf8');
    expect(src).toMatch(/from\('game_participants'\)/);
    expect(src).toMatch(/from\('open_games'\)/);
    expect(src).toMatch(/busyCreatorIds/);
  });
});
