// Garde-fou : `expo-location` ne se nomme QUE dans lib/location.ts.
//
// C'est un module natif. Un APK construit avant son ajout ne le contient pas :
// un import direct ferait planter l'app au démarrage chez tous ceux qui n'ont
// pas encore la nouvelle version. lib/location.ts vérifie d'abord que le
// module natif existe, et ne charge le code qu'ensuite.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const DIRS = ['app', 'components', 'hooks', 'lib'];
const AUTORISE = join('lib', 'location.ts');
const NOM = /['"]expo-location['"]/;

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

describe('expo-location chargé prudemment', () => {
  it('la détection attrape un import direct (test du test)', () => {
    expect(NOM.test("import * as Location from 'expo-location';")).toBe(true);
    expect(NOM.test('const L = require("expo-location");')).toBe(true);
    expect(NOM.test('// expo-location est chargé plus bas')).toBe(false);
  });

  it('aucun autre fichier ne nomme le module', () => {
    const fautifs = DIRS.flatMap(d => fichiers(join(ROOT, d)))
      .filter(p => relative(ROOT, p) !== AUTORISE)
      .filter(p => NOM.test(readFileSync(p, 'utf8')))
      .map(p => relative(ROOT, p));
    expect(fautifs).toEqual([]);
  });

  it('lib/location.ts vérifie le module natif AVANT de charger le code', () => {
    const src = readFileSync(join(ROOT, AUTORISE), 'utf8');
    const verification = src.indexOf("requireOptionalNativeModule('ExpoLocation')");
    const chargement = src.indexOf("require('expo-location')");
    expect(verification).toBeGreaterThan(-1);
    expect(chargement).toBeGreaterThan(verification);
  });
});
