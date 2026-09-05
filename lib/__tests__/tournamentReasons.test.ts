// Ancre de traduction des refus de tournoi.
//
// Les fonctions `tournament_*` refusent en rendant `{ok:false, reason:'...'}`.
// Un écran qui affiche `reason` sans traduction montre du code brut au joueur,
// et c'est un bug qui ne se voit QU'EN PRODUCTION : la raison en question ne
// sort que d'un chemin rare (course perdue, litige, forfait), jamais du chemin
// nominal qu'on teste à la main.
//
// Ce test ne relit PAS une liste recopiée : il relit LE FICHIER SQL, qui fait
// autorité, et exige une traduction pour chaque raison qu'il y trouve. Une
// tâche suivante qui ajoute un refus côté serveur sans le traduire fait donc
// tomber la suite, au lieu de livrer un libellé manquant.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { TOURNAMENT_REASONS, GENERIC_REASON, reasonLabel, hasReasonLabel } from '../tournamentReasons';

const MIGRATIONS = join(__dirname, '..', '..', 'supabase', 'migrations');

/**
 * Toutes les raisons littérales (`'reason', 'xxx'`) de TOUTES les migrations
 * tournoi.
 *
 * Ce test ne lisait que `tournaments_rpcs.sql`. Sa garantie — « un refus ajouté
 * côté serveur sans traduction fait tomber la suite » — ne tenait donc que
 * pour ce fichier-là : `tournament_round_minutes.sql` a ajouté
 * `invalid_round_minutes` et le test est resté vert. Il balaie maintenant
 * chaque migration dont le nom parle de tournoi.
 */
function reasonsFromSql(): string[] {
  const fichiers = readdirSync(MIGRATIONS)
    .filter(f => f.endsWith('.sql') && /tournament/i.test(f));
  const found = new Set<string>();
  for (const f of fichiers) {
    const src = readFileSync(join(MIGRATIONS, f), 'utf8');
    for (const m of src.matchAll(/'reason',\s*'([a-z_]+)'/g)) found.add(m[1]);
  }
  return [...found].sort();
}

describe('les refus serveur ont tous une formulation française', () => {
  const sqlReasons = reasonsFromSql();

  it('le fichier SQL est bien lu (garde-fou : un parse vide passerait sinon)', () => {
    // 46 refus au moment de l'écriture. Le test n'exige pas ce nombre exact —
    // la tâche 8 peut en ajouter — seulement qu'on ne soit pas tombé sur zéro
    // parce que le chemin ou la forme littérale aurait changé.
    expect(sqlReasons.length).toBeGreaterThanOrEqual(46);
    expect(sqlReasons).toContain('feature_disabled');
  });

  it.each(reasonsFromSql())('« %s » est traduit', (reason) => {
    expect(hasReasonLabel(reason)).toBe(true);
    const label = reasonLabel(reason);
    expect(label).not.toBe(GENERIC_REASON);
    expect(label).not.toContain('_');           // jamais le code brut
    expect(label.trim().length).toBeGreaterThan(0);
  });

  it('aucune traduction ne dort dans la table sans exister côté serveur', () => {
    // L'inverse du test précédent : une entrée orpheline signale une raison
    // renommée ou supprimée côté SQL, donc une table qui a dérivé.
    const inSql = new Set(sqlReasons);
    const orphans = Object.keys(TOURNAMENT_REASONS).filter(r => !inSql.has(r));
    expect(orphans).toEqual([]);
  });
});

describe('reasonLabel', () => {
  it('rend un texte lisible, jamais le code, sur une raison inconnue', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = reasonLabel('quelque_chose_de_neuf');
    expect(out).toBe(GENERIC_REASON);
    expect(out).not.toContain('quelque_chose_de_neuf');
    // …et le signale, sinon le trou resterait invisible.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('quelque_chose_de_neuf');
    warn.mockRestore();
  });

  it('rend le texte générique quand le serveur ne dit rien', () => {
    expect(reasonLabel(undefined)).toBe(GENERIC_REASON);
    expect(reasonLabel(null)).toBe(GENERIC_REASON);
    expect(reasonLabel('')).toBe(GENERIC_REASON);
  });
});
