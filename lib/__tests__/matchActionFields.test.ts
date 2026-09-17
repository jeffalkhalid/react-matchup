// Garde-fou : une requête qui alimente `matchNeedsMyAction` DOIT ramener
// `validation_opens_at`.
//
// Le bug (2026-09-16) : la cloche listait ses colonnes à la main sans cette
// date. Une date absente signifie « score d'avant la règle, donc ouvert » — la
// cloche annonçait donc un score à valider que le lobby masquait encore, et le
// joueur tombait sur un écran disant que tout était validé.
//
// Le test lit le code : tout fichier qui importe `matchNeedsMyAction` et qui
// écrit une liste de colonnes de `matches` doit soit tout prendre (`*`), soit
// passer par la constante partagée MATCH_ACTION_FIELDS.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { MATCH_ACTION_FIELDS } from '../matches';

const ROOT = join(__dirname, '..', '..');
const DIRS = ['app', 'lib', 'components', 'hooks'];

/** Le contenu de chaque `.select( … )` du fichier, guillemets retirés.
 *  Pas de classe de caractères contenant un accent grave : écrite ainsi, elle
 *  est mal transformée ici et la recherche ne trouvait plus rien — le test
 *  passait alors que le bug était sous son nez. */
const SELECT_RE = /\.select\(([\s\S]{0,400}?)\)/g;
const BACKTICK = String.fromCharCode(96);
const sansGuillemets = (s: string) =>
  s.split(BACKTICK).join('').split("'").join('').split('"').join('');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** Les listes de colonnes écrites à la main qui alimentent la règle. */
function selectsFautifs(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(SELECT_RE)) {
    const cols = sansGuillemets(m[1]);
    // La règle lit le statut ET les quatre places : une requête sans `status`
    // ne l'alimente pas (ex. « Rejouer », qui ne veut que les équipes).
    if (!cols.includes('winner_id') || !cols.includes('status')) continue;
    if (cols.includes('*')) continue;                       // tout est pris
    if (cols.includes('validation_opens_at')) continue;     // explicite
    if (cols.includes('MATCH_ACTION_FIELDS')) continue;     // constante partagée
    out.push(cols.slice(0, 70));
  }
  return out;
}

describe('colonnes nécessaires à « ce match attend-il une action de moi ? »', () => {
  it('la constante partagée porte l’heure d’ouverture', () => {
    for (const col of ['status', 'created_by', 'winner_id', 'winner_id_2', 'loser_id', 'loser_id_2', 'validation_opens_at']) {
      expect(MATCH_ACTION_FIELDS).toContain(col);
    }
  });

  it('la détection reconnaît une liste de colonnes incomplète', () => {
    // Garde du garde-fou : sans cette vérification, une expression régulière
    // cassée ferait passer le test à vide (c'est arrivé en l'écrivant).
    const ancienneCloche = ".select('id, status, winner:winner_id(name), created_by, winner_id, winner_id_2, loser_id, loser_id_2')";
    expect(selectsFautifs(ancienneCloche)).toHaveLength(1);
    const corrigee = ".select(`${MATCH_ACTION_FIELDS}, winner:winner_id(name)`)";
    expect(selectsFautifs(corrigee)).toEqual([]);
    expect(selectsFautifs(".select('winner_id, loser_id, game_format')")).toEqual([]);
  });

  it('aucun écran ne redéfinit ces colonnes à la main sans l’heure d’ouverture', () => {
    const fautifs: string[] = [];
    for (const dir of DIRS) {
      for (const file of sourceFiles(join(ROOT, dir))) {
        const code = readFileSync(file, 'utf8');
        if (!code.includes('matchNeedsMyAction')) continue;
        for (const cols of selectsFautifs(code)) {
          fautifs.push(relative(ROOT, file).split(sep).join('/') + ' -> select(' + cols + ')');
        }
      }
    }
    expect(fautifs).toEqual([]);
  });
});
