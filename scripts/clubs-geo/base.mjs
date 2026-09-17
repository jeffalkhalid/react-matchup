// scripts/clubs-geo/base.mjs — lecture des clubs de la base, en LECTURE SEULE.
// Installation (une fois, avant le premier lancement) : cd scripts/clubs-geo && npm install
// Clé publique de l'app (.env) : les scripts du lot 0 n'écrivent jamais en base,
// ils produisent une migration que l'utilisateur applique lui-même.
import { readFileSync } from 'node:fs';

export function lireEnv() {
  const texte = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
  const env = {};
  for (const ligne of texte.split(/\r?\n/)) {
    const m = ligne.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

export async function lireClubsBase() {
  const env = lireEnv();
  const url = env.EXPO_PUBLIC_SUPABASE_URL;
  const cle = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !cle) throw new Error('EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY absents de .env');
  const reponse = await fetch(
    `${url}/rest/v1/clubs?select=id,name,city,latitude,longitude,geo_confidence&order=city,name`,
    { headers: { apikey: cle, Authorization: `Bearer ${cle}` } },
  );
  if (!reponse.ok) throw new Error(`lecture des clubs : HTTP ${reponse.status}`);
  return reponse.json();
}
