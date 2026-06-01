/* PagMatch — profil joueur ÉPURÉ (2 versions sobres à comparer).
   Objectif : consulter un joueur — identité, niveau, bilan, forme, évolution,
   badges, préférences. Typo calme, sections aérées, partage discret en haut.
   Données via window.PM ; courbe via window.PMSparkline. */

const C2 = window.PM.Colors;
const Pl = window.PM.player;
const LBL2 = window.PM.leagueLabel;
const F2 = {
  display: '"Anton", system-ui, sans-serif',
  name: '"Barlow Condensed", system-ui, sans-serif',
  ui: '"Inter", system-ui, sans-serif',
};
const lgC = C2.league[Pl.league];
const lgN = LBL2[Pl.league];
const elo2 = (Pl.eloSeries[Pl.eloSeries.length - 1] - Pl.eloSeries[0]).toFixed(2);

const THEMES = {
  light: { page: '#F4F4F2', card: '#FFFFFF', border: '#ECEAE7', text: '#0A0A0A', sub: '#52525B', muted: '#9A9A9F', divider: '#F1F0EE', chip: '#F6F5F3', topbar: '#FFFFFF', accent: C2.brandDeep },
  dark: { page: '#0B0B0C', card: '#161618', border: 'rgba(255,255,255,0.08)', text: '#FFFFFF', sub: 'rgba(255,255,255,0.62)', muted: 'rgba(255,255,255,0.4)', divider: 'rgba(255,255,255,0.07)', chip: 'rgba(255,255,255,0.06)', topbar: '#0B0B0C', accent: C2.brand },
};

/* ── icônes fines ─────────────────────────────────────────────────── */
const Stroke = (d, t) => <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={t.sub} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>;
const IcoBack = (t) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={t.text} strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>;
const IcoShare = (t) => Stroke(<g><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" /><path d="M12 15V3" /><path d="M8 7l4-4 4 4" /></g>, t);
const IcoCamera = (t) => Stroke(<g><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l2-3h8l2 3h3a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="3.6" /></g>, t);
const IcoEdit = (t) => Stroke(<g><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></g>, t);

function IconBtn({ t, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      width: 38, height: 38, borderRadius: 12, display: 'grid', placeItems: 'center', cursor: onClick ? 'pointer' : 'default',
      background: t.chip, border: `1px solid ${t.border}`,
    }}>{children}</button>
  );
}
const Kick = ({ t, children, mb = 0 }) => <div style={{ fontFamily: F2.ui, fontWeight: 700, fontSize: 11, letterSpacing: 1.8, color: t.muted, textTransform: 'uppercase', marginBottom: mb }}>{children}</div>;

function Card({ t, children, style }) {
  return <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 18, padding: 18, ...style }}>{children}</div>;
}

