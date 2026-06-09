/* mockups.jsx — recréations fidèles des écrans PAG MATCH
   (Accueil, Les Défis, Le classement). Basé sur le code source RN. */

/* ---- Status bar (iOS-like) ---- */
function StatusBar({ dark }) {
  const c = dark ? '#fff' : '#0A0A0A';
  return (
    <div className="sb" style={{ color: c }}>
      <span>9:41</span>
      <div className="dots">
        <svg width="15" height="11" viewBox="0 0 18 12" fill={c}><rect x="0" y="7" width="3" height="5" rx="1"/><rect x="4.5" y="4.5" width="3" height="7.5" rx="1"/><rect x="9" y="2" width="3" height="10" rx="1"/><rect x="13.5" y="0" width="3" height="12" rx="1"/></svg>
        <svg width="15" height="11" viewBox="0 0 16 12" fill={c}><path d="M8 2.5c2 0 3.8.8 5.1 2.1l1.1-1.2A9 9 0 0 0 8 .8 9 9 0 0 0 1.8 3.4l1.1 1.2A7 7 0 0 1 8 2.5zM8 6c1 0 2 .4 2.7 1.1l1.1-1.2A6 6 0 0 0 8 4.2a6 6 0 0 0-3.8 1.7l1.1 1.2A4 4 0 0 1 8 6zm0 3.4 1.8-1.9a3 3 0 0 0-3.6 0L8 9.4z"/></svg>
        <i style={{ border: `1px solid ${c}`, opacity: .9, borderRadius: 3, position: 'relative' }}><b style={{ position: 'absolute', inset: '1.5px', background: c, borderRadius: 1, display: 'block' }}></b></i>
      </div>
    </div>
  );
}

/* ============== HOME ============== */
function HomeScreen() {
  const radar = <svg viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19.07 4.93A10 10 0 0 0 6.99 3.34"/><path d="M2.29 9.62A10 10 0 1 0 21.31 8.35"/><path d="M16.24 7.76A6 6 0 1 0 17.34 14"/><circle cx="12" cy="12" r="2" fill="#4f46e5"/><path d="M21.17 8H12V2.83"/><path d="m22 22-5.5-5.5"/></svg>;
  const pen = <svg viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4z"/></svg>;
  const trophy = <svg viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>;
  const cal = <svg viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5M16 2v4M8 2v4M3 10h5M17.5 17.5 16 16.25V14"/><circle cx="16" cy="16" r="6"/></svg>;
  const bell = <svg viewBox="0 0 24 24" fill="#fff" stroke="#fff" strokeWidth="1.2" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 6.2 2.6 8.4 2.9 8.7a.6.6 0 0 1-.4 1H3.5a.6.6 0 0 1-.4-1C3.4 16.4 6 14.2 6 8z"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" fill="none"/></svg>;
  const chev = <svg viewBox="0 0 24 24" fill="none" stroke="#0A0A0A" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6"/></svg>;

  return (
    <div className="appscreen home">
      <StatusBar />
      <div className="home-pad">
        <div className="home-logo">
          <img className="r" src="assets/auth/splash-racket.png" alt="" />
          <img className="w" src="assets/auth/splash-wordmark.png" alt="PAG MATCH" />
        </div>

        <div className="pb">
          <div className="orb1"></div><div className="orb2"></div>
          <div className="bell">{bell}<span className="bdot">3</span></div>
          <div className="pb-id">
            <div className="pb-av" style={{ background: '#FFC11A', color: '#0A0A0A' }}>L</div>
            <div className="pb-info">
              <div className="pb-league"><i style={{ background: '#FBBF24' }}></i><span style={{ color: '#FBBF24' }}>Ligue Or</span></div>
              <div className="pb-name">Lucas Martin</div>
              <div className="pb-lvl">Niveau 4.20</div>
            </div>
          </div>
          <div className="pb-stats">
            <div className="pb-stat"><div className="v">48</div><div className="l">Matchs</div></div>
            <div className="pb-stat"><div className="v">31</div><div className="l">Victoires</div></div>
            <div className="pb-stat"><div className="v" style={{ color: '#FFC11A' }}>65%</div><div className="l">Win</div></div>
            <div className="pb-stat"><div className="v" style={{ color: '#fb923c' }}>7</div><div className="l">Badges</div></div>
          </div>
        </div>

        <div className="home-grid">
          <div className="ac"><div className="icb" style={{ background: '#e0e7ff' }}>{radar}</div><div className="t">Matchmaking</div></div>
          <div className="ac"><div className="icb" style={{ background: '#d1fae5' }}>{pen}</div><div className="t">Saisir un score</div></div>
          <div className="ac"><div className="icb" style={{ background: '#fef3c7' }}>{trophy}</div><div className="t">Classement</div></div>
          <div className="ac"><div className="icb" style={{ background: '#ede9fe' }}>{cal}<span className="vbadge">2</span></div><div className="t">À Venir</div><div className="s">{"Sam. · 18:30\nPadel Marseille"}</div></div>
        </div>

        <div className="cc">
          <div className="ccorb"></div>
          <div className="cc-faces">
            <i style={{ background: '#FFC11A', color: '#0A0A0A' }}>T</i>
            <i style={{ background: '#27272A', color: '#fff' }}>S</i>
            <i style={{ background: '#FFC11A', color: '#0A0A0A' }}>N</i>
          </div>
          <div className="cc-txt"><div className="k">Communauté</div><div className="h">Tes amis sur PagMatch</div></div>
          <div className="cc-chev">{chev}</div>
        </div>
      </div>
    </div>
  );
}

