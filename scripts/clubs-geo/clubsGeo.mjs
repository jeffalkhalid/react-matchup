// scripts/clubs-geo/clubsGeo.mjs — logique PURE du lot 0 de la localisation.
//
// 80 clubs sur 108 sont placés au centre de leur ville : toute distance calculée
// vers eux est fausse. L'utilisateur a fourni un fichier de positions ; ce module
// décide, sans réseau ni fichier, ce qu'on peut en tirer et ce qu'il faut lui
// faire vérifier. Mesures du 2026-09-17 : le fichier est juste quand le club est
// le bon (10 clubs sur 11 à moins de 170 m), mais le rapprochement des NOMS se
// trompe, surtout quand deux noms n'ont en commun que le nom de la ville.
//
// Testé par lib/__tests__/clubsGeo.test.ts.

// Mots qui ne distinguent pas un club d'un autre.
const MOTS_VIDES = new Set((
  'padel club clubs complexe sport sports sportif sportive academy academie ' +
  'the le la les de du des et and at center centre park football foot tennis fc association'
).split(' '));

export function sansAccents(s) {
  return String(s ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

export function normaliserVille(s) {
  return sansAccents(s).replace(/[^a-z]/g, '');
}

/** Mots qui identifient un club : ni mots vides, ni mots du nom de sa ville. */
export function motsSignificatifs(nom, motsVille = new Set()) {
  return new Set(
    sansAccents(nom).split(/[^a-z0-9]+/)
      .filter(m => m.length > 1 && !MOTS_VIDES.has(m) && !motsVille.has(m)),
  );
}

/** Distance à vol d'oiseau (haversine), en km. */
export function distanceKm(a, b) {
  const R = 6371;
  const rad = d => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Le centre d'une ville = le point partagé par ses clubs placés « city ». */
export function centresVilles(clubs) {
  const centres = new Map();
  for (const c of clubs) {
    if (c.geo_confidence === 'city' && c.latitude != null && c.longitude != null) {
      centres.set(normaliserVille(c.city), { lat: c.latitude, lng: c.longitude });
    }
  }
  return centres;
}

export const LOIN_DE_LA_VILLE_KM = 30;

/**
 * Le club du fichier qui correspond le mieux à un club de la base, dans la MÊME
 * ville uniquement, avec les raisons de douter. Ce n'est qu'une proposition :
 * l'utilisateur tranche.
 */
export function proposerCorrespondance(club, fichier, centre) {
  const ville = normaliserVille(club.city);
  const motsVille = motsSignificatifs(club.city);
  const mb = motsSignificatifs(club.name, motsVille);
  let meilleure = null;
  for (const f of fichier) {
    if (normaliserVille(f.ville) !== ville) continue;
    const mf = motsSignificatifs(f.nom, motsVille);
    const communs = [...mb].filter(m => mf.has(m));
    if (communs.length === 0) continue;
    const score = communs.length / Math.min(mb.size, mf.size);
    if (!meilleure || score > meilleure.score
        || (score === meilleure.score && communs.length > meilleure.communs.length)) {
      meilleure = { fichier: f, communs, score };
    }
  }
  if (!meilleure) return { fichier: null, communs: [], score: 0, alertes: ['absent du fichier'] };

  const alertes = [];
  if (meilleure.communs.length === 1 && mb.size >= 2) alertes.push('un seul mot en commun');
  if (meilleure.score < 1) alertes.push('noms partiellement différents');
  if (centre) {
    const d = distanceKm(centre, meilleure.fichier);
    if (d > LOIN_DE_LA_VILLE_KM) alertes.push(`loin de la ville (${Math.round(d)} km)`);
    if (d < 0.3) alertes.push('au centre-ville');
  }
  return { ...meilleure, alertes };
}

/** Deux clubs de la base proposés sur le même point : au moins un est faux. */
export function marquerPointsPartages(propositions) {
  const cle = p => `${p.fichier.lat.toFixed(5)},${p.fichier.lng.toFixed(5)}`;
  const compte = new Map();
  for (const p of propositions) if (p.fichier) compte.set(cle(p), (compte.get(cle(p)) ?? 0) + 1);
  for (const p of propositions) {
    if (p.fichier && compte.get(cle(p)) > 1) p.alertes.push('point partagé avec un autre club');
  }
  return propositions;
}

const NOMBRE = '(-?\\d{1,3}\\.\\d+)';
const FORMES_LIEN = [
  new RegExp(`!3d${NOMBRE}!4d${NOMBRE}`),                                   // épingle d'un lieu
  new RegExp(`[?&](?:q|ll|query|destination|center)=${NOMBRE},\\s*${NOMBRE}`),
  new RegExp(`@${NOMBRE},${NOMBRE}`),                                        // centre de la vue
  new RegExp(`^${NOMBRE}\\s*,\\s*${NOMBRE}$`),                               // « lat, lng » collé
];

/** Coordonnées lues dans un lien Google Maps ou un couple « lat, lng ». */
export function lireLienMaps(texte) {
  let t = String(texte ?? '').trim();
  if (!t) return null;
  try { t = decodeURIComponent(t); } catch { /* lien mal encodé : on lit tel quel */ }
  for (const re of FORMES_LIEN) {
    const m = t.match(re);
    if (!m) continue;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng };
    }
  }
  return null;
}

/** Lien court de partage (maps.app.goo.gl) : il faut suivre la redirection. */
export function estLienCourt(texte) {
  return /(maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test(String(texte ?? ''));
}

export const MAROC = { latMin: 20.7, latMax: 35.95, lngMin: -17.2, lngMax: -0.95 };
export const MAX_KM_DE_LA_VILLE = 40;

/** Raisons de refuser un point. Vide = acceptable. */
export function controlerPoint(point, centre, ville) {
  if (point.lat < MAROC.latMin || point.lat > MAROC.latMax
      || point.lng < MAROC.lngMin || point.lng > MAROC.lngMax) {
    return ['hors du Maroc'];
  }
  if (centre) {
    const d = distanceKm(point, centre);
    if (d > MAX_KM_DE_LA_VILLE) return [`à ${Math.round(d)} km de ${ville}`];
  }
  return [];
}

/** Ce que l'utilisateur a écrit dans la colonne « Décision ». */
export function lireDecision(cellule) {
  const brut = cellule == null ? ''
    : typeof cellule === 'object' ? String(cellule.hyperlink ?? cellule.text ?? '')
    : String(cellule);
  const t = brut.trim();
  if (!t) return { type: 'vide' };
  const bas = sansAccents(t);
  if (['oui', 'o', 'ok', 'yes', 'y'].includes(bas)) return { type: 'oui' };
  if (['non', 'n', 'no'].includes(bas)) return { type: 'non' };
  if (/https?:\/\//i.test(t) || /-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+/.test(t)) return { type: 'lien', texte: t };
  return { type: 'inconnu', texte: t };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SOURCE_VERIFICATION = 'verification_2026-09';

/** Mise à jour d'UN club, seulement s'il est encore placé au centre-ville. */
export function requeteMiseAJour({ id, lat, lng }) {
  if (!UUID.test(String(id))) throw new Error(`identifiant de club invalide : ${id}`);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error(`coordonnées invalides pour ${id}`);
  return `UPDATE public.clubs SET latitude = ${lat.toFixed(7)}, longitude = ${lng.toFixed(7)}, `
    + `geo_confidence = 'exact', geo_source = '${SOURCE_VERIFICATION}' `
    + `WHERE id = '${id}' AND geo_confidence = 'city';`;
}
