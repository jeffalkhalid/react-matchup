// Regenerate the Android native launcher icons (mipmaps + adaptive foreground).
// Why: when an `android/` folder is committed (bare workflow or prebuilt), EAS Build
// uses the .webp files in `android/app/src/main/res/mipmap-*` as the SOURCE OF TRUTH
// and IGNORES `assets/icon.png` in app.json. So we must overwrite those mipmaps too.
//
// Outputs:
//   - mipmap-{mdpi..xxxhdpi}/ic_launcher.webp
//   - mipmap-{mdpi..xxxhdpi}/ic_launcher_round.webp
//   - mipmap-{mdpi..xxxhdpi}/ic_launcher_foreground.webp
//   - assets/favicon.png (256x256, web)
// Also patches values/colors.xml: iconBackground -> #0A0A0A.
//
// Run: node scripts/build-android-icons.js
// Run AFTER build-icon.js so assets/icon.png + assets/adaptive-icon.png are fresh.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const SRC_ICON = path.join(ROOT, 'assets', 'icon.png');
const SRC_ADAPTIVE = path.join(ROOT, 'assets', 'adaptive-icon.png');
const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
const COLORS_XML = path.join(RES, 'values', 'colors.xml');
const FAVICON = path.join(ROOT, 'assets', 'favicon.png');

// Tailles standard Android (ic_launcher + ic_launcher_round legacy).
const LEGACY_SIZES = {
  'mdpi':    48,
  'hdpi':    72,
  'xhdpi':   96,
  'xxhdpi':  144,
  'xxxhdpi': 192,
};

// Tailles adaptive icon foreground (108dp × density). Le système crope au safe-zone.
const ADAPTIVE_SIZES = {
  'mdpi':    108,
  'hdpi':    162,
  'xhdpi':   216,
  'xxhdpi':  324,
  'xxxhdpi': 432,
};

const WEBP_OPTS = { quality: 92, effort: 4 };

async function writeLegacy(density, size) {
  const dir = path.join(RES, `mipmap-${density}`);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Square launcher (ic_launcher.webp)
  await sharp(SRC_ICON).resize(size, size).webp(WEBP_OPTS)
    .toFile(path.join(dir, 'ic_launcher.webp'));

  // Round legacy (ic_launcher_round.webp) — crop to a circle via SVG mask.
  const roundMask = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`
  );
  await sharp(SRC_ICON)
    .resize(size, size)
    .composite([{ input: roundMask, blend: 'dest-in' }])
    .webp(WEBP_OPTS)
    .toFile(path.join(dir, 'ic_launcher_round.webp'));

  console.log(`  ✓ mipmap-${density}: ic_launcher.webp + ic_launcher_round.webp (${size}px)`);
}

async function writeAdaptive(density, size) {
  const dir = path.join(RES, `mipmap-${density}`);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Foreground transparent (no background — Android composites with iconBackground).
  // We use adaptive-icon.png (1024² avec safe zone) puis on supprime le fond pour ne garder que les pièces.
  // Approche simple : on resize adaptive-icon.png et on garde son fond.
  // Mais Android demande un foreground transparent. On utilise donc une version
  // "racket + trails seulement, fond transparent".
  // Pour simplifier, on extrait le foreground en utilisant adaptive-icon (qui a déjà le bon cadrage)
  // SANS le fond — on génère un foreground propre en compositant les pièces sur du transparent.
  // Ici je triche : on garde adaptive-icon.png tel quel (avec fond noir), Android le superposera.
  // Le résultat visuel : fond noir × fond noir = noir, donc cohérent.
  await sharp(SRC_ADAPTIVE).resize(size, size).webp(WEBP_OPTS)
    .toFile(path.join(dir, 'ic_launcher_foreground.webp'));

  console.log(`  ✓ mipmap-${density}: ic_launcher_foreground.webp (${size}px)`);
}

async function writeFavicon() {
  await sharp(SRC_ICON).resize(256, 256).png()
    .toFile(FAVICON);
  console.log('  ✓ assets/favicon.png (256×256)');
}

function patchColorsXml() {
  if (!fs.existsSync(COLORS_XML)) {
    console.log('  ⚠ colors.xml introuvable, skip patch');
    return;
  }
  let xml = fs.readFileSync(COLORS_XML, 'utf8');
  const before = xml;
  xml = xml.replace(
    /<color name="iconBackground">[^<]*<\/color>/,
    '<color name="iconBackground">#0A0A0A</color>'
  );
  if (xml === before) {
    console.log('  ⚠ iconBackground non trouvé dans colors.xml');
  } else {
    fs.writeFileSync(COLORS_XML, xml);
    console.log('  ✓ colors.xml : iconBackground → #0A0A0A');
  }
}

(async () => {
  console.log('▶ Legacy mipmaps (ic_launcher + ic_launcher_round)');
  for (const [density, size] of Object.entries(LEGACY_SIZES)) {
    await writeLegacy(density, size);
  }
  console.log('\n▶ Adaptive foreground (ic_launcher_foreground)');
  for (const [density, size] of Object.entries(ADAPTIVE_SIZES)) {
    await writeAdaptive(density, size);
  }
  console.log('\n▶ Favicon (web)');
  await writeFavicon();

  console.log('\n▶ Patch colors.xml');
  patchColorsXml();

  console.log('\n✓ Done. Rebuild the APK:');
  console.log('  eas build --profile development --platform android');
})().catch(e => { console.error(e); process.exit(1); });
