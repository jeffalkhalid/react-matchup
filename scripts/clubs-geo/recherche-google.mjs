// scripts/clubs-geo/recherche-google.mjs — positions proposées par Google Maps.
//
// Installation (une fois) : cd scripts/clubs-geo && npm install
// Clé : scripts/clubs-geo/.env → GOOGLE_MAPS_API_KEY=... (fichier ignoré par git,
// la clé n'est jamais affichée).
//
// Usage :
//   node recherche-google.mjs --essai                 un seul club, pour tester la clé
//   node recherche-google.mjs <sortie.xlsx> <cache.json>
//
// Onglet « Vérification » : même colonnes que fichier-verification.mjs (la
// migration-clubs.mjs le lit tel quel) ; une ligne par club de la base placé au
// centre-ville, avec le lieu que Google trouve pour « nom, ville ».
// Onglet « Clubs absents » : les lieux que Google trouve pour « padel <ville> »
// et qui ne correspondent à aucun club de l'app — à ajouter ou non.
//
// Chaque réponse de Google est gardée dans le cache : relancer ne redemande
// rien de ce qui est déjà connu. Plafond de demandes par lancement : MAX_DEMANDES.
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { lireClubsBase } from './base.mjs';
import {
  centresVilles, normaliserVille, motsSignificatifs, distanceKm, controlerPoint,
  CENTRE_VILLE_KM,
} from './clubsGeo.mjs';

const MAX_DEMANDES = 300;
const CHAMPS = 'places.id,places.displayName,places.formattedAddress,places.location,places.businessStatus,places.googleMapsUri,places.types,nextPageToken';

// Villes cherchées en plus de celles de la base (padel « padel <ville> »).
const VILLES_EN_PLUS = [
  'Casablanca', 'Rabat', 'Salé', 'Témara', 'Marrakech', 'Tanger', 'Agadir', 'Fès', 'Meknès',
  'Mohammedia', 'Bouskoura', 'Dar Bouazza', 'Kénitra', 'El Jadida', 'Oujda', 'Tétouan', 'Nador',
  'Benslimane', 'Bouznika', 'Settat', 'Berrechid', 'Safi', 'Essaouira', 'Béni Mellal', 'Ifrane',
  'Al Hoceima', 'Saïdia', 'Laâyoune', 'Dakhla', 'Taghazout', 'Martil', 'Asilah', 'Larache',
];

function lireCle() {
  const chemin = new URL('./.env', import.meta.url);
  if (!existsSync(chemin)) throw new Error('scripts/clubs-geo/.env absent (GOOGLE_MAPS_API_KEY=...)');
  const m = readFileSync(chemin, 'utf8').match(/^GOOGLE_MAPS_API_KEY=(.+)$/m);
  if (!m || !m[1].trim()) throw new Error('GOOGLE_MAPS_API_KEY absente de scripts/clubs-geo/.env');
  return m[1].trim();
}

let demandes = 0;
async function chercher(cle, cache, requete) {
  const k = JSON.stringify(requete);
  if (cache[k]) return cache[k];
  if (demandes >= MAX_DEMANDES) throw new Error(`plafond de ${MAX_DEMANDES} demandes atteint (relancer : le cache garde l'acquis)`);
  demandes++;
  const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': cle, 'X-Goog-FieldMask': CHAMPS },
    body: JSON.stringify({ languageCode: 'fr', regionCode: 'MA', ...requete }),
  });
  const corps = await r.json();
  if (!r.ok) throw new Error(`Google : HTTP ${r.status} — ${corps?.error?.message ?? ''}`);
  cache[k] = corps;
  return corps;
}

const lieu = p => ({
  placeId: p.id,
  nom: p.displayName?.text ?? '',
  adresse: p.formattedAddress ?? '',
  lat: p.location?.latitude,
  lng: p.location?.longitude,
  statut: p.businessStatus ?? '',
  lien: p.googleMapsUri ?? '',
  types: p.types ?? [],
});

function requeteClub(club, centre) {
  return {
    textQuery: `${club.name}, ${club.city}, Maroc`,
    maxResultCount: 3,
    ...(centre ? { locationBias: { circle: { center: { latitude: centre.lat, longitude: centre.lng }, radius: 40000 } } } : {}),
  };
}

const args = process.argv.slice(2);
const cle = lireCle();
const base = await lireClubsBase();
const centres = centresVilles(base);

if (args[0] === '--essai') {
  const club = base.find(c => c.geo_confidence === 'city');
  const rep = await chercher(cle, {}, requeteClub(club, centres.get(normaliserVille(club.city))));
  const l = (rep.places ?? []).map(lieu)[0];
  console.log(`Essai : « ${club.name} » (${club.city}) → ${l ? `${l.nom} — ${l.adresse} — ${l.lat}, ${l.lng}` : 'aucun résultat'}`);
  console.log(`Demandes faites : ${demandes}`);
  process.exit(0);
}

