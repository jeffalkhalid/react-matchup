/* PagMatch — 5 styles de story raffinés (profil complet → 9:16).
   Chaque style est rendu en pleine résolution 1080×1920 puis mis à l'échelle
   par <StoryFrame>. Données via window.PM. */

const { Colors: C, leagueLabel: LEAGUE, DNA_AXES } = window.PM;

const F = {
  display: '"Anton", system-ui, sans-serif',
  welcome: '"Barlow Condensed", system-ui, sans-serif', // 900 italic
  ui: '"Inter", system-ui, sans-serif',
};

/* ── Cadre : met à l'échelle un contenu 1080×1920 ─────────────────── */
function StoryFrame({ w = 320, radius = 0, children }) {
  const NW = 1080, NH = 1920, s = w / NW;
  return (
    <div style={{ width: w, height: w * NH / NW, position: 'relative', overflow: 'hidden', borderRadius: radius, background: '#000' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, width: NW, height: NH, transform: `scale(${s})`, transformOrigin: 'top left' }}>
        {children}
      </div>
    </div>
  );
}

/* ── Helpers visuels ──────────────────────────────────────────────── */
function Ring({ rate, size = 220, sw = 16, track = 'rgba(0,0,0,0.12)', color = '#0A0A0A', labelColor = '#0A0A0A', subColor = '#A1A1AA' }) {
  const r = (size - sw) / 2, c = 2 * Math.PI * r, cx = size / 2;
  return (
    <div style={{ width: size, height: size, position: 'relative', display: 'grid', placeItems: 'center' }}>
      <svg width={size} height={size} style={{ position: 'absolute', transform: 'rotate(-90deg)' }}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke={track} strokeWidth={sw} />
        <circle cx={cx} cy={cx} r={r} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round"
          strokeDasharray={`${c * rate / 100} ${c}`} />
      </svg>
      <div style={{ textAlign: 'center', lineHeight: 1 }}>
        <div style={{ fontFamily: F.display, fontSize: size * 0.30, color: labelColor, letterSpacing: -1 }}>{rate}<span style={{ fontSize: size * 0.16 }}>%</span></div>
        <div style={{ fontFamily: F.ui, fontWeight: 800, fontSize: size * 0.075, color: subColor, letterSpacing: 4, marginTop: size * 0.03 }}>WIN RATE</div>
      </div>
    </div>
  );
}

function Radar({ values, size = 360, stroke = C.brand, fill = 'rgba(255,193,26,0.18)', grid = 'rgba(255,255,255,0.12)', axisColor = 'rgba(255,255,255,0.5)' }) {
  const R = size * 0.34, cx = size / 2, cy = size * 0.42;
  const xy = (a, r) => ({ x: cx + r * Math.cos(a * Math.PI / 180), y: cy + r * Math.sin(a * Math.PI / 180) });
  const maxVal = Math.max(...DNA_AXES.map(a => values[a.key] ?? 0), 1);
  const grids = [0.33, 0.66, 1].map(lvl => DNA_AXES.map(a => { const p = xy(a.angle, R * lvl); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; }).join(' '));
  const dataPts = DNA_AXES.map(a => xy(a.angle, R * Math.min((values[a.key] ?? 0) / maxVal, 1)));
  const dataPoly = dataPts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  return (
    <div style={{ width: size, position: 'relative' }}>
      <svg width={size} height={size * 0.84} viewBox={`0 0 ${size} ${size * 0.84}`}>
        {grids.map((pts, i) => <polygon key={i} points={pts} fill="none" stroke={grid} strokeWidth={1.5} />)}
        {DNA_AXES.map(a => { const p = xy(a.angle, R); return <line key={a.key} x1={cx} y1={cy} x2={p.x.toFixed(1)} y2={p.y.toFixed(1)} stroke={grid} strokeWidth={1.5} />; })}
        <polygon points={dataPoly} fill={fill} stroke={stroke} strokeWidth={3} strokeLinejoin="round" />
        {dataPts.map((p, i) => <circle key={i} cx={p.x.toFixed(1)} cy={p.y.toFixed(1)} r={5} fill={stroke} />)}
        {DNA_AXES.map(a => { const p = xy(a.angle, R + 34); return <text key={a.key} x={p.x.toFixed(1)} y={p.y.toFixed(1)} fontSize="26" textAnchor="middle" dominantBaseline="middle">{a.emoji}</text>; })}
      </svg>
    </div>
  );
}

