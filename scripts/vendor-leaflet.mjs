// scripts/vendor-leaflet.mjs
// Télécharge Leaflet 1.9.4 (JS + CSS) et écrit assets/leaflet/leaflet.bundle.ts
// avec les contenus encodés en chaînes TS sûres (JSON.stringify).
// Usage: node scripts/vendor-leaflet.mjs
import { writeFileSync, mkdirSync } from 'node:fs';

const JS_URL  = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
const CSS_URL = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) { throw new Error(`${url} → HTTP ${res.status}`); }
  return res.text();
}

const js  = await get(JS_URL);
const css = await get(CSS_URL);

mkdirSync('assets/leaflet', { recursive: true });
const out =
  '// Généré par scripts/vendor-leaflet.mjs — Leaflet 1.9.4 (NE PAS éditer à la main).\n' +
  `export const LEAFLET_JS = ${JSON.stringify(js)};\n` +
  `export const LEAFLET_CSS = ${JSON.stringify(css)};\n`;
writeFileSync('assets/leaflet/leaflet.bundle.ts', out);
console.log(`OK — leaflet.bundle.ts écrit (js ${js.length} o, css ${css.length} o)`);
