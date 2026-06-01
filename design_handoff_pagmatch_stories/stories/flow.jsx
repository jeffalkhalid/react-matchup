/* PagMatch — flux de partage cliquable (recrée l'écran profil + composer + share sheet).
   S'appuie sur window.PM (data) et window.STORY_STYLES / StoryFrame (styles.jsx). */

const PMC = window.PM.Colors;
const PMP = window.PM.player;
const FF = {
  display: '"Anton", system-ui, sans-serif',
  welcome: '"Barlow Condensed", system-ui, sans-serif',
  ui: '"Inter", system-ui, sans-serif',
};
const lgName = window.PM.leagueLabel[PMP.league];
const lgCol = PMC.league[PMP.league];

/* ── Petites icônes ──────────────────────────────────────────────── */
function Chevron({ color = '#fff', d = 'left' }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d={d === 'left' ? 'M15 18l-6-6 6-6' : 'M9 6l6 6-6 6'} /></svg>;
}

/* ── Écran profil (recrée app/(tabs)/player/[id].tsx) ─────────────── */
function ProfileScreen({ onStory }) {
  const p = PMP;
  return (
    <div style={{ height: '100%', overflow: 'auto', background: PMC.bg, fontFamily: FF.ui }}>
      {/* top bar */}
      <div style={{ background: PMC.heroBg, paddingTop: 64, paddingLeft: 16, paddingRight: 16, paddingBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ width: 36, height: 36, borderRadius: 12, background: 'rgba(255,255,255,0.1)', display: 'grid', placeItems: 'center' }}><Chevron /></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onStory} style={{ display: 'flex', alignItems: 'center', gap: 5, height: 36, padding: '0 13px', borderRadius: 12, background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.22)', cursor: 'pointer' }}>
            <span style={{ fontSize: 13 }}>📸</span>
            <span style={{ color: '#fff', fontSize: 12, fontWeight: 900, fontFamily: FF.ui }}>Story</span>
          </button>
          <div style={{ width: 36, height: 36, borderRadius: 12, background: 'rgba(255,255,255,0.1)', display: 'grid', placeItems: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
          </div>
        </div>
      </div>

      {/* hero */}
      <div style={{ background: PMC.heroBg, padding: '10px 20px 42px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ width: 82, height: 82, borderRadius: 41, border: `3px solid ${lgCol}`, background: lgCol + '22', display: 'grid', placeItems: 'center', marginBottom: 12 }}>
          <span style={{ color: '#fff', fontSize: 30, fontWeight: 900 }}>{p.initials}</span>
        </div>
        <div style={{ fontFamily: FF.welcome, fontWeight: 900, fontStyle: 'italic', fontSize: 34, color: '#fff', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{p.name}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <span style={{ background: lgCol + '25', border: `1px solid ${lgCol}`, color: lgCol, fontSize: 10, fontWeight: 900, letterSpacing: 1, textTransform: 'uppercase', padding: '4px 10px', borderRadius: 999 }}>{lgName}</span>
          <span style={{ background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.75)', fontSize: 10, fontWeight: 700, padding: '4px 10px', borderRadius: 999 }}>Rang #{p.rank}</span>
          <span style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#16a34a', fontSize: 10, fontWeight: 900, padding: '4px 8px', borderRadius: 999 }}>🏆 {p.frmtRank} ✓</span>
        </div>
      </div>

      {/* floating card */}
      <div style={{ margin: '-22px 16px 0', borderRadius: 24, background: '#fff', border: `1px solid ${PMC.border}`, padding: 20, boxShadow: '0 8px 28px rgba(0,0,0,0.08)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 18, borderBottom: `1px solid ${PMC.bgCardAlt}` }}>
          <div>
            <div style={{ fontSize: 10, color: PMC.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>Niveau padel</div>
            <div style={{ fontFamily: FF.display, fontSize: 48, color: lgCol, lineHeight: 1.05 }}>{p.level.toFixed(2)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 12, color: PMC.textSecondary, marginBottom: 6 }}>Fiabilité {p.fiability}%
              <span style={{ marginLeft: 6, background: PMC.success + '20', color: PMC.success, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999 }}>{p.fiabilityLabel}</span>
            </div>
            <div style={{ width: 130, marginLeft: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 9, color: PMC.textMuted }}>→ Niv. {p.nextLevel.toFixed(1)}</span>
                <span style={{ fontSize: 9, color: lgCol, fontWeight: 700 }}>{Math.round(p.levelPct * 100)}%</span>
              </div>
              <div style={{ height: 5, borderRadius: 3, background: PMC.bgCardAlt }}><div style={{ height: 5, borderRadius: 3, background: lgCol, width: `${p.levelPct * 100}%` }} /></div>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 0', borderBottom: `1px solid ${PMC.bgCardAlt}` }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: PMC.textMuted, textTransform: 'uppercase', letterSpacing: 1 }}>Forme</span>
          <div style={{ display: 'flex', gap: 4, flex: 1 }}>
            {p.recentForm.map((r, i) => <div key={i} style={{ width: 22, height: 22, borderRadius: 11, background: r === 'W' ? PMC.success : PMC.danger, display: 'grid', placeItems: 'center', color: '#fff', fontSize: 9, fontWeight: 900 }}>{r}</div>)}
          </div>
          <span style={{ fontSize: 11, fontWeight: 900, color: PMC.warning }}>🔥 {p.streak}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          {[['Matchs', p.total, PMC.textPrimary, PMC.bg, PMC.border], ['Victoires', p.wins, PMC.success, '#f0fdf4', '#bbf7d0'], ['Défaites', p.losses, PMC.danger, '#fff5f5', '#fecaca']].map(([l, v, col, bg, bd]) => (
            <div key={l} style={{ flex: 1, textAlign: 'center', background: bg, borderRadius: 14, padding: '12px 0', border: `1px solid ${bd}` }}>
              <div style={{ fontFamily: FF.display, fontSize: 26, color: col }}>{v}</div>
              <div style={{ fontSize: 9, fontWeight: 600, color: PMC.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 2 }}>{l}</div>
            </div>
          ))}
        </div>
      </div>

      {/* stats card (abrégé) */}
      <div style={{ margin: '16px 16px 0', borderRadius: 20, background: '#fff', border: `1px solid ${PMC.border}`, padding: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: PMC.textMuted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 14 }}>Statistiques</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            <div><div style={{ fontFamily: FF.display, fontSize: 22, color: PMC.brandDeep }}>{p.bestPartner}</div><div style={{ fontSize: 10, fontWeight: 600, color: PMC.textMuted, textTransform: 'uppercase' }}>Partenaire</div></div>
            <div><div style={{ fontFamily: FF.display, fontSize: 22, color: PMC.danger }}>{p.nemesis}</div><div style={{ fontSize: 10, fontWeight: 600, color: PMC.textMuted, textTransform: 'uppercase' }}>Bête noire</div></div>
          </div>
          <window.PMRing rate={p.winRate} size={84} sw={7} track={PMC.bgCardAlt} color={PMC.textPrimary} labelColor={PMC.textPrimary} subColor={PMC.textMuted} />
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          {p.achievements.map(a => <div key={a.name} style={{ flex: 1, textAlign: 'center', background: PMC.bg, borderRadius: 12, padding: '10px 0', border: `1px solid ${PMC.border}` }}><div style={{ fontSize: 22 }}>{a.emoji}</div><div style={{ fontSize: 9, fontWeight: 800, color: PMC.textSecondary, marginTop: 2 }}>{a.name}</div></div>)}
        </div>
      </div>
      <div style={{ height: 40 }} />
    </div>
  );
}

/* ── Composer (modal partage) ─────────────────────────────────────── */
function Composer({ open, mode, setMode, list, idx, setIdx, onClose, onShare, justSaved }) {
  const cur = list[Math.min(idx, list.length - 1)];
  const Cur = cur.Comp;
  const MODES = [['profil', 'Profil'], ['match', 'Match'], ['photo', 'Photo']];
  return (
    <div style={{
      position: 'absolute', inset: 0, background: PMC.bg, zIndex: 40,
      transform: open ? 'translateY(0)' : 'translateY(100%)',
      transition: 'transform .4s cubic-bezier(.32,.72,0,1)',
      display: 'flex', flexDirection: 'column', fontFamily: FF.ui,
    }}>
      {/* header */}
      <div style={{ paddingTop: 58, padding: '58px 16px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fff' }}>
        <button onClick={onClose} style={{ width: 36, height: 36, borderRadius: 10, background: PMC.bgCardAlt, border: 'none', cursor: 'pointer', fontSize: 18, color: PMC.textSecondary }}>✕</button>
        <span style={{ fontSize: 16, fontWeight: 900, color: PMC.textPrimary, whiteSpace: 'nowrap' }}>📸 Ma story</span>
        <div style={{ width: 36 }} />
      </div>

      {/* segmented : Profil / Match / Photo */}
      <div style={{ background: '#fff', padding: '0 16px 12px', borderBottom: `1px solid ${PMC.bgCardAlt}` }}>
        <div style={{ display: 'flex', background: PMC.bg, borderRadius: 12, padding: 4, gap: 4, border: `1px solid ${PMC.border}` }}>
          {MODES.map(([k, l]) => {
            const on = mode === k;
            return <button key={k} onClick={() => setMode(k)} style={{ flex: 1, padding: '9px 0', borderRadius: 9, border: 'none', cursor: 'pointer', background: on ? PMC.primary : 'transparent', color: on ? '#fff' : PMC.textSecondary, fontWeight: 900, fontSize: 13, fontFamily: FF.ui }}>{l}</button>;
          })}
        </div>
      </div>

      {/* preview */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff', padding: '12px 0', minHeight: 0 }}>
        <div style={{ borderRadius: 18, overflow: 'hidden', boxShadow: '0 18px 50px rgba(0,0,0,0.22)', border: '1px solid rgba(0,0,0,0.06)' }}>
          <window.StoryFrame w={224} radius={18}><Cur player={PMP} match={window.PM.match} slotId={'cmp-' + cur.id} /></window.StoryFrame>
        </div>
      </div>

      {/* style selector */}
      <div style={{ background: '#fff', borderTop: `1px solid ${PMC.bgCardAlt}`, paddingTop: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 900, color: PMC.textMuted, letterSpacing: 2, padding: '0 16px 8px' }}>STYLE{mode === 'photo' ? ' · DÉPOSE TA PHOTO' : ''}</div>
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '0 16px 14px' }}>
          {list.map((s, i) => {
            const active = i === idx;
            return (
              <button key={s.id} onClick={() => setIdx(i)} style={{
                flex: '0 0 auto', textAlign: 'left', cursor: 'pointer',
                padding: '8px 14px', borderRadius: 12,
                border: `2px solid ${active ? PMC.brand : PMC.border}`,
                background: active ? 'rgba(255,193,26,0.14)' : PMC.bg,
              }}>
                <div style={{ fontSize: 13, fontWeight: 900, color: active ? PMC.brandDeep : PMC.textPrimary }}>{s.name}</div>
                <div style={{ fontSize: 10, fontWeight: 600, color: PMC.textMuted, marginTop: 1 }}>{s.sub}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* CTA */}
      <div style={{ display: 'flex', gap: 10, padding: '12px 16px 30px', background: '#fff', borderTop: `1px solid ${PMC.bgCardAlt}` }}>
        <button style={{ flex: 1, padding: '13px 0', borderRadius: 14, border: `1.5px solid ${PMC.border}`, background: PMC.bg, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <span style={{ fontSize: 15 }}>{justSaved ? '✅' : '💾'}</span>
          <span style={{ fontSize: 13, fontWeight: 900, color: PMC.textPrimary }}>{justSaved ? 'Sauvé' : 'Sauver'}</span>
        </button>
        <button onClick={onShare} style={{ flex: 1.4, padding: '13px 0', borderRadius: 14, border: 'none', background: PMC.primary, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, boxShadow: '0 4px 14px rgba(0,0,0,0.3)' }}>
          <span style={{ fontSize: 15 }}>📤</span>
          <span style={{ fontSize: 13, fontWeight: 900, color: '#fff' }}>Partager</span>
        </button>
      </div>
    </div>
  );
}

/* ── Share sheet iOS ──────────────────────────────────────────────── */
function ShareSheet({ open, Cur, curId, label, onClose, onPick, picked }) {
  const apps = [
    { id: 'ig', label: 'Stories', sub: 'Instagram', bg: 'linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)', glyph: '📷', hot: true },
    { id: 'wa', label: 'Statut', sub: 'WhatsApp', bg: '#25D366', glyph: '💬' },
    { id: 'snap', label: 'Snap', sub: 'Snapchat', bg: '#FFFC00', glyph: '👻' },
    { id: 'save', label: 'Enregistrer', sub: 'Photos', bg: '#0A0A0A', glyph: '⬇️' },
  ];
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 60, pointerEvents: open ? 'auto' : 'none' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', opacity: open ? 1 : 0, transition: 'opacity .3s' }} />
      <div style={{
        position: 'absolute', left: 8, right: 8, bottom: 8,
        transform: open ? 'translateY(0)' : 'translateY(120%)',
        transition: 'transform .42s cubic-bezier(.32,.72,0,1)',
        fontFamily: '-apple-system, system-ui',
      }}>
        {/* card */}
        <div style={{ background: 'rgba(250,250,250,0.96)', backdropFilter: 'blur(20px)', borderRadius: 22, overflow: 'hidden', marginBottom: 8 }}>
          {/* header: preview + meta */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, borderBottom: '0.5px solid rgba(0,0,0,0.1)' }}>
            <div style={{ borderRadius: 8, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.18)' }}>
              <window.StoryFrame w={48} radius={8}><Cur player={PMP} match={window.PM.match} slotId={'cmp-' + curId} /></window.StoryFrame>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#000' }}>{label}</div>
              <div style={{ fontSize: 13, color: 'rgba(60,60,67,0.6)' }}>Image · 1080 × 1920</div>
            </div>
          </div>
          {/* app row */}
          <div style={{ display: 'flex', gap: 16, padding: '16px 18px', overflowX: 'auto' }}>
            {apps.map(a => (
              <button key={a.id} onClick={() => onPick(a.id)} style={{ flex: '0 0 auto', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 64 }}>
                <div style={{ width: 60, height: 60, borderRadius: 16, background: a.bg, display: 'grid', placeItems: 'center', fontSize: 28, boxShadow: a.hot ? '0 0 0 3px rgba(220,39,67,0.3)' : 'none' }}>{a.glyph}</div>
                <div style={{ textAlign: 'center', lineHeight: 1.15 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#000' }}>{a.sub}</div>
                  <div style={{ fontSize: 11, color: 'rgba(60,60,67,0.6)' }}>{a.label}</div>
                </div>
              </button>
            ))}
          </div>
          {/* actions */}
          {['Copier', "Enregistrer l'image"].map((t, i) => (
            <div key={t} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderTop: '0.5px solid rgba(0,0,0,0.08)', fontSize: 17, color: '#000' }}>
              {t}<span style={{ fontSize: 18 }}>{i === 0 ? '⧉' : '⬇'}</span>
            </div>
          ))}
        </div>
        {/* cancel */}
        <button onClick={onClose} style={{ width: '100%', padding: '16px 0', borderRadius: 22, border: 'none', background: 'rgba(250,250,250,0.96)', backdropFilter: 'blur(20px)', fontSize: 17, fontWeight: 600, color: '#007AFF', cursor: 'pointer' }}>Annuler</button>
      </div>

      {/* success toast */}
      <div style={{
        position: 'absolute', left: '50%', top: '42%', transform: `translate(-50%,-50%) scale(${picked ? 1 : 0.8})`,
        opacity: picked ? 1 : 0, transition: 'all .3s', pointerEvents: 'none',
        background: 'rgba(10,10,10,0.92)', backdropFilter: 'blur(10px)', borderRadius: 20, padding: '24px 30px', textAlign: 'center',
      }}>
        <div style={{ fontSize: 40 }}>✅</div>
        <div style={{ color: '#fff', fontFamily: FF.ui, fontWeight: 800, fontSize: 15, marginTop: 8 }}>Story envoyée !</div>
      </div>
    </div>
  );
}

/* ── Prototype assemblé ───────────────────────────────────────────── */
function ShareFlowPrototype() {
  const LISTS = { profil: window.STORY_STYLES, match: window.MATCH_STYLES, photo: window.PHOTO_STYLES };
  const [composerOpen, setComposerOpen] = React.useState(false);
  const [shareOpen, setShareOpen] = React.useState(false);
  const [mode, setMode] = React.useState('profil');
  const [idx, setIdx] = React.useState(0);
  const [picked, setPicked] = React.useState(false);
  const [justSaved, setJustSaved] = React.useState(false);

  const list = LISTS[mode];
  const cur = list[Math.min(idx, list.length - 1)];
  const changeMode = (m) => { setMode(m); setIdx(0); };

  const handlePick = () => {
    setPicked(true);
    setTimeout(() => { setPicked(false); setShareOpen(false); }, 1600);
  };

  return (
    <window.IOSDevice>
      <div style={{ position: 'relative', height: '100%' }}>
        <ProfileScreen onStory={() => setComposerOpen(true)} />
        <Composer
          open={composerOpen}
          mode={mode}
          setMode={changeMode}
          list={list}
          idx={idx}
          setIdx={setIdx}
          justSaved={justSaved}
          onClose={() => setComposerOpen(false)}
          onShare={() => setShareOpen(true)}
        />
        <ShareSheet open={shareOpen} Cur={cur.Comp} curId={cur.id} label={`Ma story · ${cur.name}`} picked={picked} onClose={() => setShareOpen(false)} onPick={handlePick} />
      </div>
    </window.IOSDevice>
  );
}

window.ShareFlowPrototype = ShareFlowPrototype;
