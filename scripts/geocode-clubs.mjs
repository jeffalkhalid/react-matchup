// scripts/geocode-clubs.mjs
// Géocode les clubs (name + city) via Nominatim/OSM et génère un .sql d'UPDATE.
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/geocode-clubs.mjs
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY requis'); process.exit(1); }

const supabase = createClient(URL, KEY);
const UA = 'PagMatch/1.0 (jeffalkhalid@gmail.com)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/'/g, "''");

async function geocode(q) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ma&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  const arr = await res.json();
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const lat = parseFloat(arr[0].lat), lng = parseFloat(arr[0].lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

const { data: clubs, error } = await supabase
  .from('clubs')
  .select('id, ext_id, name, city, latitude')
  .is('latitude', null);
if (error) { console.error(error); process.exit(1); }

const lines = [];
const lowConfidence = [];
for (const c of clubs) {
  let hit = null, source = null, confidence = null;
  if (c.name) { hit = await geocode(`${c.name}, ${c.city ?? ''}, Maroc`); await sleep(1100); }
  if (hit) { source = 'osm'; confidence = 'exact'; }
  else if (c.city) {
    hit = await geocode(`${c.city}, Maroc`); await sleep(1100);
    if (hit) { source = 'city'; confidence = 'city'; }
  }
  if (hit) {
    lines.push(
      `UPDATE public.clubs SET latitude=${hit.lat}, longitude=${hit.lng}, ` +
      `geo_source='${source}', geo_confidence='${confidence}' WHERE ext_id='${esc(c.ext_id)}';`
    );
    if (confidence !== 'exact') lowConfidence.push(`${c.ext_id} — ${c.name} (${confidence})`);
  } else {
    lines.push(`-- AUCUN résultat: ${esc(c.ext_id)} — ${esc(c.name)} (geo_confidence='none')`);
    lowConfidence.push(`${c.ext_id} — ${c.name} (none)`);
  }
  console.log(`${c.ext_id} ${c.name} → ${confidence ?? 'none'}`);
}

const header = '-- Généré par scripts/geocode-clubs.mjs (Nominatim/OSM). Vérifier les lignes city/none.\n';
writeFileSync('supabase/migrations/update_clubs_geo.sql', header + lines.join('\n') + '\n');
console.log(`\n${lines.length} clubs traités. À corriger à la main:\n` + lowConfidence.join('\n'));
