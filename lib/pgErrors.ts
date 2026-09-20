// lib/pgErrors.ts — reconnaître une table qui n'existe pas encore.
//
// Les fonctionnalités dont la migration n'est pas appliquée doivent se taire,
// pas planter. Encore faut-il reconnaître l'erreur — et il y en a DEUX
// formes, ce qui a coûté un message trompeur :
//
//   • Postgres répond `42P01`, « relation … does not exist » ;
//   • PostgREST, lui, répond souvent AVANT d'interroger Postgres :
//     `PGRST205`, « Could not find the table 'public.x' in the schema cache ».
//
// Ne guetter que la première laissait passer la seconde : l'app disait
// « ton pronostic n'a pas pu être enregistré » au lieu de « pas encore
// activé ». Une seule règle, lue par tous ceux qui en dépendent.
export function isMissingRelation(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const code = error.code ?? '';
  if (code === '42P01' || code === 'PGRST205' || code === 'PGRST202') return true;
  const m = (error.message ?? '').toLowerCase();
  return m.includes('does not exist')
    || m.includes('could not find the table')
    || m.includes('could not find the function')
    || m.includes('schema cache');
}