function Sparkline({ series, w = 760, h = 230, color = C.brand, fill = 'rgba(255,193,26,0.14)' }) {
  const min = Math.min(...series), max = Math.max(...series), range = (max - min) || 1;
  const pad = 14, step = (w - pad * 2) / (series.length - 1);
  const pts = series.map((v, i) => ({ x: pad + i * step, y: h - pad - ((v - min) / range) * (h - pad * 2) }));
  const line = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${pts[0].x},${h} ${line} ${pts[pts.length - 1].x},${h}`;
  const last = pts[pts.length - 1];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <polygon points={area} fill={fill} />
      <polyline points={line} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last.x.toFixed(1)} cy={last.y.toFixed(1)} r={9} fill={color} />
      <circle cx={last.x.toFixed(1)} cy={last.y.toFixed(1)} r={16} fill="none" stroke={color} strokeWidth={3} opacity={0.4} />
    </svg>
  );
}

function FormDots({ form, size = 46, gap = 12, ring }) {
  return (
    <div style={{ display: 'flex', gap }}>
      {form.map((r, i) => (
        <div key={i} style={{
          width: size, height: size, borderRadius: size / 2,
          background: r === 'W' ? C.success : C.danger,
          display: 'grid', placeItems: 'center',
          fontFamily: F.ui, fontWeight: 900, fontSize: size * 0.42, color: '#fff',
          boxShadow: ring ? `0 0 0 ${size * 0.07}px ${(r === 'W' ? C.success : C.danger)}33` : 'none',
        }}>{r}</div>
      ))}
    </div>
  );
}

function Wordmark({ light = true, size = 1 }) {
  const col = light ? 'rgba(255,255,255,0.82)' : 'rgba(10,10,10,0.7)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 * size }}>
      <div style={{ width: 52 * size, height: 52 * size, borderRadius: 14 * size, background: C.brand, display: 'grid', placeItems: 'center', boxShadow: `0 8px 24px ${C.brand}55` }}>
        <span style={{ fontSize: 28 * size }}>🎾</span>
      </div>
      <span style={{ fontFamily: F.ui, fontWeight: 900, fontSize: 26 * size, letterSpacing: 6 * size, color: col }}>PAGMATCH</span>
    </div>
  );
}

const lg = (p) => LEAGUE[p.league];
const lgColor = (p) => C.league[p.league];

/* ── QR (réaliste, à remplacer par un vrai encodage du lien en prod) ── */
function QRCode({ size = 120, fg = '#0A0A0A', bg = '#fff', seed = 42 }) {
  const N = 25, cell = size / N;
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const inBox = (r, c, R, Cc) => r >= R && r < R + 7 && c >= Cc && c < Cc + 7;
  const isFinder = (r, c) => inBox(r, c, 0, 0) || inBox(r, c, 0, N - 7) || inBox(r, c, N - 7, 0);
  const finderOn = (r, c) => {
    const local = (R, Cc) => { const lr = r - R, lc = c - Cc; const ring = lr === 0 || lr === 6 || lc === 0 || lc === 6; const core = lr >= 2 && lr <= 4 && lc >= 2 && lc <= 4; return ring || core; };
    if (r < 7 && c < 7) return local(0, 0);
    if (r < 7 && c >= N - 7) return local(0, N - 7);
    if (r >= N - 7 && c < 7) return local(N - 7, 0);
    return false;
  };
  const rects = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const near = (r < 8 && c < 8) || (r < 8 && c >= N - 8) || (r >= N - 8 && c < 8);
    const on = isFinder(r, c) ? finderOn(r, c) : (near ? false : rnd() > 0.52);
    if (on) rects.push(<rect key={r + '_' + c} x={(c * cell).toFixed(2)} y={(r * cell).toFixed(2)} width={cell + 0.5} height={cell + 0.5} fill={fg} />);
  }
  return (
    <div style={{ background: bg, padding: size * 0.085, borderRadius: 16, lineHeight: 0, boxShadow: '0 6px 20px rgba(0,0,0,0.25)' }}>
      <svg width={size} height={size} shapeRendering="crispEdges">{rects}</svg>
    </div>
  );
}

/* ── Bloc invitation : QR + "Rejoins-moi sur PagMatch" + lien + app ── */
function Invite({ light = true, accent = C.brand, size = 132 }) {
  const inv = window.PM.invite;
  const sub = light ? 'rgba(255,255,255,0.55)' : 'rgba(10,10,10,0.5)';
  const main = light ? '#fff' : C.textPrimary;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 26 }}>
      {inv.showQR !== false ? <QRCode size={size} fg="#0A0A0A" bg="#fff" /> : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
        <span style={{ fontFamily: F.ui, fontWeight: 800, fontSize: 24, letterSpacing: 2, color: sub }}>{(inv.cta || '').toUpperCase()}</span>
        <span style={{ fontFamily: F.welcome, fontWeight: 900, fontStyle: 'italic', fontSize: 56, color: main, textTransform: 'uppercase', lineHeight: 0.9 }}>PagMatch</span>
        <span style={{ fontFamily: F.ui, fontWeight: 800, fontSize: 26, letterSpacing: 1, color: accent }}>{inv.link}</span>
        {inv.showApp !== false && inv.appUrl ? (
          <span style={{ marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderRadius: 999, border: `1.5px solid ${light ? 'rgba(255,255,255,0.3)' : 'rgba(10,10,10,0.18)'}`, fontFamily: F.ui, fontWeight: 800, fontSize: 20, color: main }}>📲 {inv.appUrl}</span>
        ) : null}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   STYLE 1 — CARTE NOIRE / OR  (premium dark, jaune parcimonieux)
   ════════════════════════════════════════════════════════════════════ */
function StoryCardDark({ player: p }) {
  const gold = lgColor(p);
  return (
    <div style={{ width: 1080, height: 1920, background: '#0A0A0A', position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* glows */}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 82% 10%, rgba(255,193,26,0.16), transparent 52%), radial-gradient(circle at 12% 96%, rgba(255,193,26,0.08), transparent 50%)' }} />
      {/* hairline texture */}
      <div style={{ position: 'absolute', inset: 0, opacity: 0.5, backgroundImage: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.015) 0 2px, transparent 2px 80px)' }} />

      <div style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '110px 92px 96px' }}>
        {/* top */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Wordmark light size={1} />
          <span style={{ fontFamily: F.ui, fontWeight: 800, fontSize: 22, letterSpacing: 5, color: 'rgba(255,255,255,0.35)' }}>CARTE JOUEUR</span>
        </div>

        {/* hero */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 28, marginBottom: 30 }}>
            <div style={{ width: 132, height: 132, borderRadius: 32, background: `linear-gradient(150deg, ${gold}, ${C.brandDeep})`, display: 'grid', placeItems: 'center', boxShadow: `0 16px 48px ${gold}40` }}>
              <span style={{ fontFamily: F.display, fontSize: 64, color: '#0A0A0A' }}>{p.initials}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <span style={{ alignSelf: 'flex-start', fontFamily: F.ui, fontWeight: 900, fontSize: 22, letterSpacing: 3, color: gold, background: `${gold}22`, border: `1.5px solid ${gold}66`, borderRadius: 999, padding: '8px 20px' }}>● {lg(p).toUpperCase()}</span>
              <span style={{ fontFamily: F.ui, fontWeight: 700, fontSize: 24, color: 'rgba(255,255,255,0.45)' }}>Rang #{p.rank} · FRMT {p.frmtRank} {p.frmtVerified ? '✓' : ''}</span>
            </div>
          </div>

          <div style={{ fontFamily: F.welcome, fontWeight: 900, fontStyle: 'italic', fontSize: 168, lineHeight: 0.86, color: '#fff', letterSpacing: -2, textTransform: 'uppercase' }}>
            {p.name.split(' ')[0]}<br /><span style={{ color: gold }}>{p.name.split(' ').slice(1).join(' ')}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 28, marginTop: 44 }}>
            <div>
              <div style={{ fontFamily: F.ui, fontWeight: 800, fontSize: 24, letterSpacing: 4, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>NIVEAU PADEL</div>
              <div style={{ fontFamily: F.display, fontSize: 200, lineHeight: 0.8, color: gold, letterSpacing: -4 }}>{p.level.toFixed(2)}</div>
            </div>
          </div>
        </div>

        {/* stats */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.12)', borderBottom: '1px solid rgba(255,255,255,0.12)', padding: '34px 0' }}>
            {[['Matchs', p.total], ['Victoires', p.wins], ['Win', p.winRate + '%']].map(([l, v], i) => (
              <div key={l} style={{ flex: 1, textAlign: i === 0 ? 'left' : i === 2 ? 'right' : 'center', borderLeft: i ? '1px solid rgba(255,255,255,0.1)' : 'none', paddingLeft: i ? 40 : 0 }}>
                <div style={{ fontFamily: F.display, fontSize: 84, color: '#fff', lineHeight: 0.9 }}>{v}</div>
                <div style={{ fontFamily: F.ui, fontWeight: 800, fontSize: 22, letterSpacing: 3, color: 'rgba(255,255,255,0.4)', marginTop: 8 }}>{l.toUpperCase()}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 36 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
              <span style={{ fontFamily: F.ui, fontWeight: 800, fontSize: 22, letterSpacing: 3, color: 'rgba(255,255,255,0.4)' }}>FORME</span>
              <FormDots form={p.recentForm} size={48} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: F.display, fontSize: 52, color: C.warning }}>
              <span style={{ fontSize: 44 }}>🔥</span>{p.streak}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 44, paddingTop: 36, borderTop: '1px solid rgba(255,255,255,0.12)' }}>
            <Invite light accent={gold} size={128} />
            <span style={{ fontFamily: F.ui, fontWeight: 700, fontSize: 22, color: 'rgba(255,255,255,0.4)', textAlign: 'right', maxWidth: 220 }}>{p.club}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   STYLE 2 — TRADING CARD / FUT  (or collectible, holo)
   ════════════════════════════════════════════════════════════════════ */
function StoryTradingCard({ player: p }) {
  const [g1, g2] = C.leagueGrad[p.league];
  const ink = '#2A1C00';
  const cell = (l, v) => (
    <div style={{ flex: 1, textAlign: 'center' }}>
      <div style={{ fontFamily: F.display, fontSize: 76, color: ink, lineHeight: 0.9 }}>{v}</div>
      <div style={{ fontFamily: F.ui, fontWeight: 900, fontSize: 24, letterSpacing: 3, color: 'rgba(42,28,0,0.55)', marginTop: 4 }}>{l}</div>
    </div>
  );
  return (
    <div style={{ width: 1080, height: 1920, background: '#0A0A0A', display: 'grid', placeItems: 'center' }}>
      <div style={{ width: 980, height: 1740, borderRadius: 56, position: 'relative', overflow: 'hidden', background: `linear-gradient(155deg, ${g2} 0%, ${g1} 60%, #8a4f04 100%)`, boxShadow: `0 40px 120px ${g1}55, inset 0 0 0 6px rgba(255,255,255,0.35), inset 0 0 0 14px rgba(0,0,0,0.18)` }}>
        {/* holo sweeps */}
        <div style={{ position: 'absolute', top: -200, left: -200, width: 700, height: 2400, transform: 'rotate(22deg)', background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)' }} />
        <div style={{ position: 'absolute', top: -200, left: 400, width: 240, height: 2400, transform: 'rotate(22deg)', background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.22), transparent)' }} />
        <div style={{ position: 'absolute', inset: 0, opacity: 0.5, background: 'radial-gradient(circle at 50% 30%, rgba(255,255,255,0.35), transparent 55%)' }} />

        <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', padding: '70px 64px 60px' }}>
          {/* FUT corner */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ textAlign: 'center', lineHeight: 0.92 }}>
              <div style={{ fontFamily: F.display, fontSize: 168, color: ink, letterSpacing: -4 }}>{p.level.toFixed(1)}</div>
              <div style={{ fontFamily: F.ui, fontWeight: 900, fontSize: 40, color: ink, letterSpacing: 4 }}>{lg(p).toUpperCase()}</div>
              <div style={{ width: 90, height: 4, background: ink, opacity: 0.4, margin: '14px auto', borderRadius: 4 }} />
              <div style={{ fontFamily: F.ui, fontWeight: 900, fontSize: 38, color: ink, letterSpacing: 4 }}>GCH</div>
              <div style={{ fontSize: 44, marginTop: 14 }}>🎾</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: F.ui, fontWeight: 900, fontSize: 26, letterSpacing: 4, color: 'rgba(42,28,0,0.6)' }}>RANG</div>
              <div style={{ fontFamily: F.display, fontSize: 96, color: ink, lineHeight: 0.9 }}>#{p.rank}</div>
            </div>
          </div>

          {/* avatar + name */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 36, marginTop: -40 }}>
            <div style={{ width: 320, height: 320, borderRadius: '50%', background: 'rgba(10,8,0,0.18)', border: `8px solid ${ink}`, display: 'grid', placeItems: 'center', boxShadow: 'inset 0 8px 40px rgba(0,0,0,0.25)' }}>
              <span style={{ fontFamily: F.display, fontSize: 168, color: ink }}>{p.initials}</span>
            </div>
            <div style={{ fontFamily: F.welcome, fontWeight: 900, fontStyle: 'italic', fontSize: 110, color: ink, textTransform: 'uppercase', letterSpacing: -1, textAlign: 'center', lineHeight: 0.9 }}>{p.name}</div>
            {p.frmtVerified && <div style={{ fontFamily: F.ui, fontWeight: 800, fontSize: 30, color: 'rgba(42,28,0,0.6)', letterSpacing: 2 }}>🏆 FRMT {p.frmtRank} ✓</div>}
          </div>

          {/* stat grid */}
          <div style={{ borderTop: `3px solid ${ink}33` }}>
            <div style={{ display: 'flex', padding: '30px 0 18px' }}>
              {cell('MAT', p.total)}{cell('VIC', p.wins)}{cell('DÉF', p.losses)}
            </div>
            <div style={{ display: 'flex', padding: '18px 0 6px', borderTop: `2px solid ${ink}22` }}>
              {cell('WIN%', p.winRate)}{cell('SÉRIE', p.streak)}{cell('FIAB', p.fiability)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   STYLE 3 — EDITORIAL LIGHT  (crème magazine, minimal)
   ════════════════════════════════════════════════════════════════════ */
function StoryEditorialLight({ player: p }) {
  const gold = C.brandDeep;
  return (
    <div style={{ width: 1080, height: 1920, background: C.bgCream, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: '120px 92px 100px' }}>
      {/* top meta */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: F.ui, fontWeight: 900, fontSize: 26, letterSpacing: 8, color: C.textPrimary }}>PAGMATCH</span>
        <span style={{ fontFamily: F.ui, fontWeight: 700, fontSize: 24, letterSpacing: 3, color: C.textMuted }}>CARTE JOUEUR — 2025</span>
      </div>
      <div style={{ position: 'relative', height: 5, background: C.textPrimary, marginTop: 28 }}>
        <div style={{ position: 'absolute', left: 0, top: 0, width: 240, height: 5, background: C.brand }} />
      </div>

      {/* name block */}
      <div style={{ marginTop: 70 }}>
        <div style={{ fontFamily: F.ui, fontWeight: 800, fontSize: 26, letterSpacing: 6, color: gold, marginBottom: 18 }}>● {lg(p).toUpperCase()} · RANG #{p.rank}</div>
        <div style={{ fontFamily: F.welcome, fontWeight: 900, fontStyle: 'italic', fontSize: 184, lineHeight: 0.84, color: C.textPrimary, textTransform: 'uppercase', letterSpacing: -3 }}>
          {p.name.split(' ')[0]}<br />{p.name.split(' ').slice(1).join(' ')}
        </div>
      </div>

      {/* big number + ring */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 40, marginTop: 20 }}>
        <div style={{ flexShrink: 0 }}>
          <div style={{ fontFamily: F.ui, fontWeight: 800, fontSize: 26, letterSpacing: 5, color: C.textMuted, marginBottom: -6 }}>NIVEAU PADEL</div>
          <div style={{ fontFamily: F.display, fontSize: 248, lineHeight: 0.82, color: C.textPrimary, letterSpacing: -6 }}>{p.level.toFixed(2)}</div>
        </div>
        <Ring rate={p.winRate} size={200} sw={16} track="rgba(10,10,10,0.10)" color={C.textPrimary} labelColor={C.textPrimary} subColor={C.textMuted} />
      </div>

      {/* stat line */}
      <div style={{ borderTop: `2px solid ${C.textPrimary}`, paddingTop: 40, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {[[p.wins, 'VICTOIRES'], [p.losses, 'DÉFAITES'], [p.total, 'MATCHS'], [p.streak, 'SÉRIE 🔥']].map(([v, l], i) => (
          <React.Fragment key={l}>
            {i > 0 && <div style={{ width: 2, height: 90, background: C.border }} />}
            <div style={{ textAlign: 'center', flex: 1 }}>
              <div style={{ fontFamily: F.display, fontSize: 96, color: C.textPrimary, lineHeight: 0.9 }}>{v}</div>
              <div style={{ fontFamily: F.ui, fontWeight: 800, fontSize: 22, letterSpacing: 2, color: C.textMuted, marginTop: 6 }}>{l}</div>
            </div>
          </React.Fragment>
        ))}
      </div>
      <div style={{ textAlign: 'center', marginTop: 44, fontFamily: F.ui, fontWeight: 800, fontSize: 24, letterSpacing: 4, color: C.textMuted }}>{p.club.toUpperCase()} · PAGMATCH.COM</div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   STYLE 4 — TERRAIN / COURT  (immersif sport, néon jaune)
   ════════════════════════════════════════════════════════════════════ */
function StoryCourt({ player: p }) {
  const gold = C.brand;
  return (
    <div style={{ width: 1080, height: 1920, position: 'relative', overflow: 'hidden', background: 'linear-gradient(180deg, #0B3B3B 0%, #072A2E 55%, #04181C 100%)' }}>
      {/* court perspective (SVG) */}
      <svg width={1080} height={1920} viewBox="0 0 1080 1920" style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <linearGradient id="courtFloor" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0E5050" stopOpacity="0.55" />
            <stop offset="1" stopColor="#0E5050" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* floor trapezoid */}
        <polygon points="430,520 650,520 980,1720 100,1720" fill="url(#courtFloor)" />
        <g stroke="rgba(255,255,255,0.16)" strokeWidth="3" fill="none">
          <polygon points="430,520 650,520 980,1720 100,1720" />
          {/* net line */}
          <line x1="290" y1="1080" x2="790" y2="1080" stroke={gold} strokeOpacity="0.5" strokeWidth="4" />
          {/* service lines */}
          <line x1="372" y1="800" x2="708" y2="800" />
          <line x1="210" y1="1420" x2="870" y2="1420" />
          {/* center */}
          <line x1="540" y1="1080" x2="540" y2="1720" />
        </g>
      </svg>
      {/* glow + scrim */}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 50% 18%, rgba(255,193,26,0.18), transparent 45%)' }} />
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(4,16,18,0.55) 0%, transparent 30%, rgba(4,16,18,0.65) 100%)' }} />

      <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '110px 90px 100px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Wordmark light size={1} />
          <span style={{ fontFamily: F.ui, fontWeight: 900, fontSize: 22, letterSpacing: 3, color: gold, border: `1.5px solid ${gold}77`, borderRadius: 999, padding: '8px 18px' }}>● {lg(p).toUpperCase()}</span>
        </div>

        <div style={{ textAlign: 'center' }}>
          {/* feu banner */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 16, padding: '16px 36px', borderRadius: 999, background: 'rgba(255,193,26,0.12)', border: `2px solid ${gold}`, boxShadow: `0 0 50px ${gold}55`, marginBottom: 44 }}>
            <span style={{ fontSize: 44 }}>🔥</span>
            <span style={{ fontFamily: F.ui, fontWeight: 900, fontSize: 34, letterSpacing: 3, color: gold }}>{p.streak} VICTOIRES DE SUITE</span>
          </div>
          <div style={{ fontFamily: F.welcome, fontWeight: 900, fontStyle: 'italic', fontSize: 150, lineHeight: 0.9, color: '#fff', textTransform: 'uppercase', letterSpacing: -2, whiteSpace: 'nowrap', textShadow: '0 8px 40px rgba(0,0,0,0.5)' }}>{p.name}</div>
          <div style={{ marginTop: 50, display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 24 }}>
            <span style={{ fontFamily: F.ui, fontWeight: 800, fontSize: 32, letterSpacing: 4, color: 'rgba(255,255,255,0.6)' }}>NIVEAU</span>
            <span style={{ fontFamily: F.display, fontSize: 230, lineHeight: 0.8, color: gold, letterSpacing: -4, textShadow: `0 0 60px ${gold}66` }}>{p.level.toFixed(2)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 44 }}>
            <FormDots form={p.recentForm} size={56} gap={16} ring />
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {[['MATCHS', p.total], ['VICTOIRES', p.wins], ['WIN', p.winRate + '%']].map(([l, v]) => (
            <div key={l} style={{ textAlign: 'center', flex: 1 }}>
              <div style={{ fontFamily: F.display, fontSize: 72, color: '#fff' }}>{v}</div>
              <div style={{ fontFamily: F.ui, fontWeight: 800, fontSize: 22, letterSpacing: 3, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>{l}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   STYLE 5 — STAT SHEET / BILAN  (data viz dark)
   ════════════════════════════════════════════════════════════════════ */
function StoryStatSheet({ player: p }) {
  const gold = C.brand;
  const delta = (p.eloSeries[p.eloSeries.length - 1] - p.eloSeries[0]).toFixed(2);
  const panel = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 28, padding: 34 };
  const kicker = { fontFamily: F.ui, fontWeight: 800, fontSize: 22, letterSpacing: 4, color: 'rgba(255,255,255,0.4)' };
  return (
    <div style={{ width: 1080, height: 1920, background: '#0E1116', position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: '108px 80px 92px' }}>
      <div style={{ position: 'absolute', inset: 0, opacity: 0.6, backgroundImage: 'linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)', backgroundSize: '80px 80px' }} />

      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', gap: 28 }}>
        {/* header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ ...kicker, marginBottom: 8 }}>BILAN JOUEUR</div>
            <div style={{ fontFamily: F.welcome, fontWeight: 900, fontStyle: 'italic', fontSize: 110, lineHeight: 0.84, color: '#fff', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{p.name}</div>
            <div style={{ marginTop: 14, fontFamily: F.ui, fontWeight: 800, fontSize: 26, color: gold, letterSpacing: 2 }}>● {lg(p).toUpperCase()} · NIVEAU {p.level.toFixed(2)} · RANG #{p.rank}</div>
          </div>
          <Wordmark light size={0.8} />
        </div>

        {/* elo chart panel */}
        <div style={panel}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={kicker}>ÉVOLUTION DU NIVEAU</span>
            <span style={{ fontFamily: F.display, fontSize: 48, color: C.success }}>+{delta}</span>
          </div>
          <Sparkline series={p.eloSeries} w={880} h={210} />
        </div>

        {/* radar + ring */}
        <div style={{ display: 'flex', gap: 28 }}>
          <div style={{ ...panel, flex: 1.2, display: 'flex', flexDirection: 'column' }}>
            <span style={kicker}>ADN DU JOUEUR</span>
            <div style={{ display: 'flex', justifyContent: 'center' }}><Radar values={p.dna} size={380} /></div>
          </div>
          <div style={{ ...panel, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24 }}>
            <Ring rate={p.winRate} size={250} sw={20} track="rgba(255,255,255,0.1)" color={gold} labelColor="#fff" subColor="rgba(255,255,255,0.4)" />
            <div style={{ display: 'flex', gap: 14 }}>
              {p.badges.map(b => (
                <div key={b.label} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 44 }}>{b.icon}</div>
                  <div style={{ fontFamily: F.ui, fontWeight: 900, fontSize: 22, color: gold }}>×{b.count}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* KPI grid */}
        <div style={{ display: 'flex', gap: 18 }}>
          {[['MATCHS', p.total], ['VICTOIRES', p.wins], ['DÉFAITES', p.losses], ['SÉRIE', p.streak], ['FIABILITÉ', p.fiability + '%']].map(([l, v]) => (
            <div key={l} style={{ flex: 1, ...panel, padding: '24px 12px', textAlign: 'center' }}>
              <div style={{ fontFamily: F.display, fontSize: 60, color: '#fff', lineHeight: 0.9 }}>{v}</div>
              <div style={{ fontFamily: F.ui, fontWeight: 800, fontSize: 18, letterSpacing: 2, color: 'rgba(255,255,255,0.4)', marginTop: 8 }}>{l}</div>
            </div>
          ))}
        </div>

        <div style={{ textAlign: 'center', fontFamily: F.ui, fontWeight: 800, fontSize: 24, letterSpacing: 4, color: 'rgba(255,255,255,0.35)' }}>{p.club.toUpperCase()} · PAGMATCH.COM</div>
      </div>
    </div>
  );
}

/* ── Registre des styles ──────────────────────────────────────────── */
const STORY_STYLES = [
  { id: 'dark',     name: 'Carte Noire',   sub: 'Premium · or',        Comp: StoryCardDark },
  { id: 'trading',  name: 'Trading Card',  sub: 'Collector · holo',    Comp: StoryTradingCard },
  { id: 'editorial',name: 'Éditorial',     sub: 'Crème · magazine',    Comp: StoryEditorialLight },
  { id: 'court',    name: 'Terrain',       sub: 'Immersif · néon',     Comp: StoryCourt },
  { id: 'stats',    name: 'Bilan',         sub: 'Data · saison',       Comp: StoryStatSheet },
];

Object.assign(window, { StoryFrame, STORY_STYLES, StoryCardDark, StoryTradingCard, StoryEditorialLight, StoryCourt, StoryStatSheet, PMRing: Ring, PMRadar: Radar, PMSparkline: Sparkline, PMQr: QRCode, PMInvite: Invite });