/* ============== COMPAT RING ============== */
function CompatRing({ score, color }) {
  const size = 50, sw = 5, r = (size - sw * 2) / 2, c = 2 * Math.PI * r, off = c * (1 - score / 100), cx = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="#E7E5E4" strokeWidth={sw} />
      <circle cx={cx} cy={cx} r={r} fill="none" stroke={color} strokeWidth={sw} strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" transform={`rotate(-90 ${cx} ${cx})`} />
      <text x={cx} y={cx + 4} textAnchor="middle" fontSize="11" fontWeight="900" fill={color} fontFamily="Inter, sans-serif">{score}</text>
    </svg>
  );
}

/* ============== MATCHMAKING (Les Défis) ============== */
function MatchScreen() {
  // tier: >=80 vert #047857 ; >=60 brandDeep #E8A906 ; >=40 #B45309
  const sugg = [
    { n: 'Théo Dubois', av: 'T', avc: '#0A0A0A', txt: '#fff', lvl: '4.2', score: 88, tier: '#047857', tlabel: 'Match parfait', league: 'Or', lc: '#FBBF24', win: '64% W', comp: true },
    { n: 'Sarah Renaud', av: 'S', avc: '#FFC11A', txt: '#0A0A0A', lvl: '4.0', score: 72, tier: '#E8A906', tlabel: 'Très compatible', league: 'Or', lc: '#FBBF24', win: '58% W' },
    { n: 'Karim Bensaïd', av: 'K', avc: '#0A0A0A', txt: '#fff', lvl: '4.3', score: 64, tier: '#E8A906', tlabel: 'Très compatible', league: 'Or', lc: '#FBBF24', win: '71% W' },
  ];
  return (
    <div className="appscreen mm">
      <div className="mm-head">
        <StatusBar dark />
        <div className="mm-lock">
          <img className="r" src="assets/auth/splash-racket.png" alt="" />
          <img className="w" src="assets/auth/splash-wordmark.png" alt="PAG MATCH" />
        </div>
        <div className="mm-title">Les <span className="y">Défis</span></div>
        <div className="mm-sub">Défis & joueurs compatibles</div>
        <div className="mm-tabs">
          <div className="mm-tab active">Suggestions</div>
          <div className="mm-tab">Défis reçus<span className="b">2</span></div>
        </div>
      </div>
      <div className="mm-body">
        <div className="mm-sort">
          <div className="mm-seg active">⚡ Compatibilité</div>
          <div className="mm-seg">📊 Niveau</div>
        </div>
        {sugg.map((p, i) => (
          <div className="sc" key={i} style={i === 0 ? { borderColor: 'rgba(16,185,129,.45)', boxShadow: '0 6px 16px rgba(16,185,129,.18)' } : null}>
            <div className="sc-bar" style={{ background: p.tier }}></div>
            <div className="sc-in">
              <div className="ring-wrap">
                <CompatRing score={p.score} color={p.tier} />
                <div className="ring-lbl" style={{ color: p.tier }}>{p.tlabel}</div>
              </div>
              <div className="sc-mid">
                <div className="sc-pl">
                  <div className="sc-av" style={{ background: p.avc, color: p.txt }}>{p.av}</div>
                  <div style={{ minWidth: 0 }}>
                    <div className="sc-name">{p.n}</div>
                    <div className="sc-lvl">Niv. {p.lvl}</div>
                  </div>
                </div>
                <div className="sc-pills">
                  <span className="pill-sm" style={{ color: p.lc, background: p.lc + '22', borderColor: p.lc + '70' }}>{p.league}</span>
                  <span className="pill-sm" style={{ color: '#52525B', background: '#F5F5F4', borderColor: '#E7E5E4' }}>{p.win}</span>
                  {p.comp && <span className="pill-sm" style={{ color: '#047857', background: 'rgba(16,185,129,.12)', borderColor: 'rgba(16,185,129,.45)' }}>↔ Comp.</span>}
                </div>
              </div>
              <div className="btn-defi">⚡ Défier</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============== RANKING (Le classement) ============== */
function RankScreen() {
  const search = <svg viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.5" stroke="#a1a1aa" strokeWidth="1.5"/><line x1="9.5" y1="9.5" x2="12" y2="12" stroke="#a1a1aa" strokeWidth="1.5" strokeLinecap="round"/></svg>;
  // podium DOM order: [#2, #1, #3]
  const podium = [
    { rank: 2, n: 'Julia', av: 'JM', avc: '#FFC11A', txt: '#0A0A0A', lvl: '4.90', lc: '#FBBF24', medal: '#94a3b8', bg: '#f1f5f9', bd: '#e2e8f0', emoji: '🥈', h: 62, sz: 48 },
    { rank: 1, n: 'Antoine', av: 'AV', avc: '#FFC11A', txt: '#0A0A0A', lvl: '5.80', lc: '#67E8F9', medal: '#f59e0b', bg: '#fef9c3', bd: '#fef08a', emoji: '🏆', h: 80, sz: 56 },
    { rank: 3, n: 'Naël', av: 'NK', avc: '#FFC11A', txt: '#0A0A0A', lvl: '4.60', lc: '#FBBF24', medal: '#b45309', bg: '#ffedd5', bd: '#fed7aa', emoji: '🥉', h: 48, sz: 44 },
  ];
  const rows = [
    { r: 4, n: 'Sofia Lemoine', av: 'SL', avc: '#0A0A0A', txt: '#fff', league: 'Or', lc: '#FBBF24', m: 42, lvl: '4.40' },
    { r: 5, n: 'Marco Pereira', av: 'MP', avc: '#FFC11A', txt: '#0A0A0A', league: 'Or', lc: '#FBBF24', m: 55, lvl: '4.10' },
  ];
  const chips = [
    { l: 'Toutes ligues', active: true, c: '#0A0A0A' },
    { l: 'Diamant', c: '#67E8F9' }, { l: 'Or', c: '#FBBF24' }, { l: 'Argent', c: '#A1A1AA' },
  ];
  return (
    <div className="appscreen rk">
      <div className="rk-head">
        <StatusBar dark />
        <div className="rk-titlerow">
          <div>
            <div className="rk-title">Le <span className="y">classement</span></div>
            <div className="sub">128 joueurs classés</div>
          </div>
          <div className="rk-myrank"><span className="l">Votre rang</span><span className="v">#7</span></div>
        </div>
        <div className="rk-tabs"><div className="rk-tab active">Global</div><div className="rk-tab">Amis</div></div>
      </div>

      <div className="rk-search-wrap">
        <div className="rk-search">{search}<span className="ph">Chercher un joueur…</span></div>
      </div>
      <div className="rk-filters">
        {chips.map((c, i) => (
          <span className={`chip ${c.active ? 'active' : ''}`} key={i} style={c.active ? { background: c.c } : { color: '#0A0A0A' }}>{c.l}</span>
        ))}
      </div>

      <div className="podium">
        {podium.map((p, i) => (
          <div className="pod" key={i}>
            <div className="pod-av" style={{ width: p.sz, height: p.sz, fontSize: p.sz * 0.32, background: p.avc, color: p.txt, borderColor: p.bd, borderWidth: p.rank === 1 ? 3 : 2.5 }}>
              {p.av}
              <span className="pod-rank" style={{ background: p.medal }}>{p.rank}</span>
            </div>
            <div className="pod-name" style={{ fontSize: p.rank === 1 ? 13 : 11.5 }}>{p.n}</div>
            <div className="pod-lvl" style={{ color: p.lc }}>{p.lvl}</div>
            <div className="pod-block" style={{ height: p.h, background: p.bg, borderColor: p.medal + '55', fontSize: p.rank === 1 ? 18 : 15 }}>{p.emoji}</div>
          </div>
        ))}
      </div>

      <div className="rk-listhead"><span className="l">Suite du classement</span><span className="r">ELO ↓</span></div>

      {rows.map((p, i) => (
        <div className="prow" key={i}>
          <div className="prow-rank">#{p.r}</div>
          <div className="prow-av" style={{ background: p.avc, color: p.txt }}>{p.av}</div>
          <div className="prow-mid">
            <div className="prow-name">{p.n}</div>
            <div className="prow-meta">
              <span className="lpill" style={{ color: p.lc, background: p.lc + '20' }}>{p.league}</span>
              <span className="prow-matchs">{p.m} matchs</span>
            </div>
          </div>
          <div className="prow-lvl">{p.lvl}</div>
        </div>
      ))}
    </div>
  );
}

Object.assign(window, { HomeScreen, MatchScreen, RankScreen, StatusBar, CompatRing });
