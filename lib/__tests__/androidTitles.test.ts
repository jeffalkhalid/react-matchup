// lib/__tests__/androidTitles.test.ts — garde-fou des titres sur Android.
//
// Les titres en police italique condensée (`Fonts.welcome`, alias
// `PFonts.barlow`) se font couper sur Android dès que la police du téléphone
// est agrandie ou l'écran étroit. Les pièges ont été trouvés un par un sur des
// téléphones de testeurs, corrigés à la main — et réintroduits ailleurs par le
// code écrit ensuite. Ce test lit le code des écrans et REFUSE les réglages
// connus pour casser, avant qu'ils n'arrivent sur un téléphone.
//
// Le remède, dans chaque cas : components/DisplayTitle.tsx.
//
// Règles :
//   majuscules-auto          `textTransform: 'uppercase'` sur cette police.
//                            Android mesure avant la transformation et coupe
//                            les dernières lettres. → écrire les majuscules
//                            dans le texte (DisplayTitle `uppercase`).
//   retrecir-texte-imbrique  `adjustsFontSizeToFit` sur un titre qui contient
//                            un <Text> imbriqué : sans effet sur Android, le
//                            titre passe à la ligne et la 2e ligne disparaît.
//                            → numberOfLines={2}, ou un seul segment.
//   marge-italique           titre sur UNE ligne sans marge à droite :
//                            l'italique déborde et le dernier glyphe est rogné.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse } from '@babel/parser';

const ROOT = join(__dirname, '..', '..');
const DIRS = ['app', 'components'];
/** Rendus en IMAGE exportée (Stories, affiches) : jamais mis en page à l'écran. */
const IGNORED = [/StoryCanvas/, /TournamentShareCard/, /[\\/]bilan[\\/]slides[\\/]/, /Story(Styles|Primitives)/];
const TITLE_FONT = /\bP?Fonts\.(welcome|barlow)\b/;

type Rule = 'majuscules-auto' | 'retrecir-texte-imbrique' | 'marge-italique';
type Finding = { where: string; rule: Rule };

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsxFiles(p));
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

function scan(file: string): Finding[] {
  const code = readFileSync(file, 'utf8');
  const ast: any = parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  const src = (n: any) => code.slice(n.start, n.end);
  const rel = relative(ROOT, file).replace(/\\/g, '/');

  // Styles déclarés en constante dans le fichier : `NOM` → source,
  // `NOM.cle` → source de la clé (objets simples et StyleSheet.create).
  const consts = new Map<string, string>();
  for (const stmt of ast.program.body) {
    const decl = stmt.type === 'ExportNamedDeclaration' ? stmt.declaration : stmt;
    if (!decl || decl.type !== 'VariableDeclaration') continue;
    for (const d of decl.declarations) {
      if (d.id.type !== 'Identifier' || !d.init) continue;
      consts.set(d.id.name, src(d.init));
      let obj = d.init;
      if (obj.type === 'TSAsExpression' || obj.type === 'TSSatisfiesExpression') obj = obj.expression;
      if (obj.type === 'CallExpression' && obj.arguments[0]?.type === 'ObjectExpression') obj = obj.arguments[0];
      if (obj.type !== 'ObjectExpression') continue;
      for (const p of obj.properties) {
        if (p.type !== 'ObjectProperty') continue;
        const key = p.key.type === 'Identifier' ? p.key.name : p.key.type === 'StringLiteral' ? p.key.value : null;
        if (key) consts.set(`${d.id.name}.${key}`, src(p.value));
      }
    }
  }
  const resolveStyle = (s: string): string => {
    let out = s;
    for (const m of s.matchAll(/\b([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?/g)) {
      const full = m[2] ? `${m[1]}.${m[2]}` : m[1];
      const hit = consts.get(full) ?? (m[2] ? undefined : consts.get(m[1]));
      if (hit) out += '\n' + hit;
    }
    return out;
  };

  const findings: Finding[] = [];
  const check = (el: any) => {
    const open = el.openingElement;
    if (open.name.type !== 'JSXIdentifier' || open.name.name !== 'Text') return;
    const attr = (name: string) =>
      open.attributes.find((a: any) => a.type === 'JSXAttribute' && a.name.name === name);
    // Texte de MESURE (FitTitle) : invisible, et sans marge par nécessité.
    const testId = attr('testID');
    if (testId?.value && /fit-measure/.test(src(testId.value))) return;
    const style = attr('style');
    if (!style?.value) return;
    const styleSrc = resolveStyle(src(style.value));
    if (!TITLE_FONT.test(styleSrc)) return;
    const where = `${rel}:${open.loc.start.line}`;

    if (/textTransform:\s*['"]uppercase['"]/.test(styleSrc)) findings.push({ where, rule: 'majuscules-auto' });

    const fit = attr('adjustsFontSizeToFit');
    const fitValue = fit?.value ? src(fit.value) : '';
    const fitOnAndroid = !!fit && !/Platform\.OS\s*===\s*['"]ios['"]/.test(fitValue) && !/^\{\s*false\s*\}$/.test(fitValue);
    const nested = el.children.some((c: any) => c.type === 'JSXElement');
    if (fitOnAndroid && nested) findings.push({ where, rule: 'retrecir-texte-imbrique' });

    const lines = attr('numberOfLines');
    const oneLine = lines?.value?.type === 'JSXExpressionContainer'
      && lines.value.expression.type === 'NumericLiteral' && lines.value.expression.value === 1;
    if (oneLine && !/\bpadding(Right|Horizontal)?\s*:/.test(styleSrc)) findings.push({ where, rule: 'marge-italique' });
  };
  const walk = (node: any) => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'JSXElement') check(node);
    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'start' || k === 'end' || k === 'extra') continue;
      const v = node[k];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') walk(v);
    }
  };
  walk(ast.program);
  return findings;
}

const all = DIRS
  .flatMap(d => tsxFiles(join(ROOT, d)))
  .filter(f => !IGNORED.some(r => r.test(f)))
  .flatMap(scan);
const byRule = (rule: Rule) => all.filter(f => f.rule === rule).map(f => f.where);

describe('titres en police italique : réglages qui cassent sur Android', () => {
  it('le scanner trouve bien les titres (sinon il ne vérifie rien)', () => {
    // Garde du garde-fou : si la détection de la police cassait, tous les
    // tests passeraient à vide.
    const scanned = scan(join(ROOT, 'components', 'DisplayTitle.tsx'));
    expect(scanned).toEqual([]);
    const withTitles = DIRS.flatMap(d => tsxFiles(join(ROOT, d)))
      .filter(f => TITLE_FONT.test(readFileSync(f, 'utf8')));
    expect(withTitles.length).toBeGreaterThan(20);
  });

  it('pas de majuscules automatiques (textTransform) — écrire les majuscules dans le texte', () => {
    expect(byRule('majuscules-auto')).toEqual([]);
  });

  it('pas de rétrécissement automatique sur un titre à texte imbriqué — numberOfLines={2} ou un seul segment', () => {
    expect(byRule('retrecir-texte-imbrique')).toEqual([]);
  });

  it('un titre sur une ligne garde une marge à droite (débord de l’italique)', () => {
    expect(byRule('marge-italique')).toEqual([]);
  });
});
