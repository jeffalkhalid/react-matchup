/* PagMatch — styles "Résultat de match" + overlays "Photo (façon Strava)".
   Rendu 1080×1920, mis à l'échelle par window.StoryFrame. Données: window.PM.match. */

const MC = window.PM.Colors;
const MFONT = {
  display: '"Anton", system-ui, sans-serif',
  welcome: '"Barlow Condensed", system-ui, sans-serif',
  ui: '"Inter", system-ui, sans-serif',
};

/* ── briques ──────────────────────────────────────────────────────── */
function BrandChip({ light = true, blur = false }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12, padding: blur ? '12px 20px 12px 12px' : 0, borderRadius: 999, background: blur ? 'rgba(0,0,0,0.32)' : 'transparent', backdropFilter: blur ? 'blur(14px)' : 'none' }}>
      <div style={{ width: 48, height: 48, borderRadius: 13, background: MC.brand, display: 'grid', placeItems: 'center', boxShadow: `0 6px 20px ${MC.brand}55` }}><span style={{ fontSize: 26 }}>🎾</span></div>
      <span style={{ fontFamily: MFONT.ui, fontWeight: 900, fontSize: 24, letterSpacing: 5, color: light ? 'rgba(255,255,255,0.85)' : 'rgba(10,10,10,0.7)' }}>PAGMATCH</span>
    </div>
  );
}

function Avatars({ names, size = 70, dark }) {
  const HASH = ['#4f46e5', '#ec4899', '#8b5cf6', '#14b8a6', '#f59e0b', '#10b981'];
  const col = n => HASH[[...(n || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % HASH.length];
  return (
    <div style={{ display: 'flex' }}>
      {names.map((n, i) => (
        <div key={i} style={{ width: size, height: size, borderRadius: size / 2, background: col(n), marginLeft: i ? -size * 0.28 : 0, border: `${size * 0.05}px solid ${dark ? '#0A0A0A' : '#fff'}`, display: 'grid', placeItems: 'center', fontFamily: MFONT.ui, fontWeight: 900, fontSize: size * 0.42, color: '#fff' }}>{(n || '?')[0].toUpperCase()}</div>
      ))}
    </div>
  );
}

// Score en gros (sets) — mon score mis en avant
function BigSets({ sets, accent, mine = '#fff', theirs = 'rgba(255,255,255,0.5)', size = 150 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 30, flexWrap: 'wrap' }}>
      {sets.map(([a, b], i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontFamily: MFONT.display, fontSize: size, color: mine, lineHeight: 0.9, letterSpacing: -3 }}>{a}</span>
          <span style={{ fontFamily: MFONT.display, fontSize: size * 0.42, color: accent }}>–</span>
          <span style={{ fontFamily: MFONT.display, fontSize: size * 0.78, color: theirs, lineHeight: 0.9 }}>{b}</span>
        </div>
      ))}
    </div>
  );
}

const setsWon = (m) => m.sets.filter(([a, b]) => a > b).length;
const setsLost = (m) => m.sets.filter(([a, b]) => a < b).length;

/* ════════════════════════════════════════════════════════════════════
   MATCH 1 — SCORE HERO (noir / or)
   ════════════════════════════════════════════════════════════════════ */
