// scripts/clubs-geo/fichier-verification.mjs — fichier Excel à vérifier.
//
// Installation (une fois, avant le premier lancement) : cd scripts/clubs-geo && npm install
//
// Usage : node scripts/clubs-geo/fichier-verification.mjs <fichier-source.xlsx> <sortie.xlsx>
//
// Une ligne par club de la base encore placé au centre-ville, avec la
// correspondance proposée dans le fichier de l'utilisateur, un lien pour la voir
// sur la carte, et les raisons d'en douter. L'utilisateur remplit « Décision » :
// oui, non, ou un lien Google Maps du bon emplacement.
import ExcelJS from 'exceljs';
import { lireClubsBase } from './base.mjs';
import { centresVilles, proposerCorrespondance, marquerPointsPartages, distanceKm, normaliserVille } from './clubsGeo.mjs';

const [source, sortie] = process.argv.slice(2);
if (!source || !sortie) {
  console.error('Usage : node scripts/clubs-geo/fichier-verification.mjs <fichier-source.xlsx> <sortie.xlsx>');
  process.exit(1);
}

async function lireFichierSource(chemin) {
  const classeur = new ExcelJS.Workbook();
  await classeur.xlsx.readFile(chemin);
  const feuille = classeur.worksheets[0];
  const colonnes = {};
  feuille.getRow(1).eachCell((cellule, n) => { colonnes[String(cellule.value).trim()] = n; });
  const col = nom => {
    if (!colonnes[nom]) throw new Error(`colonne « ${nom} » introuvable dans ${chemin}`);
    return colonnes[nom];
  };
  const clubs = [];
  feuille.eachRow((ligne, i) => {
    if (i === 1) return;
    const nom = ligne.getCell(col('Club / terrain')).text.trim();
    // Une cellule vide doit exclure la ligne : Number('') vaut 0, pas NaN.
    const texteLat = ligne.getCell(col('Latitude')).text.trim();
    const texteLng = ligne.getCell(col('Longitude')).text.trim();
    const lat = texteLat === '' ? NaN : Number(texteLat);
    const lng = texteLng === '' ? NaN : Number(texteLng);
    if (!nom || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
    clubs.push({
      ville: ligne.getCell(col('Ville')).text.trim(),
      nom,
      adresse: ligne.getCell(col('Adresse')).text.trim(),
      lat, lng,
      statut: ligne.getCell(col('Statut vérification')).text.trim(),
    });
  });
  return clubs;
}

const base = await lireClubsBase();
const fichier = await lireFichierSource(source);
const centres = centresVilles(base);
const aVerifier = base.filter(c => c.geo_confidence === 'city');

const lignes = aVerifier.map(club => {
  const centre = centres.get(normaliserVille(club.city));
  return { club, centre, proposition: proposerCorrespondance(club, fichier, centre) };
});
marquerPointsPartages(lignes.map(l => l.proposition));

const classeur = new ExcelJS.Workbook();
const feuille = classeur.addWorksheet('Vérification', { views: [{ state: 'frozen', ySplit: 1 }] });
feuille.columns = [
  { header: 'Identifiant', key: 'id', width: 38, hidden: true },
  { header: 'Ville', key: 'ville', width: 14 },
  { header: 'Club (base)', key: 'club', width: 34 },
  { header: 'Correspondance proposée', key: 'proposee', width: 34 },
  { header: 'Adresse', key: 'adresse', width: 36 },
  { header: 'Latitude', key: 'lat', width: 12 },
  { header: 'Longitude', key: 'lng', width: 12 },
  { header: 'Voir sur la carte', key: 'carte', width: 16 },
  { header: 'Distance au centre-ville (km)', key: 'distance', width: 14 },
  { header: 'Statut du fichier', key: 'statut', width: 16 },
  { header: 'Alertes', key: 'alertes', width: 40 },
  { header: 'Décision', key: 'decision', width: 30 },
  { header: 'Commentaire', key: 'commentaire', width: 30 },
];
feuille.getRow(1).font = { bold: true };
feuille.autoFilter = 'A1:M1';

for (const { club, centre, proposition: p } of lignes) {
  const f = p.fichier;
  const ligne = feuille.addRow({
    id: club.id,
    ville: club.city,
    club: club.name,
    proposee: f?.nom ?? '',
    adresse: f?.adresse ?? '',
    lat: f?.lat ?? null,
    lng: f?.lng ?? null,
    carte: f ? { text: 'Ouvrir', hyperlink: `https://www.google.com/maps?q=${f.lat},${f.lng}` } : '',
    distance: f && centre ? Math.round(distanceKm(centre, f) * 10) / 10 : null,
    statut: f?.statut ?? '',
    alertes: p.alertes.join(' · '),
    decision: '',
    commentaire: '',
  });
  const fond = !f ? 'FFFDECEC' : p.alertes.length ? 'FFFFF4E5' : null;
  if (fond) ligne.eachCell({ includeEmpty: true }, c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fond } }; });
  ligne.getCell('decision').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF9C4' } };
  if (f) ligne.getCell('carte').font = { color: { argb: 'FF1F6FEB' }, underline: true };
}

const aide = classeur.addWorksheet("Mode d'emploi");
aide.getColumn(1).width = 110;
[
  'Une ligne par club placé au centre de sa ville. Remplis la colonne « Décision » :',
  '  • oui : la correspondance proposée est le bon club, sa position est juste (vérifie avec « Voir sur la carte ») ;',
  '  • non : la proposition est fausse et tu n\'as pas la bonne position — le club reste au centre-ville ;',
  '  • un lien Google Maps (ou « latitude, longitude ») : la position exacte du club, à utiliser à la place.',
  'Lignes rouges : club absent du fichier — colle un lien Google Maps si tu le trouves, sinon laisse vide.',
  'Lignes orange : proposition douteuse (voir « Alertes ») — vérifie-la avant de répondre oui.',
  'Case vide = aucun changement. Rien n\'est écrit en base sans ton oui ou ton lien.',
].forEach(t => aide.addRow([t]));

await classeur.xlsx.writeFile(sortie);

const sansAlerte = lignes.filter(l => l.proposition.fichier && l.proposition.alertes.length === 0).length;
const douteuses = lignes.filter(l => l.proposition.fichier && l.proposition.alertes.length > 0).length;
const absents = lignes.filter(l => !l.proposition.fichier).length;
console.log(`${lignes.length} clubs à vérifier → sans alerte ${sansAlerte} · douteux ${douteuses} · absents du fichier ${absents}`);
console.log(`Fichier écrit : ${sortie}`);