const [sortie, cheminCache] = args;
if (!sortie || !cheminCache) {
  console.error('Usage : node recherche-google.mjs <sortie.xlsx> <cache.json>   (ou --essai)');
  process.exit(1);
}
const cache = existsSync(cheminCache) ? JSON.parse(readFileSync(cheminCache, 'utf8')) : {};
const sauver = () => writeFileSync(cheminCache, JSON.stringify(cache));

// ── 1) Les clubs de la base placés au centre-ville ──
const aVerifier = base.filter(c => c.geo_confidence === 'city');
const lignes = [];
try {
  for (const club of aVerifier) {
    const centre = centres.get(normaliserVille(club.city));
    const rep = await chercher(cle, cache, requeteClub(club, centre));
    const trouves = (rep.places ?? []).map(lieu).filter(l => Number.isFinite(l.lat));
    const g = trouves[0] ?? null;
    const alertes = [];
    if (!g) alertes.push('Google ne trouve rien');
    else {
      const motsVille = motsSignificatifs(club.city);
      const mb = motsSignificatifs(club.name, motsVille);
      const mg = motsSignificatifs(g.nom, motsVille);
      const communs = [...mb].filter(m => mg.has(m));
      // Nom générique (« Nador Padel Club ») : aucun mot ne distingue le club,
      // Google renvoie n'importe quel lieu de la ville — toujours à vérifier.
      if (mb.size === 0) alertes.push("nom trop général : vérifier que c'est bien ce club");
      else if (communs.length === 0) alertes.push('nom Google différent du club');
      else if (communs.length === 1 && mb.size > 1) alertes.push(`un seul mot en commun : « ${communs[0]} »`);
      if (g.statut && g.statut !== 'OPERATIONAL') alertes.push(g.statut === 'CLOSED_PERMANENTLY' ? 'fermé définitivement selon Google' : 'fermé temporairement selon Google');
      alertes.push(...controlerPoint(g, centre, club.city));
      if (!/padel|tennis|sport|club|gym|stadium|athletic/i.test(g.nom + ' ' + g.types.join(' '))) alertes.push('ne ressemble pas à un lieu sportif');
    }
    lignes.push({ club, centre, g, alertes });
  }
} finally { sauver(); }

// Deux clubs de la base sur le même lieu Google : au moins un est faux.
const parLieu = new Map();
for (const l of lignes) if (l.g) parLieu.set(l.g.placeId, (parLieu.get(l.g.placeId) ?? 0) + 1);
for (const l of lignes) if (l.g && parLieu.get(l.g.placeId) > 1) l.alertes.push('même lieu Google qu\'un autre club');

// ── 2) Découverte : « padel <ville> » ──
const villes = new Map();
for (const v of [...base.map(c => c.city), ...VILLES_EN_PLUS]) {
  if (v && !villes.has(normaliserVille(v))) villes.set(normaliserVille(v), v);
}
const decouverts = new Map();
try {
  for (const ville of villes.values()) {
    let jeton;
    for (let page = 0; page < 3; page++) {
      const rep = await chercher(cle, cache, { textQuery: `padel ${ville} Maroc`, pageSize: 20, ...(jeton ? { pageToken: jeton } : {}) });
      for (const l of (rep.places ?? []).map(lieu)) {
        if (Number.isFinite(l.lat) && !decouverts.has(l.placeId)) decouverts.set(l.placeId, { ...l, villeCherchee: ville });
      }
      jeton = rep.nextPageToken;
      if (!jeton) break;
    }
  }
} finally { sauver(); }

// Un lieu découvert correspond déjà à un club de l'app s'il est le lieu trouvé
// pour un club (partie 1), ou s'il est à moins de 300 m d'un club placé exactement.
const lieuxConnus = new Set(lignes.filter(l => l.g).map(l => l.g.placeId));
const exacts = base.filter(c => c.geo_confidence === 'exact' && c.latitude != null);
const absents = [...decouverts.values()].filter(d =>
  !lieuxConnus.has(d.placeId)
  && !exacts.some(c => distanceKm(d, { lat: c.latitude, lng: c.longitude }) < CENTRE_VILLE_KM)
  && d.statut !== 'CLOSED_PERMANENTLY'
  && /padel/i.test(d.nom + ' ' + d.types.join(' ')),
);
// Nom proche d'un club de l'app : sans doute le même club, mal trouvé en partie 1.
function clubProche(d) {
  const md = motsSignificatifs(d.nom);
  return base.find(c => {
    const mc = motsSignificatifs(c.name, motsSignificatifs(c.city));
    return mc.size > 0 && [...mc].every(m => md.has(m));
  });
}

