// La bande de niveau d'un défi : une règle, deux écrans qui choisissent un
// binôme.
//
// « Choisis ton binôme » (hub Défi) l'appliquait. « Amène ton partenaire »
// (relève d'un défi nominatif) ne la connaissait pas : on pouvait y amener un
// joueur de niveau 2,5 sur un défi 4,2–4,8. Le serveur ne dit rien — la règle
// ne vit que dans les écrans, donc chaque écran doit la porter.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

const CHOISISSENT_UN_BINOME = [
  join('app', '(tabs)', 'matchmaking.tsx'),
  join('components', 'InvitePartnerSheet.tsx'),
];

describe('c est la MOYENNE du duo qui doit tenir dans la bande', () => {
  it('les deux sélecteurs passent par la fonction partagée', () => {
    // `isBinomeEligible` (lib/defis) porte la règle. Recopier « avg >= min &&
    // avg <= max » à la main, c'est se préparer à la voir diverger.
    const sans = CHOISISSENT_UN_BINOME.filter(rel => {
      const src = readFileSync(join(ROOT, rel), 'utf8');
      return !src.includes('isBinomeEligible');
    });
    expect(sans).toEqual([]);
  });
});
