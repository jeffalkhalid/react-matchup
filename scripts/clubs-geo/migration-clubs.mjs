// scripts/clubs-geo/migration-clubs.mjs — migration SQL des positions validées.
//
// Installation (une fois, avant le premier lancement) : cd scripts/clubs-geo && npm install
//
// Usage : node scripts/clubs-geo/migration-clubs.mjs <verification-remplie.xlsx> <sortie.sql>
//
// Ne retient QUE les lignes où l'utilisateur a répondu oui ou collé un lien, puis
// contrôle chaque point (Maroc, proche de la ville, pas partagé). Une ligne
// refusée est listée avec sa raison et n'entre pas dans la migration : on
// corrige le fichier et on relance.
import ExcelJS from 'exceljs';
import { writeFileSync } from 'node:fs';
import { lireClubsBase } from './base.mjs';
import {
  centresVilles, normaliserVille, texteVisibleCellule, lireHyperlienCellule, lireDecision,
  lireLienMaps, estLienDeVue, estLienCourt, controlerPoint, identifiantsEnDouble,
  controlerEntetes, commentaireSQL, requeteMiseAJour,
} from './clubsGeo.mjs';

const [entree, sortie] = process.argv.slice(2);
if (!entree || !sortie) {
  console.error('Usage : node scripts/clubs-geo/migration-clubs.mjs <verification-remplie.xlsx> <sortie.sql>');
  process.exit(1);
}