// ── Fichier ──
const classeur = new ExcelJS.Workbook();
const f1 = classeur.addWorksheet('Vérification', { views: [{ state: 'frozen', ySplit: 1 }] });
f1.columns = [
  { header: 'Identifiant', key: 'id', width: 38, hidden: true },
  { header: 'Ville', key: 'ville', width: 14 },
  { header: 'Club (base)', key: 'club', width: 34 },
  { header: 'Correspondance proposée', key: 'proposee', width: 34 },
  { header: 'Adresse', key: 'adresse', width: 44 },
  { header: 'Latitude', key: 'lat', width: 12 },
  { header: 'Longitude', key: 'lng', width: 12 },
  { header: 'Voir sur la carte', key: 'carte', width: 16 },
  { header: 'Distance au centre-ville (km)', key: 'distance', width: 14 },
  { header: 'Source', key: 'statut', width: 16 },
  { header: 'Alertes', key: 'alertes', width: 44 },
  { header: 'Décision', key: 'decision', width: 30 },
  { header: 'Commentaire', key: 'commentaire', width: 30 },
];
f1.getRow(1).font = { bold: true };
f1.autoFilter = 'A1:M1';
for (const { club, centre, g, alertes } of lignes) {
  const ligne = f1.addRow({
    id: club.id, ville: club.city, club: club.name,
    proposee: g?.nom ?? '', adresse: g?.adresse ?? '',
    lat: g?.lat ?? null, lng: g?.lng ?? null,
    carte: g ? { text: 'Ouvrir', hyperlink: `https://www.google.com/maps?q=${g.lat},${g.lng}` } : '',
    distance: g && centre ? Math.round(distanceKm(centre, g) * 10) / 10 : null,
    statut: g ? 'Google Maps' : '',
    alertes: alertes.join(' · '), decision: '', commentaire: '',
  });
  const fond = !g ? 'FFFDECEC' : alertes.length ? 'FFFFF4E5' : null;
  if (fond) ligne.eachCell({ includeEmpty: true }, c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fond } }; });
  ligne.getCell('decision').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF9C4' } };
  if (g) ligne.getCell('carte').font = { color: { argb: 'FF1F6FEB' }, underline: true };
}

const f2 = classeur.addWorksheet('Clubs absents', { views: [{ state: 'frozen', ySplit: 1 }] });
f2.columns = [
  { header: 'Ville cherchée', key: 'ville', width: 16 },
  { header: 'Nom (Google)', key: 'nom', width: 36 },
  { header: 'Adresse', key: 'adresse', width: 48 },
  { header: 'Latitude', key: 'lat', width: 12 },
  { header: 'Longitude', key: 'lng', width: 12 },
  { header: 'Voir sur la carte', key: 'carte', width: 16 },
  { header: 'Remarque', key: 'remarque', width: 34 },
  { header: 'Ajouter à l\'app ?', key: 'decision', width: 18 },
];
f2.getRow(1).font = { bold: true };
f2.autoFilter = 'A1:H1';
const ajouter = (d, remarque) => {
  const ligne = f2.addRow({
    ville: d.villeCherchee, nom: d.nom, adresse: d.adresse, lat: d.lat, lng: d.lng,
    carte: { text: 'Ouvrir', hyperlink: d.lien || `https://www.google.com/maps?q=${d.lat},${d.lng}` },
    remarque, decision: '',
  });
  ligne.getCell('carte').font = { color: { argb: 'FF1F6FEB' }, underline: true };
  ligne.getCell('decision').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF9C4' } };
};
absents.sort((a, b) => a.villeCherchee.localeCompare(b.villeCherchee) || a.nom.localeCompare(b.nom))
  .forEach(d => {
    const r = [];
    const c = clubProche(d);
    if (c) r.push(`déjà dans l'app ? « ${c.name} » (${c.city})`);
    if (d.statut === 'CLOSED_TEMPORARILY') r.push('fermé temporairement selon Google');
    if (/coach|shop|boutique|vente|installation|apartment|appartement/i.test(d.nom)) r.push('pas un club ? (coach, boutique…)');
    ajouter(d, r.join(' · '));
  });

const aide = classeur.addWorksheet("Mode d'emploi");
aide.getColumn(1).width = 110;
[
  'Onglet « Vérification » : un club de l\'app par ligne, placé aujourd\'hui au centre de sa ville. « Correspondance proposée » = le lieu trouvé par Google Maps.',
  'Colonne « Décision » : oui (le lieu Google est le bon club), non (mauvais lieu, le club reste au centre-ville), ou un lien Google Maps du bon emplacement.',
  'Lignes orange : à regarder de près (voir « Alertes »). Lignes rouges : Google n\'a rien trouvé — colle un lien si tu connais le club.',
  'Onglet « Clubs absents » : lieux de padel trouvés par Google qui ne sont pas dans l\'app. Colonne « Ajouter à l\'app ? » : oui ou non.',
  'Case vide = aucun changement. Rien n\'est écrit en base sans ton oui ou ton lien.',
  'Source : Google Maps (Places API), recherche du ' + new Date().toISOString().slice(0, 10) + '.',
].forEach(t => aide.addRow([t]));

await classeur.xlsx.writeFile(sortie);
const sans = lignes.filter(l => l.g && l.alertes.length === 0).length;
console.log(`Vérification : ${lignes.length} clubs → sans alerte ${sans} · à regarder ${lignes.filter(l => l.g && l.alertes.length).length} · rien trouvé ${lignes.filter(l => !l.g).length}`);
console.log(`Clubs absents : ${absents.length} lieux « padel » (dont ${absents.filter(clubProche).length} peut-être déjà dans l'app)`);
console.log(`Demandes Google faites ce lancement : ${demandes}`);
console.log(`Fichier écrit : ${sortie}`);