/* ── écran profil paramétrable (clair / sombre) ───────────────────── */
function ProfileClean({ variant = 'light', isOwn = true, player = Pl, onStory, onDefier, onEdit, onMatchClick }) {
  const t = THEMES[variant];
  const [showAllMatches, setShowAllMatches] = React.useState(false);
  const p = player;
  const lc = C2.league[p.league];
  const ln = LBL2[p.league];
  const ed = (p.eloSeries[p.eloSeries.length - 1] - p.eloSeries[0]).toFixed(2);
  const initials = (p.name.trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 2) || p.initials).toUpperCase();
  const stats = [['Matchs', p.total, t.text], ['Victoires', p.wins, C2.success], ['Défaites', p.losses, C2.danger], ['Win', p.winRate + '%', t.accent]];
  const prefs = [
    ['Sexe', p.gender],
    ['Club', p.club],
    ['Côté de jeu', p.courtSide],
    ['Disponibilités', p.days.join(' · ')],
    ['Partenaire favori', p.bestPartner],
    ['Bête noire', p.nemesis],
  ];
  return (
    <div style={{ height: '100%', overflow: 'auto', background: t.page, fontFamily: F2.ui }}>
      {/* top bar */}
      <div style={{ position: 'sticky', top: 0, zIndex: 5, background: t.topbar, borderBottom: `1px solid ${t.border}`, paddingTop: 58, padding: '58px 16px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <IconBtn t={t}>{IcoBack(t)}</IconBtn>
        <span style={{ fontFamily: F2.ui, fontWeight: 700, fontSize: 16, color: t.text }}>Profil</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <IconBtn t={t} onClick={onStory}>{IcoCamera(t)}</IconBtn>
          {isOwn && <IconBtn t={t} onClick={onEdit}>{IcoEdit(t)}</IconBtn>}
        </div>
      </div>

      {/* identité */}
      <div style={{ padding: '24px 20px 4px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div style={{ width: 76, height: 76, borderRadius: 24, background: `linear-gradient(150deg, ${lc}, ${C2.brandDeep})`, display: 'grid', placeItems: 'center', marginBottom: 14 }}>
          <span style={{ fontFamily: F2.display, fontSize: 34, color: '#0A0A0A' }}>{initials}</span>
        </div>
        <div style={{ fontFamily: '-apple-system, system-ui, sans-serif', fontWeight: 800, fontSize: 26, lineHeight: 1.05, letterSpacing: -0.6, color: t.text, whiteSpace: 'nowrap' }}>{p.name}</div>
        <div style={{ display: 'flex', gap: 7, marginTop: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
          <span style={{ fontFamily: F2.ui, fontWeight: 800, fontSize: 11, letterSpacing: 0.5, color: lc, background: `${lc}1f`, border: `1px solid ${lc}55`, borderRadius: 999, padding: '5px 12px', whiteSpace: 'nowrap' }}>● {ln} · Niv. {p.level.toFixed(2)}</span>
          <span style={{ fontFamily: F2.ui, fontWeight: 700, fontSize: 11, color: t.sub, background: t.chip, border: `1px solid ${t.border}`, borderRadius: 999, padding: '5px 12px', whiteSpace: 'nowrap' }}>Rang #{p.rank}</span>
          <span style={{ fontFamily: F2.ui, fontWeight: 700, fontSize: 11, color: C2.success, background: `${C2.success}16`, border: `1px solid ${C2.success}44`, borderRadius: 999, padding: '5px 11px', whiteSpace: 'nowrap' }}>FRMT {p.frmtRank} ✓</span>
        </div>
      </div>

      {/* niveau + progression */}
      <div style={{ padding: '20px 20px 0' }}>
        <Card t={t} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <Kick t={t} mb={2}>Niveau padel</Kick>
            <div style={{ fontFamily: F2.display, fontSize: 50, lineHeight: 0.85, color: t.accent, letterSpacing: -1 }}>{p.level.toFixed(2)}</div>
          </div>
          <div style={{ flex: 1, maxWidth: 150 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontFamily: F2.ui, fontSize: 11, fontWeight: 600, color: t.sub }}>→ Niv. {p.nextLevel.toFixed(1)}</span>
              <span style={{ fontFamily: F2.ui, fontSize: 11, fontWeight: 800, color: t.accent }}>{Math.round(p.levelPct * 100)}%</span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: t.divider }}><div style={{ height: 6, borderRadius: 3, width: `${p.levelPct * 100}%`, background: t.accent }} /></div>
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontFamily: F2.ui, fontSize: 11, fontWeight: 600, color: t.sub }}>Fiabilité {p.fiability}%</span>
              <span style={{ fontFamily: F2.ui, fontSize: 9.5, fontWeight: 800, letterSpacing: 0.5, color: C2.success, background: `${C2.success}16`, borderRadius: 999, padding: '3px 8px' }}>{p.fiabilityLabel}</span>
            </div>
          </div>
        </Card>
      </div>

      {/* bilan + forme */}
      <div style={{ padding: '12px 20px 0' }}>
        <Card t={t} style={{ padding: 0 }}>
          <div style={{ display: 'flex', padding: '18px 0' }}>
            {stats.map(([l, v, col], i) => (
              <div key={l} style={{ flex: 1, textAlign: 'center', borderLeft: i ? `1px solid ${t.divider}` : 'none' }}>
                <div style={{ fontFamily: F2.display, fontSize: 26, color: col, lineHeight: 0.9 }}>{v}</div>
                <Kick t={t}>{l}</Kick>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderTop: `1px solid ${t.divider}` }}>
            <Kick t={t}>Forme</Kick>
            <div style={{ display: 'flex', gap: 5, flex: 1 }}>
              {p.recentForm.map((r, i) => <div key={i} style={{ width: 22, height: 22, borderRadius: 7, background: r === 'W' ? C2.success : C2.danger, display: 'grid', placeItems: 'center', color: '#fff', fontFamily: F2.ui, fontSize: 10, fontWeight: 900 }}>{r}</div>)}
            </div>
            <span style={{ fontFamily: F2.ui, fontWeight: 800, fontSize: 13, color: C2.warning }}>🔥 {p.streak}</span>
          </div>
        </Card>
      </div>

      {/* évolution */}
      <div style={{ padding: '12px 20px 0' }}>
        <Card t={t}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
            <Kick t={t}>Évolution du niveau</Kick>
            <span style={{ fontFamily: F2.ui, fontWeight: 800, fontSize: 13, color: C2.success }}>+{ed} cette saison</span>
          </div>
          <window.PMSparkline series={p.eloSeries} w={326} h={92} color={t.accent} fill={variant === 'light' ? 'rgba(232,169,6,0.12)' : 'rgba(255,193,26,0.12)'} />
        </Card>
      </div>

      {/* badges */}
      <div style={{ padding: '12px 20px 0' }}>
        <Kick t={t} mb={8}>Badges</Kick>
        <div style={{ display: 'flex', gap: 10 }}>
          {p.badges.map(b => (
            <Card key={b.label} t={t} style={{ flex: 1, textAlign: 'center', padding: '14px 6px' }}>
              <div style={{ fontSize: 24 }}>{b.icon}</div>
              <div style={{ fontFamily: F2.ui, fontWeight: 800, fontSize: 11, color: t.text, marginTop: 4 }}>{b.label}</div>
              <div style={{ fontFamily: F2.ui, fontWeight: 800, fontSize: 10, color: t.accent, marginTop: 1 }}>×{b.count}</div>
            </Card>
          ))}
        </div>
      </div>

      {/* préférences */}
      <div style={{ padding: '20px 20px 0' }}>
        <Kick t={t} mb={8}>Préférences</Kick>
        <Card t={t} style={{ padding: '4px 18px' }}>
          {prefs.map(([l, v], i) => (
            <div key={l} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 46, borderTop: i ? `1px solid ${t.divider}` : 'none' }}>
              <span style={{ fontFamily: F2.ui, fontSize: 13, fontWeight: 500, color: t.sub }}>{l}</span>
              <span style={{ fontFamily: F2.ui, fontSize: 14, fontWeight: 700, color: t.text }}>{v}</span>
            </div>
          ))}
        </Card>
      </div>

      {/* historique des matchs */}
      <div style={{ padding: '20px 20px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <Kick t={t}>Historique des matchs</Kick>
          {isOwn && <span style={{ fontFamily: F2.ui, fontWeight: 700, fontSize: 10.5, letterSpacing: 0.3, color: t.muted }}>Tape pour partager 📸</span>}
        </div>
        <Card t={t} style={{ padding: '4px 16px' }}>
          {(showAllMatches ? (window.PM.matchHistory || []) : (window.PM.matchHistory || []).slice(0, 3)).map((m, i) => {
            const win = m.result === 'win';
            const me = p.name.split(' ')[0];
            return (
              <div key={i} onClick={isOwn && onMatchClick ? () => onMatchClick(m) : undefined} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 0', borderTop: i ? `1px solid ${t.divider}` : 'none', cursor: isOwn ? 'pointer' : 'default' }}>
                <div style={{ width: 30, height: 30, flexShrink: 0, borderRadius: 9, background: win ? `${C2.success}1c` : `${C2.danger}1c`, color: win ? C2.success : C2.danger, display: 'grid', placeItems: 'center', fontFamily: F2.ui, fontWeight: 900, fontSize: 13 }}>{win ? 'V' : 'D'}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: F2.ui, fontSize: 12.5, lineHeight: 1.25, color: t.sub }}>
                    <span style={{ fontWeight: 700, color: t.text }}>{me} & {m.partner}</span>
                    <span style={{ margin: '0 5px', color: t.muted }}>vs</span>
                    {m.opponents.join(' & ')}
                  </div>
                  <div style={{ fontFamily: F2.ui, fontSize: 11, fontWeight: 500, color: t.muted, marginTop: 3 }}>{m.location} · {m.date} · {m.time}</div>
                </div>
                <div style={{ flexShrink: 0, fontFamily: F2.ui, fontWeight: 800, fontSize: 14, letterSpacing: 0.3, color: win ? C2.success : C2.danger }}>{m.score}</div>
                {isOwn && <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={t.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginLeft: 2 }}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l2-3h8l2 3h3a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="3.6" /></svg>}
              </div>
            );
          })}
          {(window.PM.matchHistory || []).length > 3 && (
            <button onClick={() => setShowAllMatches(s => !s)} style={{ width: '100%', padding: '13px 0', border: 'none', borderTop: `1px solid ${t.divider}`, background: 'transparent', cursor: 'pointer', fontFamily: F2.ui, fontWeight: 800, fontSize: 12.5, letterSpacing: 0.3, color: t.accent }}>{showAllMatches ? 'Voir moins' : `Voir tout · ${(window.PM.matchHistory || []).length}`}</button>
          )}
        </Card>
      </div>

      {isOwn ? <div style={{ height: 36 }} /> : (
        <React.Fragment>
          <div style={{ height: 96 }} />
          <div style={{ position: 'sticky', bottom: 0, background: t.card, borderTop: `1px solid ${t.border}`, padding: '12px 20px 30px', boxShadow: variant === 'light' ? '0 -10px 28px rgba(0,0,0,0.07)' : '0 -10px 28px rgba(0,0,0,0.5)' }}>
            <button onClick={onDefier} style={{ width: '100%', height: 52, borderRadius: 16, border: 'none', cursor: 'pointer', background: C2.brand, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, boxShadow: '0 6px 18px rgba(255,193,26,0.4)' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0A0A0A" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
              <span style={{ fontFamily: F2.ui, fontWeight: 800, fontSize: 16, color: '#0A0A0A', letterSpacing: 0.2, whiteSpace: 'nowrap' }}>Défier {p.name.split(' ')[0]}</span>
            </button>
          </div>
        </React.Fragment>
      )}
    </div>
  );
}

/* ── feuille d'édition du profil (slide-up) ───────────────────────── */
function ProfileEditSheet({ open, variant = 'light', player = Pl, onClose, onSave }) {
  const t = THEMES[variant];
  const ALLDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  const [draft, setDraft] = React.useState(player);
  React.useEffect(() => { if (open) setDraft(player); }, [open]);
  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }));
  const toggleDay = (d) => set('days', draft.days.includes(d) ? draft.days.filter(x => x !== d) : [...draft.days, d]);
  const initials = (draft.name.trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 2) || 'JK').toUpperCase();
  const lc = C2.league[draft.league];

  const Label = ({ children }) => <div style={{ fontFamily: F2.ui, fontWeight: 700, fontSize: 12, letterSpacing: 0.5, color: t.sub, marginBottom: 9 }}>{children}</div>;
  const inputStyle = { width: '100%', height: 48, borderRadius: 12, border: `1px solid ${t.border}`, background: t.chip, color: t.text, fontFamily: F2.ui, fontSize: 15, fontWeight: 600, padding: '0 14px', outline: 'none', boxSizing: 'border-box' };
  const Seg = ({ value, options, onChange }) => (
    <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 12, background: t.chip, border: `1px solid ${t.border}` }}>
      {options.map(o => { const on = value === o; return <button key={o} onClick={() => onChange(o)} style={{ flex: 1, padding: '11px 0', borderRadius: 9, border: 'none', cursor: 'pointer', background: on ? C2.brand : 'transparent', color: on ? '#0A0A0A' : t.sub, fontFamily: F2.ui, fontWeight: 800, fontSize: 13 }}>{o}</button>; })}
    </div>
  );

  return (
    <div style={{
      position: 'absolute', inset: 0, background: t.page, zIndex: 50, display: 'flex', flexDirection: 'column', fontFamily: F2.ui,
      transform: open ? 'translateY(0)' : 'translateY(100%)', transition: 'transform .4s cubic-bezier(.32,.72,0,1)',
    }}>
      {/* header */}
      <div style={{ paddingTop: 58, padding: '58px 16px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: t.topbar, borderBottom: `1px solid ${t.border}` }}>
        <button onClick={onClose} style={{ width: 38, height: 38, borderRadius: 12, border: `1px solid ${t.border}`, background: t.chip, cursor: 'pointer', color: t.text, fontSize: 17 }}>✕</button>
        <span style={{ fontFamily: F2.ui, fontWeight: 700, fontSize: 16, color: t.text }}>Éditer le profil</span>
        <button onClick={() => onSave({ ...draft, days: ALLDAYS.filter(d => draft.days.includes(d)) })} style={{ height: 38, padding: '0 16px', borderRadius: 12, border: 'none', cursor: 'pointer', background: C2.brand, color: '#0A0A0A', fontFamily: F2.ui, fontWeight: 800, fontSize: 13.5 }}>Enregistrer</button>
      </div>

      {/* body */}
      <div style={{ flex: 1, overflow: 'auto', padding: '22px 20px 40px' }}>
        {/* avatar */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 26 }}>
          <div style={{ width: 84, height: 84, borderRadius: 26, background: `linear-gradient(150deg, ${lc}, ${C2.brandDeep})`, display: 'grid', placeItems: 'center', position: 'relative' }}>
            <span style={{ fontFamily: F2.display, fontSize: 38, color: '#0A0A0A' }}>{initials}</span>
            <div style={{ position: 'absolute', bottom: -4, right: -4, width: 30, height: 30, borderRadius: 10, background: t.card, border: `1px solid ${t.border}`, display: 'grid', placeItems: 'center' }}>{IcoCamera(t)}</div>
          </div>
          <button style={{ marginTop: 12, background: 'none', border: 'none', cursor: 'pointer', fontFamily: F2.ui, fontWeight: 800, fontSize: 13, color: t.accent }}>Modifier la photo</button>
        </div>

        <div style={{ marginBottom: 20 }}>
          <Label>Nom</Label>
          <input value={draft.name} onChange={e => set('name', e.target.value)} style={inputStyle} />
        </div>

        <div style={{ marginBottom: 20 }}>
          <Label>Sexe</Label>
          <Seg value={draft.gender} options={['Homme', 'Femme', 'Autre']} onChange={v => set('gender', v)} />
        </div>

        <div style={{ marginBottom: 20 }}>
          <Label>Côté de jeu</Label>
          <Seg value={draft.courtSide} options={['Gauche', 'Droite']} onChange={v => set('courtSide', v)} />
        </div>

        <div style={{ marginBottom: 20 }}>
          <Label>Club</Label>
          <input value={draft.club} onChange={e => set('club', e.target.value)} style={inputStyle} />
        </div>

        <div style={{ marginBottom: 8 }}>
          <Label>Disponibilités</Label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {ALLDAYS.map(d => { const on = draft.days.includes(d); return (
              <button key={d} onClick={() => toggleDay(d)} style={{ flex: 1, minWidth: 40, padding: '11px 0', borderRadius: 11, cursor: 'pointer', background: on ? C2.brand : t.chip, color: on ? '#0A0A0A' : t.sub, border: `1px solid ${on ? C2.brand : t.border}`, fontFamily: F2.ui, fontWeight: 800, fontSize: 12.5 }}>{d}</button>
            ); })}
          </div>
        </div>
      </div>
    </div>
  );
}

const CLEAN_VARIANTS = [
  { id: 'light', label: 'A · Clair', sub: 'Sobre · app', variant: 'light' },
  { id: 'dark', label: 'B · Sombre', sub: 'Sobre · nuit', variant: 'dark' },
];
Object.assign(window, { ProfileClean, ProfileEditSheet, CLEAN_VARIANTS });