/** Suit les redirections d'un lien court (maps.app.goo.gl) jusqu'au lien complet. */
async function lienComplet(url) {
  let courant = url;
  for (let i = 0; i < 5; i++) {
    // Délai de 10 s : un hôte qui ne répond pas ne doit pas bloquer tout le script.
    const r = await fetch(courant, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
    const suivant = r.headers.get('location');
    if (!suivant) return courant;
    courant = new URL(suivant, courant).toString();
    if (lireLienMaps(courant)) return courant;
  }
  return courant;
}

const classeur = new ExcelJS.Workbook();
await classeur.xlsx.readFile(entree);
const feuille = classeur.getWorksheet('Vérification');
if (!feuille) throw new Error('feuille « Vérification » introuvable');

// Mineur 6 : des colonnes déplacées feraient lire n'importe quoi comme
// identifiant, coordonnées ou décision — on arrête tout de suite, avant même
// de contacter la base, et rien n'est écrit.
const entete = feuille.getRow(1);
const erreurEntetes = controlerEntetes({
  A: entete.getCell(1).text.trim(),
  F: entete.getCell(6).text.trim(),
  G: entete.getCell(7).text.trim(),
  L: entete.getCell(12).text.trim(),
});
if (erreurEntetes) {
  console.error(erreurEntetes);
  process.exit(1);
}

const clubs = new Map((await lireClubsBase()).map(c => [c.id, c]));
const centres = centresVilles([...clubs.values()]);

// Mineur 5 : un identifiant qui apparaît sur plusieurs lignes est ambigu —
// on refuse les deux plutôt que de choisir une des deux positions au hasard.
const idsDoubles = identifiantsEnDouble(
  Array.from({ length: Math.max(feuille.rowCount - 1, 0) }, (_, i) => feuille.getRow(i + 2).getCell(1).text.trim()),
);

const retenus = [];
const refus = [];
let ignores = 0;

for (let i = 2; i <= feuille.rowCount; i++) {
  const ligne = feuille.getRow(i);
  const id = ligne.getCell(1).text.trim();
  if (!id) continue;
  const nom = ligne.getCell(3).text.trim();
  const ville = ligne.getCell(2).text.trim();

  if (idsDoubles.has(id)) { refus.push({ nom, raison: 'identifiant en double' }); continue; }

  const valeurDecision = ligne.getCell(12).value;
  const decision = lireDecision(texteVisibleCellule(valeurDecision), lireHyperlienCellule(valeurDecision));
  const club = clubs.get(id);

  if (decision.type === 'vide' || decision.type === 'non') { ignores++; continue; }
  if (!club) { refus.push({ nom, raison: 'club introuvable dans la base' }); continue; }
  if (club.geo_confidence !== 'city') { refus.push({ nom, raison: 'club déjà placé précisément — ignoré' }); continue; }
  if (decision.type === 'refus') { refus.push({ nom, raison: decision.raison }); continue; }
  if (decision.type === 'inconnu') { refus.push({ nom, raison: `décision illisible : « ${decision.texte} »` }); continue; }

  let point = null;
  if (decision.type === 'oui') {
    const lat = Number(ligne.getCell(6).text);
    const lng = Number(ligne.getCell(7).text);
    point = Number.isFinite(lat) && Number.isFinite(lng) && ligne.getCell(6).text ? { lat, lng } : null;
    if (!point) { refus.push({ nom, raison: 'oui sans correspondance proposée — coller un lien Google Maps' }); continue; }
  } else {
    let texte = decision.texte;
    if (estLienCourt(decision.texte)) {
      // Un lien court injoignable (DNS, réseau, délai dépassé) ne doit coûter
      // que cette ligne : sans ce try/catch, il ferait échouer tout le script
      // et perdre toutes les lignes déjà validées (le SQL n'est écrit qu'à la fin).
      try {
        texte = await lienComplet(decision.texte);
      } catch {
        refus.push({ nom, raison: 'lien court injoignable — ouvrir le lien et copier l\'adresse complète de la page' });
        continue;
      }
    }
    if (estLienDeVue(texte)) {
      refus.push({ nom, raison: 'lien de vue, pas d\'épingle — cliquer sur le lieu dans Maps puis copier le lien' });
      continue;
    }
    point = lireLienMaps(texte);
    if (!point) { refus.push({ nom, raison: 'lien illisible — ouvrir le lien et copier l\'adresse complète de la page' }); continue; }
  }

  const erreurs = controlerPoint(point, centres.get(normaliserVille(club.city)), club.city ?? ville);
  if (erreurs.length) { refus.push({ nom, raison: erreurs.join(' · ') }); continue; }
  // Le commentaire SQL utilise le nom en BASE, jamais le texte du tableur
  // (Important 4) : la colonne « Club (base) » reste modifiable par la personne.
  retenus.push({ id, nom, nomBase: club.name, ...point });
}

// Deux clubs retenus sur le même point : au moins un est faux, on écarte les deux.
const parPoint = new Map();
for (const r of retenus) {
  const cle = `${r.lat.toFixed(5)},${r.lng.toFixed(5)}`;
  parPoint.set(cle, [...(parPoint.get(cle) ?? []), r]);
}
const valides = [];
for (const groupe of parPoint.values()) {
  if (groupe.length === 1) { valides.push(groupe[0]); continue; }
  for (const r of groupe) refus.push({ nom: r.nom, raison: `même point que ${groupe.filter(x => x !== r).map(x => x.nom).join(', ')}` });
}

const sql = [
  '-- supabase/migrations/clubs_geo_precise.sql',
  '-- ============================================================',
  '-- Lot 0 de la localisation : positions précises des clubs placés au centre',
  '-- de leur ville, validées une à une par l\'utilisateur.',
  `-- Généré le ${new Date().toISOString().slice(0, 10)} depuis ${entree.split(/[\\/]/).pop()} : ${valides.length} club(s).`,
  '-- Ne touche qu\'un club encore geo_confidence = \'city\' : rejouer ne change rien.',
  '-- ============================================================',
  'BEGIN;',
  ...valides.map(v => `-- ${commentaireSQL(v.nomBase)}\n${requeteMiseAJour(v)}`),
  'COMMIT;',
  '',
  '-- Vérification : nombre de clubs par précision (les « exact » doivent avoir augmenté).',
  '-- SELECT geo_confidence, count(*) FROM public.clubs GROUP BY geo_confidence;',
  '',
].join('\n');
writeFileSync(sortie, sql, 'utf8');

console.log(`Retenus : ${valides.length} · sans décision ou « non » : ${ignores} · refusés : ${refus.length}`);
for (const r of refus) console.log(`  ✗ ${r.nom} — ${r.raison}`);
console.log(`Migration écrite : ${sortie}`);