function MatchScoreHero({ match: m }) {
  const win = m.result === 'win';
  const acc = win ? MC.success : MC.danger;
  return (
    <div style={{ width: 1080, height: 1920, background: '#0A0A0A', position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '110px 90px 96px' }}>
      <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(circle at 80% 8%, ${acc}22, transparent 50%), radial-gradient(circle at 15% 95%, rgba(255,193,26,0.08), transparent 50%)` }} />
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <BrandChip />
        <span style={{ fontFamily: MFONT.ui, fontWeight: 900, fontSize: 22, letterSpacing: 4, color: 'rgba(255,255,255,0.35)' }}>{m.type.toUpperCase()}</span>
      </div>

      <div style={{ position: 'relative', textAlign: 'center' }}>
        <div style={{ display: 'inline-block', fontFamily: MFONT.welcome, fontWeight: 900, fontStyle: 'italic', fontSize: 90, color: acc, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 24 }}>{win ? 'Victoire 🏆' : 'Défaite'}</div>
        <BigSets sets={m.sets} accent={MC.brand} size={188} />
        <div style={{ marginTop: 24, fontFamily: MFONT.ui, fontWeight: 800, fontSize: 28, letterSpacing: 3, color: 'rgba(255,255,255,0.5)' }}>{setsWon(m)}–{setsLost(m)} SETS · {m.eloDelta} NIV.</div>
      </div>

      <div style={{ position: 'relative' }}>
        {/* équipes */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, marginBottom: 22 }}>
          <div style={{ width: 6, height: 96, background: MC.brand, borderRadius: 3 }} />
          <Avatars names={m.winners} size={84} dark />
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: MFONT.ui, fontWeight: 900, fontSize: 20, letterSpacing: 3, color: MC.brand }}>VAINQUEURS</div>
            <div style={{ fontFamily: MFONT.welcome, fontWeight: 900, fontStyle: 'italic', fontSize: 56, color: '#fff', textTransform: 'uppercase', lineHeight: 0.95 }}>{m.winners.join(' & ')}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, margin: '6px 0 22px' }}>
          <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.12)' }} />
          <span style={{ fontFamily: MFONT.ui, fontWeight: 900, fontSize: 22, letterSpacing: 6, color: 'rgba(255,255,255,0.3)' }}>VS</span>
          <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.12)' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <div style={{ width: 6, height: 80, background: 'rgba(255,255,255,0.15)', borderRadius: 3 }} />
          <Avatars names={m.losers} size={70} dark />
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: MFONT.ui, fontWeight: 900, fontSize: 18, letterSpacing: 3, color: 'rgba(255,255,255,0.4)' }}>ADVERSAIRES</div>
            <div style={{ fontFamily: MFONT.welcome, fontWeight: 900, fontStyle: 'italic', fontSize: 46, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', lineHeight: 0.95 }}>{m.losers.join(' & ')}</div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 40, paddingTop: 30, borderTop: '1px solid rgba(255,255,255,0.12)' }}>
          {window.PMInvite ? <window.PMInvite light accent={MC.brand} size={120} /> : null}
          <span style={{ fontFamily: MFONT.ui, fontWeight: 700, fontSize: 22, color: 'rgba(255,255,255,0.45)', textAlign: 'right', maxWidth: 240 }}>📍 {m.location}<br />{m.date}</span>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   MATCH 2 — VERSUS (split haut/bas)
   ════════════════════════════════════════════════════════════════════ */
function MatchVersus({ match: m }) {
  return (
    <div style={{ width: 1080, height: 1920, position: 'relative', overflow: 'hidden', background: '#0A0A0A', display: 'flex', flexDirection: 'column' }}>
      {/* haut — vainqueurs */}
      <div style={{ flex: 1, background: `linear-gradient(160deg, ${MC.brandDeep}, #1a1206)`, position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 28, padding: '120px 80px 90px' }}>
        <div style={{ position: 'absolute', top: 96, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}><BrandChip /></div>
        <div style={{ fontSize: 92 }}>🏆</div>
        <Avatars names={m.winners} size={120} dark={false} />
        <div style={{ fontFamily: MFONT.welcome, fontWeight: 900, fontStyle: 'italic', fontSize: 84, color: '#fff', textTransform: 'uppercase', textAlign: 'center', lineHeight: 0.9 }}>{m.winners.join(' & ')}</div>
        <div style={{ fontFamily: MFONT.ui, fontWeight: 900, fontSize: 22, letterSpacing: 4, color: 'rgba(255,255,255,0.7)' }}>VAINQUEURS</div>
      </div>

      {/* bande score centrale */}
      <div style={{ position: 'relative', background: '#0A0A0A', padding: '40px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, boxShadow: '0 0 60px rgba(0,0,0,0.6)' }}>
        <div style={{ position: 'absolute', top: -54, left: '50%', transform: 'translateX(-50%)', width: 108, height: 108, borderRadius: 54, background: '#0A0A0A', border: `4px solid ${MC.brand}`, display: 'grid', placeItems: 'center', fontFamily: MFONT.ui, fontWeight: 900, fontSize: 32, color: MC.brand, letterSpacing: 2 }}>VS</div>
        <BigSets sets={m.sets} accent={MC.brand} size={130} />
        <div style={{ fontFamily: MFONT.ui, fontWeight: 800, fontSize: 26, letterSpacing: 3, color: 'rgba(255,255,255,0.45)', marginTop: 6 }}>📍 {m.location} · {m.date}</div>
      </div>

      {/* bas — adversaires */}
      <div style={{ flex: 1, background: 'linear-gradient(200deg, #1a1a1c, #0A0A0A)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24, padding: '90px 80px 130px' }}>
        <Avatars names={m.losers} size={92} dark />
        <div style={{ fontFamily: MFONT.welcome, fontWeight: 900, fontStyle: 'italic', fontSize: 64, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', textAlign: 'center', lineHeight: 0.9 }}>{m.losers.join(' & ')}</div>
        <div style={{ fontFamily: MFONT.ui, fontWeight: 900, fontSize: 20, letterSpacing: 4, color: 'rgba(255,255,255,0.3)' }}>ADVERSAIRES</div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   MATCH 3 — TICKET (éditorial crème, stub de match)
   ════════════════════════════════════════════════════════════════════ */
function MatchTicket({ match: m }) {
  const win = m.result === 'win';
  return (
    <div style={{ width: 1080, height: 1920, background: '#0A0A0A', display: 'grid', placeItems: 'center' }}>
      <div style={{ width: 920, background: MC.bgCream, borderRadius: 36, overflow: 'hidden', position: 'relative', boxShadow: '0 40px 100px rgba(0,0,0,0.5)' }}>
        {/* entête */}
        <div style={{ background: '#0A0A0A', padding: '46px 56px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <BrandChip />
          <span style={{ fontFamily: MFONT.ui, fontWeight: 900, fontSize: 22, letterSpacing: 3, color: win ? MC.brand : MC.danger }}>{win ? 'VICTOIRE' : 'DÉFAITE'}</span>
        </div>
        {/* corps */}
        <div style={{ padding: '56px 56px 30px' }}>
          <div style={{ fontFamily: MFONT.ui, fontWeight: 800, fontSize: 24, letterSpacing: 4, color: MC.textMuted, textAlign: 'center' }}>SCORE FINAL</div>
          <div style={{ margin: '14px 0 30px' }}>
            <BigSets sets={m.sets} accent={MC.brandDeep} mine={MC.textPrimary} theirs={MC.textMuted} size={170} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: MFONT.ui, fontWeight: 800, fontSize: 26, color: MC.textSecondary }}>
            <span style={{ background: '#0A0A0A', color: '#fff', borderRadius: 8, padding: '4px 12px', fontSize: 22 }}>{setsWon(m)}–{setsLost(m)} sets</span>
            <span style={{ color: MC.success }}>{m.eloDelta} niv.</span>
          </div>
        </div>
        {/* perforation */}
        <div style={{ position: 'relative', height: 2, margin: '0 40px', borderTop: `4px dashed ${MC.border}` }}>
          <div style={{ position: 'absolute', left: -56, top: -28, width: 52, height: 52, borderRadius: 26, background: '#0A0A0A' }} />
          <div style={{ position: 'absolute', right: -56, top: -28, width: 52, height: 52, borderRadius: 26, background: '#0A0A0A' }} />
        </div>
        {/* équipes */}
        <div style={{ padding: '40px 56px 56px', display: 'flex', flexDirection: 'column', gap: 26 }}>
          {[{ t: m.winners, l: 'VAINQUEURS', c: MC.brandDeep }, { t: m.losers, l: 'ADVERSAIRES', c: MC.textMuted }].map(row => (
            <div key={row.l} style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
              <Avatars names={row.t} size={72} dark={false} />
              <div>
                <div style={{ fontFamily: MFONT.ui, fontWeight: 900, fontSize: 18, letterSpacing: 3, color: row.c }}>{row.l}</div>
                <div style={{ fontFamily: MFONT.welcome, fontWeight: 900, fontStyle: 'italic', fontSize: 50, color: MC.textPrimary, textTransform: 'uppercase', lineHeight: 0.95, whiteSpace: 'nowrap' }}>{row.t.join(' & ')}</div>
              </div>
            </div>
          ))}
          <div style={{ borderTop: `2px solid ${MC.border}`, paddingTop: 22, textAlign: 'center', fontFamily: MFONT.ui, fontWeight: 800, fontSize: 24, letterSpacing: 2, color: MC.textSecondary }}>📍 {m.location.toUpperCase()} · {m.date.toUpperCase()}</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 24, borderTop: `2px solid ${MC.border}`, paddingTop: 26 }}>
            {window.PMInvite ? <window.PMInvite light={false} accent={MC.brandDeep} size={120} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   PHOTO — façon Strava (ta photo en fond + données en surimpression)
   <image-slot> reçoit le drop ; les couches au-dessus sont pointer-events:none.
   ════════════════════════════════════════════════════════════════════ */
function PhotoBase({ slotId, children, scrim = 'linear-gradient(180deg, rgba(10,10,10,0.45) 0%, transparent 28%, transparent 42%, rgba(10,10,10,0.88) 100%)' }) {
  return (
    <div style={{ width: 1080, height: 1920, position: 'relative', overflow: 'hidden', background: '#16181d' }}>
      {React.createElement('image-slot', {
        id: slotId,
        fit: 'cover',
        shape: 'rect',
        placeholder: 'Dépose / prends ta photo',
        style: { position: 'absolute', inset: 0, width: '1080px', height: '1920px', display: 'block' },
      })}
      <div style={{ position: 'absolute', inset: 0, background: scrim, pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>{children}</div>
    </div>
  );
}

// PHOTO 1 — résultat de match (carte d'activité Strava)
function PhotoMatch({ match: m, slotId = 'photo-match' }) {
  const win = m.result === 'win';
  return (
    <PhotoBase slotId={slotId}>
      <div style={{ position: 'absolute', top: 100, left: 84, right: 84, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <BrandChip blur />
        <span style={{ fontFamily: MFONT.ui, fontWeight: 800, fontSize: 22, letterSpacing: 3, color: '#fff', background: 'rgba(0,0,0,0.32)', backdropFilter: 'blur(14px)', padding: '12px 20px', borderRadius: 999 }}>{m.date.toUpperCase()}</span>
      </div>
      <div style={{ position: 'absolute', left: 84, right: 84, bottom: 110 }}>
        <div style={{ display: 'inline-block', fontFamily: MFONT.welcome, fontWeight: 900, fontStyle: 'italic', fontSize: 72, color: MC.brand, textTransform: 'uppercase', marginBottom: 12, textShadow: '0 4px 30px rgba(0,0,0,0.6)' }}>{win ? 'Victoire' : 'Défaite'} 🎾</div>
        <BigSets sets={m.sets} accent={MC.brand} size={172} />
        <div style={{ height: 2, background: 'rgba(255,255,255,0.25)', margin: '34px 0 26px' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <div style={{ fontFamily: MFONT.ui, fontWeight: 900, fontSize: 36, color: '#fff', textShadow: '0 2px 14px rgba(0,0,0,0.7)' }}>{m.winners.join(' & ')}</div>
            <div style={{ fontFamily: MFONT.ui, fontWeight: 600, fontSize: 26, color: 'rgba(255,255,255,0.8)', marginTop: 4 }}>vs {m.losers.join(' & ')} · 📍 {m.location}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: MFONT.display, fontSize: 56, color: MC.brand, lineHeight: 0.9 }}>{m.eloDelta}</div>
            <div style={{ fontFamily: MFONT.ui, fontWeight: 800, fontSize: 20, letterSpacing: 2, color: 'rgba(255,255,255,0.7)' }}>NIVEAU</div>
          </div>
        </div>
        {/* invitation */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 30, padding: 16, borderRadius: 20, background: 'rgba(0,0,0,0.34)', backdropFilter: 'blur(14px)' }}>
          {window.PMQr && window.PM.invite.showQR !== false ? <window.PMQr size={96} /> : null}
          <div>
            <div style={{ fontFamily: MFONT.ui, fontWeight: 800, fontSize: 22, letterSpacing: 1, color: 'rgba(255,255,255,0.7)' }}>{window.PM.invite.cta}</div>
            <div style={{ fontFamily: MFONT.welcome, fontWeight: 900, fontStyle: 'italic', fontSize: 44, color: '#fff', textTransform: 'uppercase', lineHeight: 0.95 }}>PagMatch</div>
            <div style={{ fontFamily: MFONT.ui, fontWeight: 800, fontSize: 24, color: MC.brand }}>{window.PM.invite.link}{window.PM.invite.showApp !== false && window.PM.invite.appUrl ? ` · 📲 ${window.PM.invite.appUrl}` : ''}</div>
          </div>
        </div>
      </div>
    </PhotoBase>
  );
}

// PHOTO 2 — flex profil (niveau + ligue + win%)
function PhotoProfile({ player: p, slotId = 'photo-profile' }) {
  const gold = MC.league[p.league];
  return (
    <PhotoBase slotId={slotId}>
      <div style={{ position: 'absolute', top: 100, left: 84, right: 84, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <BrandChip blur />
        <span style={{ fontFamily: MFONT.ui, fontWeight: 900, fontSize: 22, letterSpacing: 3, color: gold, background: 'rgba(0,0,0,0.32)', backdropFilter: 'blur(14px)', padding: '12px 20px', borderRadius: 999 }}>● {window.PM.leagueLabel[p.league].toUpperCase()}</span>
      </div>
      <div style={{ position: 'absolute', left: 84, right: 84, bottom: 110 }}>
        <div style={{ fontFamily: MFONT.welcome, fontWeight: 900, fontStyle: 'italic', fontSize: 110, color: '#fff', textTransform: 'uppercase', lineHeight: 0.85, textShadow: '0 6px 40px rgba(0,0,0,0.6)' }}>{p.name}</div>
        <div style={{ display: 'flex', gap: 56, marginTop: 40, alignItems: 'flex-end' }}>
          {[['NIVEAU', p.level.toFixed(2), gold], ['WIN', p.winRate + '%', '#fff'], ['SÉRIE', '🔥' + p.streak, '#fff']].map(([l, v, c]) => (
            <div key={l}>
              <div style={{ fontFamily: MFONT.display, fontSize: 96, color: c, lineHeight: 0.85, textShadow: '0 4px 24px rgba(0,0,0,0.6)' }}>{v}</div>
              <div style={{ fontFamily: MFONT.ui, fontWeight: 800, fontSize: 22, letterSpacing: 3, color: 'rgba(255,255,255,0.8)', marginTop: 8 }}>{l}</div>
            </div>
          ))}
        </div>
      </div>
    </PhotoBase>
  );
}

// PHOTO 3 — minimal (barre basse épurée, très Strava)
function PhotoMinimal({ match: m, slotId = 'photo-min' }) {
  return (
    <PhotoBase slotId={slotId} scrim="linear-gradient(180deg, transparent 55%, rgba(10,10,10,0.85) 100%)">
      <div style={{ position: 'absolute', top: 104, left: 84 }}><BrandChip blur /></div>
      <div style={{ position: 'absolute', left: 84, right: 84, bottom: 120, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 30 }}>
        <div>
          <div style={{ fontFamily: MFONT.ui, fontWeight: 800, fontSize: 26, letterSpacing: 3, color: MC.brand, marginBottom: 8 }}>{m.result === 'win' ? 'VICTOIRE' : 'DÉFAITE'} · {m.date.toUpperCase()}</div>
          <div style={{ fontFamily: MFONT.welcome, fontWeight: 900, fontStyle: 'italic', fontSize: 60, color: '#fff', textTransform: 'uppercase', lineHeight: 0.92, textShadow: '0 4px 24px rgba(0,0,0,0.7)' }}>{m.winners.join(' & ')}</div>
          <div style={{ fontFamily: MFONT.ui, fontWeight: 600, fontSize: 24, color: 'rgba(255,255,255,0.78)', marginTop: 6 }}>vs {m.losers.join(' & ')}</div>
        </div>
        <div style={{ fontFamily: MFONT.display, fontSize: 92, color: '#fff', lineHeight: 0.85, textShadow: '0 4px 24px rgba(0,0,0,0.7)', whiteSpace: 'nowrap' }}>{m.score.split(' ')[0]}</div>
      </div>
    </PhotoBase>
  );
}

/* ── Registres ────────────────────────────────────────────────────── */
const MATCH_STYLES = [
  { id: 'mhero',   name: 'Score Hero',  sub: 'Noir · or',     Comp: MatchScoreHero, kind: 'match' },
  { id: 'mversus', name: 'Versus',      sub: 'Split · duel',  Comp: MatchVersus,    kind: 'match' },
  { id: 'mticket', name: 'Ticket',      sub: 'Crème · stub',  Comp: MatchTicket,    kind: 'match' },
];
const PHOTO_STYLES = [
  { id: 'pmatch',   name: 'Photo Match',  sub: 'Strava · résultat', Comp: PhotoMatch,   kind: 'photo' },
  { id: 'pprofile', name: 'Photo Profil', sub: 'Strava · flex',     Comp: PhotoProfile, kind: 'photo' },
  { id: 'pmin',     name: 'Photo Minimal',sub: 'Strava · épuré',    Comp: PhotoMinimal, kind: 'photo' },
];

Object.assign(window, {
  MATCH_STYLES, PHOTO_STYLES,
  MatchScoreHero, MatchVersus, MatchTicket,
  PhotoMatch, PhotoProfile, PhotoMinimal,
});
