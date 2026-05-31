// Composite the PagMatch app icon from the splash pieces.
// Output:
//   - assets/icon.png            (1024x1024, full coverage — iOS app icon)
//   - assets/adaptive-icon.png   (1024x1024, central 66% safe zone — Android adaptive foreground)
//   - assets/splash-icon.png     (1024x1024, full lockup w/ wordmark — Expo native splash)
//
// Run: node scripts/build-icon.js

const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'design_handoff_auth_flow');
const OUT = path.join(ROOT, 'assets');

const RACKET = path.join(SRC, 'splash-racket.png');
const TRAILS = path.join(SRC, 'splash-trails.png');
const WORDMARK = path.join(SRC, 'splash-wordmark.png');
const BASELINE = path.join(SRC, 'splash-baseline.png');

const SIZE = 1024;

// Background gradient #1a1a1c → #08080a, top to bottom.
async function gradientBg(size) {
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#1a1a1c"/>
        <stop offset="1" stop-color="#08080a"/>
      </linearGradient>
      <radialGradient id="glow" cx="0.5" cy="0.5" r="0.45">
        <stop offset="0" stop-color="#FFC11A" stop-opacity="0.18"/>
        <stop offset="0.6" stop-color="#FFC11A" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${size}" height="${size}" fill="url(#g)"/>
    <rect width="${size}" height="${size}" fill="url(#glow)"/>
  </svg>`;
  return Buffer.from(svg);
}

// Compose the SMASH block (racket + trails) onto a target canvas.
// Geometry from the splash design (smash box has aspect ratio 364*0.7472 / 348*0.4483 ≈ 1.745).
//   Within the smash box (W × H):
//     - racket: left 44.49% top 0     w 55.52% h 96.79%
//     - trails: left 0     top 29.49% w 47.79% h 70.51%
async function buildSmashLayers(smashW, smashH) {
  const racketW = Math.round(smashW * 0.5552);
  const racketH = Math.round(smashH * 0.9679);
  const racketX = Math.round(smashW * 0.4449);
  const racketY = 0;

  const trailsW = Math.round(smashW * 0.4779);
  const trailsH = Math.round(smashH * 0.7051);
  const trailsX = 0;
  const trailsY = Math.round(smashH * 0.2949);

  const racket = await sharp(RACKET)
    .resize({ width: racketW, height: racketH, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const trails = await sharp(TRAILS)
    .resize({ width: trailsW, height: trailsH, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  return [
    { input: trails, left: trailsX, top: trailsY },
    { input: racket, left: racketX, top: racketY },
  ];
}

// Icon iOS (no crop) — smash takes ~80% width, centered.
async function buildIcon() {
  const bg = await sharp(await gradientBg(SIZE)).png().toBuffer();

  const smashW = Math.round(SIZE * 0.80);
  const smashH = Math.round(smashW / 1.745);
  const smashX = Math.round((SIZE - smashW) / 2);
  const smashY = Math.round((SIZE - smashH) / 2);

  const layers = await buildSmashLayers(smashW, smashH);
  // Reposition layers from smash-local to canvas-absolute.
  const positioned = layers.map(l => ({
    input: l.input,
    left: smashX + l.left,
    top: smashY + l.top,
  }));

  await sharp(bg)
    .composite(positioned)
    .png()
    .toFile(path.join(OUT, 'icon.png'));
  console.log('✓ assets/icon.png');
}

// Adaptive icon Android — same composition but contained in central 66% safe zone.
async function buildAdaptive() {
  const bg = await sharp(await gradientBg(SIZE)).png().toBuffer();

  const safe = Math.round(SIZE * 0.66);
  const smashW = safe;
  const smashH = Math.round(smashW / 1.745);
  const smashX = Math.round((SIZE - smashW) / 2);
  const smashY = Math.round((SIZE - smashH) / 2);

  const layers = await buildSmashLayers(smashW, smashH);
  const positioned = layers.map(l => ({
    input: l.input,
    left: smashX + l.left,
    top: smashY + l.top,
  }));

  await sharp(bg)
    .composite(positioned)
    .png()
    .toFile(path.join(OUT, 'adaptive-icon.png'));
  console.log('✓ assets/adaptive-icon.png');
}

// Splash icon (Expo native splash, before JS loads) — full lockup with wordmark.
// Geometry from the splash design (box 364 × 348) :
//   smash: left 14.56% top 0    w 74.72% h 44.83%
//   word:  left 0     top 44.83% w 100%   h 30.17%
//   base:  left 15.38% top 76.72% w 43.13% h 23.28%
async function buildSplashIcon() {
  const bg = await sharp(await gradientBg(SIZE)).png().toBuffer();

  // Lockup occupies ~70% of canvas, ratio 364/348.
  const lockupW = Math.round(SIZE * 0.70);
  const lockupH = Math.round(lockupW * 348 / 364);
  const lockupX = Math.round((SIZE - lockupW) / 2);
  const lockupY = Math.round((SIZE - lockupH) / 2);

  // Smash inside the lockup
  const smashW = Math.round(lockupW * 0.7472);
  const smashH = Math.round(lockupH * 0.4483);
  const smashX = lockupX + Math.round(lockupW * 0.1456);
  const smashY = lockupY;
  const smashLayers = (await buildSmashLayers(smashW, smashH)).map(l => ({
    input: l.input,
    left: smashX + l.left,
    top: smashY + l.top,
  }));

  // Wordmark
  const wordW = lockupW;
  const wordH = Math.round(lockupH * 0.3017);
  const wordX = lockupX;
  const wordY = lockupY + Math.round(lockupH * 0.4483);
  const wordBuf = await sharp(WORDMARK)
    .resize({ width: wordW, height: wordH, fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  // Baseline
  const baseW = Math.round(lockupW * 0.4313);
  const baseH = Math.round(lockupH * 0.2328);
  const baseX = lockupX + Math.round(lockupW * 0.1538);
  const baseY = lockupY + Math.round(lockupH * 0.7672);
  const baseBuf = await sharp(BASELINE)
    .resize({ width: baseW, height: baseH, fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  await sharp(bg)
    .composite([
      ...smashLayers,
      { input: wordBuf, left: wordX, top: wordY },
      { input: baseBuf, left: baseX, top: baseY },
    ])
    .png()
    .toFile(path.join(OUT, 'splash-icon.png'));
  console.log('✓ assets/splash-icon.png');
}

(async () => {
  await buildIcon();
  await buildAdaptive();
  await buildSplashIcon();
  console.log('\nDone. Restart Expo (clear cache) to see the new assets:');
  console.log('  npx expo start --clear');
})().catch(e => { console.error(e); process.exit(1); });
