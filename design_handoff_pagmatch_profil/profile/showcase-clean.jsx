/* PagMatch — vitrine épurée : 2 profils sobres côte à côte (clair + sombre).
   Sélecteur « Mon profil / Autre joueur » : sur un autre joueur, le crayon
   disparaît et un bouton « Défier » apparaît en bas. */

function FlowShellClean({ variant, isOwn }) {
  const LISTS = { profil: window.STORY_STYLES, match: window.MATCH_STYLES, photo: window.PHOTO_STYLES };
  const [composerOpen, setComposerOpen] = React.useState(false);
  const [shareOpen, setShareOpen] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(false);
  const [player, setPlayer] = React.useState(window.PM.player);
  const [selMatch, setSelMatch] = React.useState(null);
  const [mode, setMode] = React.useState('profil');
  const [idx, setIdx] = React.useState(0);
  const [picked, setPicked] = React.useState(false);
  const [challenge, setChallenge] = React.useState(false);

  const list = LISTS[mode];
  const cur = list[Math.min(idx, list.length - 1)];
  const changeMode = (m) => { setMode(m); setIdx(0); };
  const handlePick = () => { setPicked(true); setTimeout(() => { setPicked(false); setShareOpen(false); }, 1600); };
  const handleDefier = () => { setChallenge(true); setTimeout(() => setChallenge(false), 1900); };
  const handleSave = (next) => { setPlayer(next); setEditOpen(false); };
  const handleMatchClick = (item) => {
    const me = player.name.split(' ')[0];
    const win = item.result === 'win';
    const mine = [me, item.partner];
    setSelMatch({
      result: item.result,
      sets: item.score.split(' ').map(s => s.split('-').map(Number)),
      score: item.score,
      winners: win ? mine : item.opponents,
      losers: win ? item.opponents : mine,
      location: item.location,
      date: `${item.date} · ${item.time}`,
      type: 'Compétitif',
      eloDelta: item.eloDelta || (win ? '+0.15' : '-0.12'),
    });
    setMode('match'); setIdx(0); setComposerOpen(true);
  };

  return (
    <window.IOSDevice>
      <div style={{ position: 'relative', height: '100%' }}>
        <window.ProfileClean variant={variant} isOwn={isOwn} player={player} onStory={() => { setSelMatch(null); setMode('profil'); setIdx(0); setComposerOpen(true); }} onDefier={handleDefier} onEdit={() => setEditOpen(true)} onMatchClick={handleMatchClick} />
        <window.ProfileEditSheet open={editOpen} variant={variant} player={player} onClose={() => setEditOpen(false)} onSave={handleSave} />
        <window.PMComposer open={composerOpen} mode={mode} setMode={changeMode} list={list} idx={idx} setIdx={setIdx} matchData={selMatch || window.PM.match} onClose={() => setComposerOpen(false)} onShare={() => setShareOpen(true)} />
        <window.PMShareSheet open={shareOpen} Cur={cur.Comp} curId={cur.id} matchData={selMatch || window.PM.match} label={`Ma story · ${cur.name}`} picked={picked} onClose={() => setShareOpen(false)} onPick={handlePick} />
        {/* toast défi envoyé */}
        <div style={{
          position: 'absolute', left: '50%', top: '46%', transform: `translate(-50%,-50%) scale(${challenge ? 1 : 0.85})`,
          opacity: challenge ? 1 : 0, transition: 'all .28s', pointerEvents: 'none', zIndex: 70,
          background: 'rgba(10,10,10,0.92)', backdropFilter: 'blur(10px)', borderRadius: 20, padding: '22px 28px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 36 }}>⚡</div>
          <div style={{ color: '#fff', fontFamily: 'Inter, system-ui', fontWeight: 800, fontSize: 15, marginTop: 6 }}>Défi envoyé !</div>
        </div>
      </div>
    </window.IOSDevice>
  );
}

function ProfileCleanShowcase() {
  const [own, setOwn] = React.useState(false);
  const seg = (label, val) => {
    const on = own === val;
    return (
      <button key={label} onClick={() => setOwn(val)} style={{
        padding: '9px 20px', borderRadius: 10, border: 'none', cursor: 'pointer',
        background: on ? '#FFC11A' : 'transparent', color: on ? '#0A0A0A' : 'rgba(255,255,255,0.6)',
        fontFamily: 'Inter, system-ui', fontWeight: 800, fontSize: 13.5, letterSpacing: 0.2, whiteSpace: 'nowrap',
      }}>{label}</button>
    );
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 26 }}>
      <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 13, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}>
        {seg('Mon profil', true)}
        {seg('Autre joueur', false)}
      </div>
      <FlowShellClean variant="light" isOwn={own} />
    </div>
  );
}

window.ProfileCleanShowcase = ProfileCleanShowcase;
