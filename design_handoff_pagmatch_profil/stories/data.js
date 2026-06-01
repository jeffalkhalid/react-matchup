/* PagMatch — données d'exemple + helpers, partagés par les stories et le flux.
   Valeurs alignées sur lib/colors.js et lib/theme.ts du repo react-matchup. */

window.PM = (function () {
  // ── Charte couleurs (lib/colors.js) ──────────────────────────────
  const Colors = {
    bg: '#F5F5F4', bgCard: '#FFFFFF', bgCardAlt: '#FAFAF9', bgCream: '#FAF5E8',
    bgDark: '#0A0A0A', bgDarkAlt: '#1A1A1C',
    border: '#E7E5E4',
    brand: '#FFC11A', brandBright: '#FFD23F', brandDeep: '#E8A906',
    primary: '#0A0A0A',
    danger: '#EF4444', warning: '#F59E0B', info: '#3B82F6', success: '#10B981',
    textPrimary: '#0A0A0A', textSecondary: '#52525B', textMuted: '#A1A1AA',
    textOnDark: '#FFFFFF',
    heroBg: '#0A0A0A',
    league: {
      diamond: '#67E8F9', gold: '#FBBF24', silver: '#A1A1AA',
      bronze: '#E8A906', discovery: '#71717A',
    },
    leagueGrad: {
      diamond: ['#0EA5E9', '#67E8F9'], gold: ['#D97706', '#FBBF24'],
      silver: ['#71717A', '#D4D4D8'], bronze: ['#A16207', '#E8A906'],
      discovery: ['#52525B', '#A1A1AA'],
    },
  };

  const leagueLabel = {
    diamond: 'Diamant', gold: 'Or', silver: 'Argent', bronze: 'Bronze', discovery: 'Découverte',
  };

  // ── Profil d'exemple (un "profil complet") ───────────────────────
  const player = {
    name: 'Jeff Khalid',
    initials: 'JK',
    league: 'gold',
    level: 5.85,          // niveau padel (eloToLevel)
    nextLevel: 6.0,
    levelPct: 0.85,       // progression vers le niveau suivant
    rank: 12,
    frmtRank: '147',
    frmtVerified: true,
    fiability: 88,        // %
    fiabilityLabel: 'EXCELLENT',
    wins: 47,
    losses: 19,
    get total() { return this.wins + this.losses; },
    get winRate() { return Math.round((this.wins / this.total) * 100); },
    streak: 6,
    recentForm: ['W', 'W', 'L', 'W', 'W'],
    bestPartner: 'Sofia',
    nemesis: 'Karim',
    club: 'Racing Club Padel',
    courtSide: 'Gauche',
    gender: 'Homme',
    days: ['Mar', 'Jeu', 'Sam'],
    // ADN du joueur (radar) — clés alignées sur DNA_AXES
    dna: { Puissance: 8, Vitesse: 3, Ambiance: 6, Défense: 5, Tactique: 4 },
    // Badges karma + achievements
    badges: [
      { icon: '👑', label: 'MVP', count: 3 },
      { icon: '💥', label: 'La Bombe', count: 5 },
      { icon: '🎯', label: 'Le Smash', count: 2 },
    ],
    achievements: [
      { emoji: '🎖️', name: 'Vétéran' },
      { emoji: '🔥', name: 'On Fire' },
      { emoji: '🥯', name: 'Boulanger' },
    ],
    // Courbe d'évolution du niveau (sparkline)
    eloSeries: [4.10, 4.35, 4.25, 4.70, 4.90, 4.80, 5.15, 5.40, 5.30, 5.62, 5.85],
  };

  // Axes ADN (ordre + angles), aligné sur player/[id].tsx
  const DNA_AXES = [
    { key: 'Puissance', emoji: '💥', angle: -90 },
    { key: 'Vitesse',   emoji: '🏃', angle: -18 },
    { key: 'Ambiance',  emoji: '😄', angle:  54 },
    { key: 'Défense',   emoji: '🧱', angle: 126 },
    { key: 'Tactique',  emoji: '🧠', angle: 198 },
  ];

  // ── Match d'exemple (résultat à partager) ────────────────────────
  const match = {
    result: 'win',                 // victoire de l'équipe du joueur
    sets: [[6, 3], [7, 5]],        // scores par set (mon score d'abord)
    score: '6-3 7-5',
    winners: ['Jeff', 'Sofia'],
    losers: ['Karim', 'Lina'],
    location: 'Racing Club Padel',
    date: '12 mars · 19:30',
    type: 'Compétitif',
    eloDelta: '+0.18',
  };

  // ── Historique des matchs (récents) ──────────────────────────────
  const matchHistory = [
    { result: 'win',  partner: 'Sofia', opponents: ['Karim', 'Lina'],  score: '6-3 7-5', location: 'Racing Club Padel', date: '12 mars', time: '19:30' },
    { result: 'win',  partner: 'Théo',  opponents: ['Nadia', 'Hugo'],  score: '6-4 6-2', location: 'Padel Factory',     date: '8 mars',  time: '21:00' },
    { result: 'loss', partner: 'Sofia', opponents: ['Marco', 'Inès'],  score: '4-6 6-7', location: 'Racing Club Padel', date: '3 mars',  time: '18:15' },
    { result: 'win',  partner: 'Lucas', opponents: ['Karim', 'Sami'],  score: '7-6 6-3', location: 'Set Padel Club',    date: '27 fév',  time: '20:30' },
    { result: 'win',  partner: 'Sofia', opponents: ['Hugo', 'Lina'],   score: '6-2 6-4', location: 'Racing Club Padel', date: '21 fév',  time: '19:00' },
    { result: 'loss', partner: 'Théo',  opponents: ['Marco', 'Sami'],  score: '6-7 5-7', location: 'Padel Factory',     date: '16 fév',  time: '20:00' },
    { result: 'win',  partner: 'Sofia', opponents: ['Nadia', 'Inès'],  score: '6-1 6-3', location: 'Racing Club Padel', date: '10 fév',  time: '19:30' },
    { result: 'win',  partner: 'Lucas', opponents: ['Hugo', 'Karim'],  score: '7-5 6-4', location: 'Set Padel Club',    date: '4 fév',   time: '21:15' },
  ];

  // ── Invitation (QR + lien "Rejoins-moi") ─────────────────────────
  const invite = {
    cta: 'Rejoins-moi sur',
    link: 'pagmatch.com/jeff',
    handle: '@jeff.padel',
  };

  return { Colors, leagueLabel, player, DNA_AXES, match, matchHistory, invite };
})();
