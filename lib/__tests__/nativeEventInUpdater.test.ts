// Garde-fou : ne jamais lire `e.nativeEvent` DANS la fonction passée à setState.
//
// `setX(prev => … e.nativeEvent.layout.width …)` : la fonction s'exécute plus
// tard, pendant le rendu, quand React Native a déjà vidé l'événement. Résultat
// sur iPhone : « Cannot read property 'layout' of null », la fiche d'une partie
// disparaissait et l'écran restait figé (2026-09-17, components/DisplayTitle).
//
// Le bon geste : lire la valeur d'abord, `const w = e.nativeEvent.layout.width`,
// puis `setX(prev => (prev === w ? prev : w))`.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const DIRS = ['app', 'components', 'hooks'];
// Un appel setX( suivi d'une fonction fléchée dont le corps atteint nativeEvent
// sur la MÊME ligne (au-delà, la détection confondait des appels voisins).
const PIEGE = /set[A-Z]\w*\(\s*\(?\w+\)?\s*=>[^;\n]*?nativeEvent/g;

function fichiers(dir: string): string[] {
  const out: string[] = [];
  for (const nom of readdirSync(dir)) {
    if (nom === 'node_modules' || nom.startsWith('.')) continue;
    const p = join(dir, nom);
    if (statSync(p).isDirectory()) out.push(...fichiers(p));
    else if (p.endsWith('.tsx') || p.endsWith('.ts')) out.push(p);
  }
  return out;
}

export function trouverPieges(source: string): string[] {
  return [...source.matchAll(PIEGE)].map(m => m[0]);
}

describe('nativeEvent lu hors de la fonction de mise à jour', () => {
  it('la détection attrape bien le code fautif (test du test)', () => {
    const ancien = 'onLayout={e => setBoxWidth(w => (w === e.nativeEvent.layout.width ? w : e.nativeEvent.layout.width))}';
    const corrige = 'onLayout={e => { const lw = e.nativeEvent.layout.width; setBoxWidth(w => (w === lw ? w : lw)); }}';
    expect(trouverPieges(ancien)).toHaveLength(1);
    expect(trouverPieges(corrige)).toHaveLength(0);
  });

  it('aucun écran ne lit nativeEvent dans un setState différé', () => {
    const fautes: string[] = [];
    for (const d of DIRS) {
      for (const f of fichiers(join(ROOT, d))) {
        for (const m of trouverPieges(readFileSync(f, 'utf8'))) {
          fautes.push(`${relative(ROOT, f)} : ${m.slice(0, 90)}`);
        }
      }
    }
    expect(fautes).toEqual([]);
  });
});
