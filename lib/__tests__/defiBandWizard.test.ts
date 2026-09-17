// Garde-fou de l'assistant de création : la fourchette de niveau ne doit plus
// pouvoir se refermer sur elle-même.
//
// Le défi vu sur device le 2026-09-16 avait minimum = maximum : les molettes
// bornaient chaque extrémité sur l'AUTRE extrémité (`Math.max(form.minLevel, …)`
// pour le maximum, `Math.max(defiFloorLevel, …)` pour le plafond adverse), si
// bien qu'on pouvait les coller. Résultat : un défi publié que personne ne peut
// relever, et un refus serveur en anglais à l'acceptation.
//
// Ce test lit le code de l'assistant et refuse le retour de ces bornes.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, '..', '..', 'app', '(tabs)', 'CreateWizard.tsx'), 'utf8');

describe('assistant de création : fourchette de niveau', () => {
  it('ne borne jamais une extrémité sur l’autre', () => {
    const interdits = [
      'Math.min(form.maxLevel,',      // le minimum pouvait monter jusqu'au maximum
      'Math.max(form.minLevel,',      // le maximum pouvait descendre jusqu'au minimum
      'Math.max(defiFloorLevel,',     // le plafond adverse pouvait descendre au plancher
    ];
    expect(interdits.filter(p => SRC.includes(p))).toEqual([]);
  });

  it('s’appuie sur la largeur minimale partagée (lib/defis)', () => {
    expect(SRC).toContain("from '../../lib/defis'");
    expect(SRC).toContain('DEFI_BAND_MIN_LEVEL');
    expect(SRC).toContain('defiMinimumMaxLevel');
    expect(SRC).toContain('isDefiBandWideEnough');
  });
});
