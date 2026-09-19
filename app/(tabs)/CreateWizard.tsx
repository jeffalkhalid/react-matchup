import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useFocusEffect } from 'expo-router';
import {
  View, Text, ScrollView, TouchableOpacity, Modal, TextInput,
  Alert, ActivityIndicator, StyleSheet, Dimensions, KeyboardAvoidingView, Platform,
  Share, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { Colors, eloToLevel, formatPadelLevel, padelLevelToElo, Fonts } from '../../lib/theme';
import { buildGameShareMessage } from '../../lib/community';
import { isInviteActive } from '../../lib/games';
import { DEFI_BAND_MIN_LEVEL, defiMinimumMaxLevel, isDefiBandWideEnough, stakeTone } from '../../lib/defis';
import { consumePickedVenue } from '../../lib/venuePicker';
import { loadClubFavorites } from '../../lib/clubFavorites';
import { Avatar as ClubAvatar } from '../../components/community/Avatar';
import { ClubsMapModal } from '../../components/ClubsMapModal';
import { ManageClubsModal } from '../../components/ManageClubsModal';
import { Pill } from '../../components/Pill';
import { CreatorCrownBadge } from '../../components/CreatorCrownBadge';
import { PlayerAvatar } from '../../components/PlayerAvatar';
import { Icon, type IconName } from '../../components/community/icons';

// ─── Types ────────────────────────────────────────────────────
type GameType = 'Compétitif' | 'Amical' | 'Défi';
type Genre    = 'mixed' | 'men' | 'women';
type BusyGame = { ts: number; location: string | null; role: string };

export interface WizardResult {
  gameType: GameType; genre: Genre;
  matchDate: string; matchTime: string;
  location: string; hasReservation: boolean;
  minLevel: number; maxLevel: number;
  stakeMultiplier: number;
  creatorSide: string;
  confirmedPlayers: Array<{ id: string; name: string; elo_score: number; team_side?: string }>;
  isTargeted: boolean;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Appelé depuis l'écran "Partie publiée" — permet de basculer le Lobby sur l'onglet À venir. Fallback: onClose. */
  onPublishedDone?: () => void;
  onPublish: (data: WizardResult) => Promise<string>;
  player: { id: string; name: string; elo_score: number; gender?: string } | null;
  initialGameType?: GameType;
  initialInvite?: { id: string; name: string; elo_score: number; court_side?: string };
  initialInvites?: Partial<Record<'A1' | 'B0' | 'B1', { id: string; name: string; elo_score: number; avatar_path?: string | null }>>;
  targeted?: boolean;
}

// ─── Constants ────────────────────────────────────────────────
const SLOT_TO_SIDE: Record<string, string> = { A0: 'A_GAU', A1: 'A_DRO', B0: 'B_GAU', B1: 'B_DRO' };

// Étapes selon le type : le Défi insère « Mon binôme » avant « Mise & plafond ».
function screenLabels(gameType: GameType): string[] {
  if (gameType === 'Défi') return ['Quand & Où', 'La partie', 'Mon binôme', 'Mise & plafond'];
  return ['Quand & Où', 'La partie', "L'équipe"];
}

const TIMES = [
  '08:00','08:30','09:00','09:30','10:00','10:30','11:00','11:30',
  '12:00','12:30','13:00','13:30','14:00','14:30','15:00','15:30',
  '16:00','16:30','17:00','17:30','18:00','18:30','19:00','19:30',
  '20:00','20:30','21:00','21:30','22:00','22:30','23:00','23:30',
];
// Fenêtre d'anti-chevauchement (identique au pre-check du publish dans lobby.tsx).
// Un match occupe sa durée de jeu + une marge déplacement/repos ; deux matchs
// entrent en conflit quand leurs intervalles [début, début+durée+marge) se
// chevauchent, soit |début1 − début2| < (durée + marge). Comparaison STRICTE :
// un écart pile de 2h (ex. 19h vs 21h) ne se chevauche pas → pas de conflit.
const MATCH_DURATION_MS = 90 * 60 * 1000;   // 1h30 de jeu
const BUFFER_MS         = 30 * 60 * 1000;   // marge déplacement/repos entre 2 courts
const OVERLAP_MS = MATCH_DURATION_MS + BUFFER_MS;

// Paliers de mise d'un défi (maquette 2026-09-18). La base accepte 1.5 → 4.0
// (defi_stake_4.sql) ; les anciens défis à ×1.5 / ×2.5 restent valides.
const DEFI_STAKES = [
  { label: 'Soft', value: 2 },
  { label: 'Standard', value: 3 },
  { label: 'High Stakes', value: 4 },
] as const;
const DEFAULT_DEFI_STAKE = 3;  // 2h — séparation min entre 2 débuts
const FR_DAYS         = ['Dim.','Lun.','Mar.','Mer.','Jeu.','Ven.','Sam.'];
const FR_MONTHS       = ['jan.','fév.','mar.','avr.','mai','juin','juil.','août','sep.','oct.','nov.','déc.'];
const FR_MONTHS_LONG  = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
const FR_DAYS_SHORT   = ['Lu','Ma','Me','Je','Ve','Sa','Di'];

// ─── Helpers ──────────────────────────────────────────────────
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// True when the chosen day (YYYY-MM-DD) + time (HH:MM) is already in the past.
// Used to forbid organising a match earlier than now when the day is today.
function isPastSlot(day: string, time: string): boolean {
  if (!day || !time) return false;
  const dt = new Date(`${day}T${time}`);
  if (isNaN(dt.getTime())) return false;
  return dt.getTime() < Date.now();
}

function buildDays(n: number): Array<{ label: string; val: string }> {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(today); d.setDate(d.getDate() + i);
    const val   = localDateStr(d);
    const label = i === 0 ? "Aujourd'hui" : i === 1 ? 'Demain'
      : `${FR_DAYS[d.getDay()]} ${d.getDate()} ${FR_MONTHS[d.getMonth()]}`;
    return { label, val };
  });
}

// approximate padel level (float) → ELO

// ─── Theme ────────────────────────────────────────────────────
function getTheme(type: GameType) {
  if (type === 'Défi') return {
    accent: Colors.brandDeep, headerBg: Colors.heroBg, btnBg: Colors.brand,
    eloBg: 'rgba(255,193,26,0.14)', eloColor: Colors.brandDeep, eloBorder: 'rgba(255,193,26,0.55)',
    teamABg: 'rgba(255,193,26,0.10)', teamABorder: 'rgba(255,193,26,0.45)', teamBBg: 'rgba(255,193,26,0.06)', teamBBorder: 'rgba(255,193,26,0.35)',
    libreBg: 'rgba(255,193,26,0.10)', libreBorder: 'rgba(255,193,26,0.45)', libreColor: Colors.brandDeep,
    selectBg: 'rgba(255,193,26,0.14)', selectColor: Colors.brandDeep,
  };
  if (type === 'Amical') return {
    accent: '#047857', headerBg: Colors.heroBg, btnBg: '#10b981',
    eloBg: 'rgba(16,185,129,0.10)', eloColor: '#047857', eloBorder: 'rgba(16,185,129,0.45)',
    teamABg: 'rgba(16,185,129,0.08)', teamABorder: 'rgba(16,185,129,0.40)', teamBBg: 'rgba(16,185,129,0.05)', teamBBorder: 'rgba(16,185,129,0.30)',
    libreBg: 'rgba(16,185,129,0.10)', libreBorder: 'rgba(16,185,129,0.45)', libreColor: '#047857',
    selectBg: 'rgba(16,185,129,0.10)', selectColor: '#047857',
  };
  return {
    accent: Colors.textPrimary, headerBg: Colors.heroBg, btnBg: Colors.primary,
    eloBg: Colors.bgCardAlt, eloColor: Colors.textPrimary, eloBorder: Colors.border,
    teamABg: Colors.bgCardAlt, teamABorder: Colors.border, teamBBg: Colors.bg, teamBBorder: Colors.border,
    libreBg: Colors.bgCardAlt, libreBorder: Colors.border, libreColor: Colors.textSecondary,
    selectBg: 'rgba(255,193,26,0.14)', selectColor: Colors.brandDeep,
  };
}

// ─── Bande de niveau par défaut ───────────────────────────────
// SOURCE UNIQUE : utilisée à la fois à l'ouverture (effet de reset) et lors
// d'une bascule manuelle de type, pour que les deux chemins soient iso et que
// l'invariant min <= max soit toujours respecté.
//  • Compétitif / Amical : bande [niveau-0.5, niveau+0.5]
//  • Défi                 : min verrouillé à niveau+0.5, bande [niveau+0.5, niveau+1.5]
function defaultLevelBand(gameType: GameType, lv: number): { min: number; max: number } {
  const mn = Math.max(1.0, +(lv - 0.5).toFixed(2));
  const mx = Math.min(8.0, +(lv + 0.5).toFixed(2));
  if (gameType === 'Défi') return widenBand(mx, Math.min(8.0, +(lv + 1.5).toFixed(2)));
  return widenBand(mn, mx);
}

// Une fourchette doit rester REJOIGNABLE : au moins DEFI_BAND_MIN_LEVEL d'écart
// (cf. lib/defis). Sinon il faudrait tomber sur la moyenne au centième près, et
// le défi reste ouvert sans que personne ne puisse le relever.
// Le plafond ne peut pas dépasser 8 : quand le minimum touche le haut, c'est lui
// qui redescend.
function widenBand(min: number, max: number): { min: number; max: number } {
  const hi = Math.min(8.0, Math.max(max, defiMinimumMaxLevel(min)));
  const lo = Math.max(1.0, Math.min(min, +(hi - DEFI_BAND_MIN_LEVEL).toFixed(2)));
  return { min: +lo.toFixed(2), max: +hi.toFixed(2) };
}

// ─── Avatar ───────────────────────────────────────────────────
// Charte jaune/noir : on alterne ink ↔ brand selon le nom,
// pour garder de la variété entre joueurs sans sortir de la charte.
const AV_PALETTE = [
  { bg: Colors.primary, fg: Colors.textOnDark },   // noir, texte blanc
  { bg: Colors.brand,   fg: Colors.textOnBrand },  // jaune, texte noir
];
function hashTone(name: string) {
  const h = (name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return AV_PALETTE[h % AV_PALETTE.length];
}
/** Un joueur placé dans une équipe. `avatar_path` absent (undefined) = photo pas
 *  encore connue : l'assistant la complète (joueurs pré-remplis par « Rejouer »
 *  ou un défi ciblé, qui arrivent sans elle). `null` = pas de photo. */
type InvitedPlayer = { id: string; name: string; elo_score: number; avatar_path?: string | null };

function Avatar({ name, size = 32, path }: { name: string; size?: number; path?: string | null }) {
  const tone = hashTone(name);
  return (
    <PlayerAvatar
      name={name} path={path} size={size}
      backgroundColor={tone.bg} textColor={tone.fg}
      fontSize={Math.round(size * 0.4)}
    />
  );
}

// ─── MiniCalendar ─────────────────────────────────────────────
function MiniCalendar({ selectedVal, onSelect, t, allDays, daysWithGames }: {
  selectedVal: string;
  onSelect: (val: string) => void;
  t: ReturnType<typeof getTheme>;
  allDays: Array<{ label: string; val: string }>;
  daysWithGames: Set<string>;
}) {
  const todayStr = localDateStr(new Date());
  const [offset, setOffset] = useState(0);

  const base = new Date(); base.setDate(1); base.setMonth(base.getMonth() + offset);
  const year = base.getFullYear(), month = base.getMonth();
  const firstDow    = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const validSet    = new Set(allDays.map(d => d.val));

  const cells: Array<{ d: number; val: string; valid: boolean } | null> = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const val = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ d, val, valid: validSet.has(val) });
  }

  return (
    <View style={{ backgroundColor: Colors.bgCard, borderRadius: 14, borderWidth: 1.5, borderColor: Colors.border, padding: 12, marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <TouchableOpacity onPress={() => offset > 0 && setOffset(o => o - 1)}
          style={{ width: 28, height: 28, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center', opacity: offset > 0 ? 1 : 0.3 }}>
          <Text style={{ color: Colors.textSecondary, fontSize: 16, fontWeight: '600' }}>‹</Text>
        </TouchableOpacity>
        <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary }}>{FR_MONTHS_LONG[month]} {year}</Text>
        <TouchableOpacity onPress={() => offset < 3 && setOffset(o => o + 1)}
          style={{ width: 28, height: 28, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center', opacity: offset < 3 ? 1 : 0.3 }}>
          <Text style={{ color: Colors.textSecondary, fontSize: 16, fontWeight: '600' }}>›</Text>
        </TouchableOpacity>
      </View>
      {/* Day headers */}
      <View style={{ flexDirection: 'row', marginBottom: 4 }}>
        {FR_DAYS_SHORT.map(d => (
          <View key={d} style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ fontSize: 9.5, fontWeight: '900', color: Colors.textMuted }}>{d}</Text>
          </View>
        ))}
      </View>
      {/* Day cells */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {cells.map((cell, i) => {
          if (!cell) return <View key={`e${i}`} style={{ width: '14.28%', height: 34 }} />;
          const active  = cell.val === selectedVal;
          const isToday = cell.val === todayStr;
          const hasGame = cell.valid && daysWithGames.has(cell.val);
          return (
            <TouchableOpacity key={i} onPress={() => cell.valid && onSelect(cell.val)}
              activeOpacity={cell.valid ? 0.7 : 1}
              style={{ width: '14.28%', height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center', position: 'relative',
                backgroundColor: active ? t.btnBg : isToday ? t.eloBg : 'transparent',
                opacity: !cell.valid ? 0.3 : 1,
              }}>
              <Text style={{ fontSize: 12, fontWeight: (active || isToday) ? '900' : '500',
                color: active ? Colors.textOnDark : isToday ? t.eloColor : Colors.textPrimary,
              }}>{cell.d}</Text>
              {hasGame && (
                <View style={{ position: 'absolute', bottom: 3, width: 5, height: 5, borderRadius: 2.5,
                  backgroundColor: active ? Colors.textOnDark : Colors.textMuted }} />
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// ─── Main component ───────────────────────────────────────────
export default function CreateWizard({ visible, onClose, onPublishedDone, onPublish, player, initialGameType, initialInvite, initialInvites, targeted }: Props) {
  const insets = useSafeAreaInsets();
  const ALL_DAYS   = buildDays(92);
  const QUICK_DAYS = ALL_DAYS.slice(0, 7);

  // UI state
  const [step,        setStep]        = useState(0);
  const [published,   setPublished]   = useState(false);
  const [publishedGameId, setPublishedGameId] = useState<string | null>(null);
  const [submitting,  setSubmitting]  = useState(false);
  const [showAbandon, setShowAbandon] = useState(false);
  const [showCal,     setShowCal]     = useState(false);
  const [venueOpen,   setVenueOpen]   = useState(false);
  const [venueSearch, setVenueSearch] = useState('');
  const [mapOpen,     setMapOpen]     = useState(false);
  const [inviteTarget, setInviteTarget] = useState<string | null>(null);

  // Data
  const [clubsList,   setClubsList]   = useState<string[]>([]);
  const [clubFavs,    setClubFavs]    = useState<string[]>([]);
  const [manageClubsOpen, setManageClubsOpen] = useState(false);
  const [freqPlayers, setFreqPlayers] = useState<Array<{ id: string; name: string; elo_score: number }>>([]);
  // Largeur mesurée de la grille des équipes : les photos des places la remplissent.
  const [largeurEquipes, setLargeurEquipes] = useState(0);
  const [searchQ,     setSearchQ]     = useState('');
  const [searchRes,   setSearchRes]   = useState<any[]>([]);
  const [searching,   setSearching]   = useState(false);
  const [busyGames, setBusyGames] = useState<BusyGame[]>([]);

  // Form
  const myLevel = player ? eloToLevel(player.elo_score) : 4.0;
  const defaultBand = defaultLevelBand('Compétitif', myLevel);

  const [form, setFormState] = useState({
    day:            QUICK_DAYS[1]?.val ?? '',
    time:           '19:00',
    location:       '',
    hasReservation: false,
    gameType:       'Compétitif' as GameType,
    genre:          'mixed' as Genre,
    minLevel:       defaultBand.min,
    maxLevel:       defaultBand.max,
    stakeMultiplier: DEFAULT_DEFI_STAKE,
    mySlot:         'A0' as string | null,
    invites:        {} as Record<string, InvitedPlayer>,
  });

  const set = useCallback(<K extends keyof typeof form>(k: K, v: typeof form[K]) => {
    setFormState(f => ({ ...f, [k]: v }));
  }, []);

  // Select a day; drop the chosen time if it would now be in the past (e.g. when
  // switching to "Aujourd'hui" after having picked an earlier slot on another day).
  const pickDay = useCallback((val: string) => {
    setFormState(f => ({ ...f, day: val, time: isPastSlot(val, f.time) ? '' : f.time }));
  }, []);

  const t = getTheme(form.gameType);
  const STEP_LABELS = screenLabels(form.gameType);
  const LAST_STEP = STEP_LABELS.length - 1;
  const isDefi = form.gameType === 'Défi';
  const router = useRouter();
  useFocusEffect(
    useCallback(() => {
      const v = consumePickedVenue();
      if (v) set('location', v);
      // Recharge les favoris à chaque focus (retour de « Gérer mes clubs » inclus).
      if (player?.id) loadClubFavorites(player.id).then(setClubFavs).catch(() => {});
    }, [player?.id]),
  );

  // Reset on open
  useEffect(() => {
    if (!visible) return;
    const lv = player ? eloToLevel(player.elo_score) : 4.0;
    setStep(0); setPublished(false); setPublishedGameId(null); setSubmitting(false);
    setShowAbandon(false); setShowCal(false); setVenueOpen(false); setVenueSearch('');
    setInviteTarget(null); setSearchQ(''); setSearchRes([]);
    const gameType = initialGameType ?? 'Compétitif';
    const invites: Record<string, InvitedPlayer> = {};
    if (initialInvites) {
      (['A1', 'B0', 'B1'] as const).forEach(slot => {
        const p = initialInvites[slot];
        if (p) invites[slot] = { id: p.id, name: p.name, elo_score: p.elo_score, avatar_path: (p as any).avatar_path };
      });
    } else if (initialInvite) {
      const opponentSlot = initialInvite.court_side === 'right' ? 'B1' : 'B0';
      invites[opponentSlot] = {
        id: initialInvite.id,
        name: initialInvite.name,
        elo_score: initialInvite.elo_score,
        avatar_path: (initialInvite as any).avatar_path,
      };
    }
    const defaultGenre: Genre =
      player?.gender === 'male' ? 'men' : player?.gender === 'female' ? 'women' : 'mixed';
    const band = defaultLevelBand(gameType, lv);
    setFormState({
      day: QUICK_DAYS[1]?.val ?? '', time: '19:00', location: '',
      hasReservation: false, gameType, genre: defaultGenre,
      minLevel: band.min, maxLevel: band.max, stakeMultiplier: DEFAULT_DEFI_STAKE, mySlot: 'A0', invites,
    });
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load clubs
  useEffect(() => {
    if (!visible) return;
    supabase.from('clubs').select('name').order('name').then(({ data }) => {
      if (data) setClubsList(data.map((c: any) => c.name));
    });
  }, [visible]);

  // Load frequent players
  useEffect(() => {
    if (!visible || !player) return;
    const myId = player.id;
    supabase.from('matches')
      .select('winner_id,winner_id_2,loser_id,loser_id_2')
      .or(`winner_id.eq.${myId},winner_id_2.eq.${myId},loser_id.eq.${myId},loser_id_2.eq.${myId}`)
      .eq('status', 'validated').order('created_at', { ascending: false }).limit(30)
      .then(({ data: matches }) => {
        if (!matches?.length) return;
        const freq: Record<string, number> = {};
        matches.forEach((m: any) => {
          [m.winner_id, m.winner_id_2, m.loser_id, m.loser_id_2].forEach((id: string | null) => {
            if (id && id !== myId) freq[id] = (freq[id] || 0) + 1;
          });
        });
        const topIds = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id]) => id);
        if (!topIds.length) return;
        supabase.from('players').select('id,name,elo_score,avatar_path').in('id', topIds).is('deleted_at', null).then(({ data: players }) => {
          if (players) setFreqPlayers(topIds.map(id => (players as any[]).find(p => p.id === id)).filter(Boolean));
        });
      });
  }, [visible, player]);

  // Load the player's upcoming games to surface schedule conflicts (±2h).
  // Sources et libellés de rôle alignés sur le pre-check du publish (lobby.tsx).
  useEffect(() => {
    if (!visible || !player) return;
    const myId = player.id;
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const fromIso = todayStart.toISOString();
    let cancelled = false;

    (async () => {
      const [{ data: created }, { data: joined }] = await Promise.all([
        supabase.from('open_games')
          .select('location, match_date')
          .eq('creator_id', myId)
          .neq('status', 'cancelled')
          .gte('match_date', fromIso),
        supabase.from('game_participants')
          .select('status, invite_expires_at, game:game_id(location, match_date, status)')
          .eq('player_id', myId)
          .in('status', ['accepted', 'pending', 'invited', 'waitlist']),
      ]);
      if (cancelled) return;

      const games: BusyGame[] = [];
      (created ?? []).forEach((g: any) => {
        if (!g.match_date) return;
        games.push({ ts: new Date(g.match_date).getTime(), location: g.location ?? null, role: 'organisateur' });
      });
      const ROLE: Record<string, string> = {
        accepted: 'inscrit', invited: 'invité', waitlist: "liste d'attente", pending: 'candidature',
      };
      const now = Date.now();
      (joined ?? []).forEach((p: any) => {
        const g = p.game;
        if (!g || g.status === 'cancelled' || !g.match_date) return;
        // Une invitation expirée (horloge dépassée, cron pas encore passé) n'est plus
        // un engagement → ne doit pas déclencher de faux conflit de créneau.
        if (p.status === 'invited' && !isInviteActive(p)) return;
        const ts = new Date(g.match_date).getTime();
        if (ts < todayStart.getTime()) return;
        // Engagement non confirmé (candidature/invité/liste d'attente) sur une partie
        // déjà commencée → la partie s'est faite (ou non) sans moi : ce n'est plus
        // un conflit. Seuls 'accepted'/organisateur restent un vrai créneau occupé.
        if (p.status !== 'accepted' && ts <= now) return;
        games.push({ ts, location: g.location ?? null, role: ROLE[p.status] ?? 'engagement' });
      });
      setBusyGames(games);
    })();

    return () => { cancelled = true; };
  }, [visible, player]);

  // Player search
  useEffect(() => {
    if (searchQ.length < 2) { setSearchRes([]); return; }
    setSearching(true);
    const t = setTimeout(() => {
      supabase.from('players').select('id,name,elo_score,avatar_path')
        .is('deleted_at', null)
        .ilike('name', `%${searchQ}%`)
        .neq('id', player?.id ?? '')
        .limit(6)
        .then(({ data }) => { setSearchRes(data || []); setSearching(false); });
    }, 300);
    return () => clearTimeout(t);
  }, [searchQ, player]);

  // Step validation
  // partenaire créateur choisi = exactement 1 invité sur Team A (slot A0/A1)
  const defiPartnerChosen = isDefi && Object.keys(form.invites).some(k => k.startsWith('A'));
  const canNext = (() => {
    if (step === 0) return !!form.day && !!form.time && !!form.location && !isPastSlot(form.day, form.time);
    if (step === 1) return !!form.gameType && (isDefi || isDefiBandWideEnough(form.minLevel, form.maxLevel));
    if (isDefi && step === 2) return defiPartnerChosen;          // Mon binôme
    if (isDefi && step === 3) return isDefiBandWideEnough(form.minLevel, form.maxLevel) && DEFI_STAKES.some(p => p.value === form.stakeMultiplier);
    return true; // L'équipe (non-défi) : publication libre comme aujourd'hui
  })();

  // ── Dérivés conflit d'horaire (depuis busyGames) ──
  const daysWithGames = useMemo(
    () => new Set(busyGames.map(g => localDateStr(new Date(g.ts)))),
    [busyGames],
  );
  const occupiedTimes = useMemo(() => {
    const s = new Set<string>();
    if (!form.day) return s;
    for (const tm of TIMES) {
      const slotTs = new Date(`${form.day}T${tm}`).getTime();
      if (isNaN(slotTs)) continue;
      if (busyGames.some(g => Math.abs(g.ts - slotTs) < OVERLAP_MS)) s.add(tm);
    }
    return s;
  }, [busyGames, form.day]);
  const selectedConflicts = useMemo<BusyGame[]>(() => {
    if (!form.day || !form.time) return [];
    const slotTs = new Date(`${form.day}T${form.time}`).getTime();
    if (isNaN(slotTs)) return [];
    return busyGames.filter(g => Math.abs(g.ts - slotTs) < OVERLAP_MS);
  }, [busyGames, form.day, form.time]);

  // Plancher de niveau du défi = moyenne (créateur, partenaire choisi).
  // Le partenaire est l'unique invité sur un slot Team A (A0/A1).
  const defiPartner = Object.entries(form.invites).find(([k]) => k === 'A1')?.[1] ?? null;
  const defiFloorLevel = (() => {
    const meLv = player ? eloToLevel(player.elo_score) : 4.0;
    if (!defiPartner) return meLv;
    return +(((meLv + eloToLevel(defiPartner.elo_score)) / 2)).toFixed(2);
  })();

  // Step 2 helpers
  const invitedPlayers = Object.values(form.invites);
  const filledCount    = ['A0','A1','B0','B1'].filter(k => k === form.mySlot || form.invites[k]).length;
  const missingCount   = 4 - filledCount;
  const freqAvail  = freqPlayers.filter(fp => !invitedPlayers.find(i => i.id === fp.id) && fp.id !== player?.id);
  const searchAvail = searchRes.filter(r => !invitedPlayers.find(i => i.id === r.id) && r.id !== player?.id);

  function openInvite(key: string) { setInviteTarget(key); setSearchQ(''); }

  useEffect(() => {
    const manquants = Object.values(form.invites)
      .filter(p => p && p.avatar_path === undefined)
      .map(p => p.id);
    if (manquants.length === 0) return;
    let vivant = true;
    supabase.from('players').select('id, avatar_path').in('id', manquants).then(({ data }) => {
      if (!vivant) return;
      const parId = new Map((data ?? []).map((r: any) => [r.id as string, (r.avatar_path ?? null) as string | null]));
      setFormState(f => {
        const invites = { ...f.invites };
        for (const [slot, p] of Object.entries(invites)) {
          // Toujours défini après coup (null si introuvable) : l'effet ne se relance pas en boucle.
          if (p && p.avatar_path === undefined) invites[slot] = { ...p, avatar_path: parId.get(p.id) ?? null };
        }
        return { ...f, invites };
      });
    });
    return () => { vivant = false; };
  }, [form.invites]);

  function assignPlayer(p: InvitedPlayer) {
    if (!inviteTarget) return;
    const newInvites = { ...form.invites, [inviteTarget]: p };
    const newMySlot  = form.mySlot === inviteTarget ? null : form.mySlot;
    setFormState(f => ({ ...f, invites: newInvites, mySlot: newMySlot }));
    setInviteTarget(null); setSearchQ('');
  }

  function pickMeSlot(key: string | null) {
    if (!key) { set('mySlot', null); return; }
    const inv = { ...form.invites }; delete inv[key];
    setFormState(f => ({ ...f, mySlot: key, invites: inv }));
  }

  async function handlePublish() {
    if (submitting) return;
    if (isPastSlot(form.day, form.time)) {
      Alert.alert('Heure dépassée', "L'heure choisie est déjà passée. Choisis un créneau à venir.");
      return;
    }
    setSubmitting(true);
    try {
      const newId = await onPublish({
        gameType:       form.gameType,
        genre:          form.genre,
        matchDate:      form.day,
        matchTime:      form.time,
        location:       form.location,
        hasReservation: form.hasReservation,
        minLevel:       form.minLevel,
        maxLevel:       form.maxLevel,
        stakeMultiplier: form.gameType === 'Défi' ? form.stakeMultiplier : 1.0,
        creatorSide:    form.mySlot ? SLOT_TO_SIDE[form.mySlot] : 'A_GAU',
        confirmedPlayers: Object.entries(form.invites).map(([slot, p]) => ({ ...p, team_side: SLOT_TO_SIDE[slot] })),
        isTargeted: form.gameType === 'Défi' && !!targeted,
      });
      setPublishedGameId(newId ?? null);
      setPublished(true);
    } catch { /* onPublish shows Alert */ }
    finally { setSubmitting(false); }
  }

  // ─── Partage + Ajout au calendrier (écran "Partie publiée") ────
  async function shareCreatedGame() {
    const start = new Date(`${form.day}T${form.time}:00`);
    // Créateur confirmé (🟢), invités du wizard pas encore acceptés (⏳ nominatif),
    // le reste en places libres — même gabarit que lobby/fiche (buildGameShareMessage).
    const invited = Object.values(form.invites) as { name?: string; elo_score?: number }[];
    const msg = buildGameShareMessage({
      gameId: publishedGameId,
      location: form.location,
      matchDate: start,
      kind: form.gameType === 'Défi' ? 'challenge' : form.gameType === 'Amical' ? 'friendly' : 'competitive',
      stake: form.gameType === 'Défi' ? form.stakeMultiplier : 1,
      players: [
        ...(player ? [{ name: player.name, elo: player.elo_score }] : []),
        ...invited.map(p => ({ name: p.name, elo: p.elo_score, pending: true })),
      ],
      freeSpots: Math.max(0, 4 - 1 - invited.length),
      eloRange: { min: padelLevelToElo(form.minLevel), max: padelLevelToElo(form.maxLevel) },
    });
    try { await Share.share({ message: msg }); } catch { /* cancelled */ }
  }

  function addCreatedGameToCalendar() {
    const start = new Date(`${form.day}T${form.time}:00`);
    const end = new Date(start.getTime() + 90 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const fmt = (d: Date) =>
      `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: `Match Padel – ${form.location}`,
      dates: `${fmt(start)}/${fmt(end)}`,
      location: form.location,
      details: 'Match Padel',
    });
    Linking.openURL(`https://calendar.google.com/calendar/render?${params}`);
  }

  // En Défi, fige minLevel au plancher dès que le binôme/plancher change,
  // et remonte maxLevel pour garder une fourchette relevable.
  useEffect(() => {
    if (form.gameType !== 'Défi') return;
    setFormState(f => {
      const band = widenBand(defiFloorLevel, f.maxLevel);
      return { ...f, minLevel: band.min, maxLevel: band.max };
    });
  }, [form.gameType, defiFloorLevel]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Step 0: When & Where ──────────────────────────────────
  function renderStep0() {
    // Favoris en tête de liste (dans leur ordre), puis le reste alphabétique.
    const favRank = (c: string) => { const i = clubFavs.indexOf(c); return i === -1 ? Number.MAX_SAFE_INTEGER : i; };
    const filteredClubs = clubsList
      .filter(c => c.toLowerCase().includes(venueSearch.toLowerCase()))
      .sort((a, b) => favRank(a) - favRank(b) || a.localeCompare(b));
    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        {/* Venue */}
        <Text style={sty.sectionLabel}>Terrain</Text>
        {/* Reservation toggle */}
        <TouchableOpacity onPress={() => set('hasReservation', !form.hasReservation)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12,
            backgroundColor: form.hasReservation ? 'rgba(255,193,26,0.14)' : Colors.bg,
            borderWidth: 1.5, borderColor: form.hasReservation ? 'rgba(255,193,26,0.55)' : Colors.border, marginBottom: 10,
          }}>
          <Icon name="calendar" size={15} color={form.hasReservation ? Colors.brandDeep : Colors.textSecondary} stroke={2} />
          <Text style={{ flex: 1, fontSize: 13, fontFamily: Fonts.uiBlack, fontWeight: '900', color: form.hasReservation ? Colors.brandDeep : Colors.textSecondary }}>
            J'ai une réservation
          </Text>
          <View style={{ width: 42, height: 24, borderRadius: 99, backgroundColor: form.hasReservation ? Colors.brand : Colors.border, justifyContent: 'center', paddingHorizontal: 3 }}>
            <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: Colors.bgCard, alignSelf: form.hasReservation ? 'flex-end' : 'flex-start', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 2 }} />
          </View>
        </TouchableOpacity>

        {/* Clubs favoris : sélection en 1 tap + lien vers l'écran de gestion */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
          <Text style={{ fontSize: 11, fontWeight: '900', letterSpacing: 0.8, color: Colors.textMuted }}>CLUBS FAVORIS</Text>
          <Icon name="star" size={12} color={Colors.brand} fill={Colors.brand} stroke={2} />
          <View style={{ flex: 1 }} />
          <TouchableOpacity onPress={() => setManageClubsOpen(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            <Text style={{ fontSize: 12, fontWeight: '900', color: Colors.textSecondary }}>Gérer</Text>
            <Icon name="chevronRight" size={13} color={Colors.textSecondary} stroke={2.5} />
          </TouchableOpacity>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
          {clubFavs.map(club => {
            const active = form.location === club;
            return (
              <TouchableOpacity key={club} onPress={() => { set('location', active ? '' : club); setVenueOpen(false); setVenueSearch(''); }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingLeft: 6, paddingRight: 12, paddingVertical: 6, borderRadius: 999,
                  borderWidth: 1.5, borderColor: active ? t.eloBorder : Colors.border,
                  backgroundColor: active ? t.selectBg : Colors.bgCard,
                }}>
                <ClubAvatar name={club} size={24} radius={999} mono="black" />
                <Text style={{ fontSize: 12, fontWeight: '900', color: active ? t.selectColor : Colors.textPrimary }} numberOfLines={1}>
                  {club}
                </Text>
                {active && <Icon name="check" size={12} color={t.accent} stroke={3} />}
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity onPress={() => setManageClubsOpen(true)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
              borderWidth: 1.5, borderColor: Colors.border, borderStyle: 'dashed', backgroundColor: Colors.bg,
            }}>
            <Icon name="plus" size={12} color={Colors.textSecondary} stroke={2.5} />
            <Text style={{ fontSize: 12, fontWeight: '800', color: Colors.textSecondary }}>
              {clubFavs.length === 0 ? 'Ajouter des favoris' : 'Ajouter'}
            </Text>
          </TouchableOpacity>
        </ScrollView>

        {/* Séparateur OU */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 8 }}>
          <View style={{ flex: 1, height: 1, backgroundColor: Colors.border }} />
          <Text style={{ fontSize: 10, fontWeight: '900', letterSpacing: 1.5, color: Colors.textMuted }}>OU</Text>
          <View style={{ flex: 1, height: 1, backgroundColor: Colors.border }} />
        </View>

        {/* Venue picker + bouton Plan à côté */}
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginBottom: 10 }}>
          <View style={{ flex: 1 }}>
            <TouchableOpacity onPress={() => setVenueOpen(v => !v)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 13,
                borderWidth: 1.5, borderColor: form.location ? t.eloBorder : Colors.border,
                backgroundColor: form.location ? t.selectBg : Colors.bgCard,
              }}>
          <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: form.location ? t.btnBg : Colors.bgCardAlt, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="mapPin" size={14} color={form.location ? Colors.textOnDark : Colors.textSecondary} stroke={2.2} />
          </View>
          <Text style={{ flex: 1, fontSize: 13, fontWeight: form.location ? '900' : '500', color: form.location ? t.selectColor : Colors.textMuted }}>
            {form.location || 'Voir tous les clubs…'}
          </Text>
          <Text style={{ color: Colors.textMuted, fontSize: 12 }}>{venueOpen ? '▲' : '▼'}</Text>
        </TouchableOpacity>

        {venueOpen && (
          <View style={{ backgroundColor: Colors.bgCard, borderWidth: 1.5, borderColor: t.eloBorder, borderTopWidth: 0, borderBottomLeftRadius: 13, borderBottomRightRadius: 13, overflow: 'hidden' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderBottomWidth: 1, borderBottomColor: Colors.bgCardAlt }}>
              <Icon name="search" size={13} color={Colors.textMuted} stroke={2.2} />
              <TextInput
                value={venueSearch} onChangeText={setVenueSearch}
                placeholder="Rechercher…" placeholderTextColor={Colors.textMuted}
                style={{ flex: 1, fontSize: 13, color: Colors.textPrimary }}
                autoFocus
              />
              {venueSearch ? <TouchableOpacity onPress={() => setVenueSearch('')}><Icon name="x" size={13} color={Colors.textMuted} stroke={2.5} /></TouchableOpacity> : null}
            </View>
            <ScrollView
              style={{ maxHeight: 200 }}
              showsVerticalScrollIndicator
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
            >
              {filteredClubs.map(club => {
                const active = form.location === club;
                return (
                  <TouchableOpacity key={club} onPress={() => { set('location', club); setVenueOpen(false); setVenueSearch(''); }}
                    style={{ flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: Colors.bg, backgroundColor: active ? t.selectBg : Colors.bgCard }}>
                    <Text style={{ flex: 1, fontSize: 13, fontWeight: '700', color: active ? t.selectColor : Colors.textPrimary }}>{club}</Text>
                    {!active && clubFavs.includes(club) && <Icon name="star" size={12} color={Colors.brand} fill={Colors.brand} stroke={2} />}
                    {active && <Icon name="check" size={14} color={t.accent} stroke={2.5} />}
                  </TouchableOpacity>
                );
              })}
              {filteredClubs.length === 0 && venueSearch.length > 0 && (
                <TouchableOpacity onPress={() => { set('location', venueSearch); setVenueOpen(false); setVenueSearch(''); }}
                  style={{ padding: 12, alignItems: 'center' }}>
                  <Text style={{ fontSize: 12, fontWeight: '900', color: t.accent }}>+ Ajouter « {venueSearch} »</Text>
                </TouchableOpacity>
              )}
              {filteredClubs.length === 0 && venueSearch.length === 0 && (
                <View style={{ padding: 14, alignItems: 'center' }}>
                  <Text style={{ fontSize: 12, color: Colors.textMuted }}>Aucun club trouvé</Text>
                </View>
              )}
            </ScrollView>
          </View>
        )}
          </View>
          <TouchableOpacity onPress={() => setMapOpen(true)} activeOpacity={0.85}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10,
              backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10,
              borderWidth: 1, borderColor: Colors.border,
              shadowColor: Colors.textPrimary, shadowOpacity: 0.08, shadowRadius: 6,
              shadowOffset: { width: 0, height: 2 }, elevation: 2,
            }}>
            <Icon name="map" size={16} color={Colors.textPrimary} stroke={2} />
            <Text style={{ fontSize: 13, fontWeight: '900', color: Colors.textPrimary, fontFamily: Fonts.uiBlack }}>Plan</Text>
          </TouchableOpacity>
          <ClubsMapModal
            visible={mapOpen}
            onClose={() => setMapOpen(false)}
            onPick={(name) => { set('location', name); setMapOpen(false); setVenueOpen(false); setVenueSearch(''); }}
          />
          {/* Modal natif (comme la carte) : un router.push passerait DERRIÈRE le
              Modal du wizard et n'apparaîtrait qu'à sa fermeture. */}
          <ManageClubsModal
            visible={manageClubsOpen}
            playerId={player?.id ?? null}
            onClose={(favs) => { setClubFavs(favs); setManageClubsOpen(false); }}
          />
        </View>

        {/* Date */}
        <Text style={[sty.sectionLabel, { marginTop: 4 }]}>Jour</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: showCal ? 8 : 14 }}>
          {QUICK_DAYS.map(d => {
            const active = form.day === d.val;
            const hasGame = daysWithGames.has(d.val);
            return (
              <TouchableOpacity key={d.val} onPress={() => { pickDay(d.val); setShowCal(false); }}
                style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, position: 'relative',
                  borderWidth: 2, borderColor: active ? t.accent : Colors.border,
                  backgroundColor: active ? t.selectBg : Colors.bgCard,
                }}>
                <Text style={{ fontSize: 12, fontWeight: active ? '900' : '600', color: active ? t.selectColor : Colors.textPrimary }}>
                  {d.label}
                </Text>
                {hasGame && (
                  <View style={{ position: 'absolute', top: 4, right: 4, width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.textMuted }} />
                )}
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity onPress={() => setShowCal(v => !v)}
            style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12,
              borderWidth: 2, borderColor: showCal ? t.eloBorder : Colors.border,
              backgroundColor: showCal ? t.selectBg : 'transparent',
            }}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: showCal ? t.selectColor : Colors.textMuted }}>
              📅 {showCal ? 'Masquer' : 'Autres dates'}
            </Text>
          </TouchableOpacity>
        </View>

        {showCal && (
          <MiniCalendar selectedVal={form.day} onSelect={v => { pickDay(v); setShowCal(false); }} t={t} allDays={ALL_DAYS} daysWithGames={daysWithGames} />
        )}

        {/* Selected day pill (when from calendar) */}
        {form.day && !QUICK_DAYS.find(d => d.val === form.day) && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 10,
            backgroundColor: t.selectBg, borderWidth: 1.5, borderColor: t.eloBorder, borderRadius: 10, padding: 9 }}>
            <Icon name="calendar" size={13} color={t.selectColor} stroke={2} />
            <Text style={{ fontSize: 12, fontWeight: '900', color: t.selectColor, flex: 1 }}>
              {ALL_DAYS.find(d => d.val === form.day)?.label || form.day}
            </Text>
            <TouchableOpacity onPress={() => pickDay(QUICK_DAYS[0].val)}>
              <Icon name="x" size={13} color={t.selectColor} stroke={2.5} />
            </TouchableOpacity>
          </View>
        )}

        {/* Time */}
        <Text style={[sty.sectionLabel, { marginTop: 4 }]}>Heure</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
          {TIMES.map(tm => {
            const active   = form.time === tm;
            const past     = isPastSlot(form.day, tm);
            const occupied = !past && occupiedTimes.has(tm);
            return (
              <TouchableOpacity key={tm} disabled={past} onPress={() => set('time', tm)}
                style={{ width: '23%', paddingVertical: 9, borderRadius: 10, position: 'relative',
                  borderWidth: 1.5,
                  borderColor: active ? t.eloBorder : occupied ? Colors.warning : Colors.border,
                  backgroundColor: active ? t.selectBg : Colors.bgCard, alignItems: 'center',
                  opacity: past ? 0.35 : 1,
                }}>
                <Text style={{ fontSize: 12, fontWeight: active ? '900' : '600',
                  color: active ? t.selectColor : Colors.textPrimary,
                  textDecorationLine: past ? 'line-through' : 'none' }}>{tm}</Text>
                {occupied && (
                  <View style={{ position: 'absolute', top: 4, right: 4, width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.warning }} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
        {/* Conflits sur le créneau choisi (chevauchement durée + marge) */}
        {form.time && selectedConflicts.length > 0 && (
          <View style={{ flexDirection: 'row', backgroundColor: 'rgba(245,158,11,0.08)',
            borderWidth: 1.5, borderColor: 'rgba(245,158,11,0.45)', borderRadius: 12,
            overflow: 'hidden', marginBottom: 16 }}>
            <View style={{ width: 4, backgroundColor: Colors.warning }} />
            <View style={{ flex: 1, padding: 11, gap: 7 }}>
              <Text style={{ fontSize: 12, fontWeight: '900', color: '#92400e' }}>
                ⚠️ Tu es déjà pris autour de ce créneau
              </Text>
              {selectedConflicts.map((g, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <Text style={{ fontSize: 11, color: Colors.textSecondary, flex: 1 }} numberOfLines={1}>
                    🗓️ {new Date(g.ts).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })} · {g.location ?? '?'}
                  </Text>
                  <Pill variant="brand">{g.role}</Pill>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    );
  }

  // ─── Step 1: The match ─────────────────────────────────────
  function renderStep1() {
    // Pictos au trait (registre Icon), comme le reste de l'app — plus d'emoji.
    // Défi = les épées croisées de la barre de navigation.
    const gameOptions: Array<{ val: GameType; icon: IconName; desc: string }> = [
      { val: 'Compétitif', icon: 'trophy', desc: 'Points ELO, matchs classés' },
      { val: 'Amical',     icon: 'heart',  desc: 'Détente, sans classement' },
      { val: 'Défi',       icon: 'swords', desc: 'Défier une équipe adverse' },
    ];
    const genderOptions: Array<{ val: Genre; icon: string; label: string; desc: string }> =
      player?.gender === 'male'
        ? [{ val: 'men',   icon: '♂', label: 'Hommes', desc: 'Réservé aux hommes' }, { val: 'mixed', icon: '⚧', label: 'Mixte', desc: 'Hommes & femmes' }]
        : player?.gender === 'female'
          ? [{ val: 'women', icon: '♀', label: 'Femmes', desc: 'Réservé aux femmes' }, { val: 'mixed', icon: '⚧', label: 'Mixte', desc: 'Hommes & femmes' }]
          : [{ val: 'mixed', icon: '⚧', label: 'Mixte', desc: 'Hommes & femmes' }, { val: 'men', icon: '♂', label: 'Hommes', desc: 'Réservé aux hommes' }, { val: 'women', icon: '♀', label: 'Femmes', desc: 'Réservé aux femmes' }];

    const lockMin = form.gameType !== 'Amical';
    const lockMax = form.gameType === 'Compétitif';

    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        {/* Game type */}
        <Text style={sty.sectionLabel}>Type de match</Text>
        <View style={{ gap: 8, marginBottom: 18 }}>
          {gameOptions.map(opt => {
            const ot     = getTheme(opt.val);
            const active = form.gameType === opt.val;
            return (
              <TouchableOpacity key={opt.val} activeOpacity={0.8}
                onPress={() => {
                  const lv = player ? eloToLevel(player.elo_score) : 4.0;
                  // Compétitif / Défi : (re)pose la bande via la source unique → garantit min <= max
                  // et reste iso avec l'ouverture (effet de reset). Amical : on garde les niveaux
                  // courants pour préserver les réglages manuels de l'utilisateur.
                  if (opt.val === 'Compétitif' || opt.val === 'Défi') {
                    const band = defaultLevelBand(opt.val, lv);
                    setFormState(f => ({ ...f, gameType: opt.val, minLevel: band.min, maxLevel: band.max }));
                  } else set('gameType', opt.val);
                  // Clamp step si on revient à un type avec moins d'étapes
                  setStep(s => Math.min(s, screenLabels(opt.val).length - 1));
                }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14,
                  borderWidth: 2, borderColor: active ? ot.eloBorder : Colors.border,
                  backgroundColor: active ? ot.teamABg : Colors.bgCard,
                }}>
                <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: active ? ot.btnBg : ot.eloBg, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon
                    name={opt.icon}
                    size={21}
                    stroke={2.2}
                    color={active ? (opt.val === 'Défi' ? '#0A0A0A' : opt.val === 'Compétitif' ? Colors.brand : '#FFFFFF') : ot.accent}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, fontWeight: '900', color: active ? ot.eloColor : Colors.textPrimary }}>{opt.val}</Text>
                  <Text style={{ fontSize: 11, color: Colors.textMuted, marginTop: 1 }}>{opt.desc}</Text>
                </View>
                {active && <Icon name="check" size={16} color={ot.accent} stroke={2.5} />}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Gender */}
        <Text style={sty.sectionLabel}>Format</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 18 }}>
          {genderOptions.map(opt => {
            const active = form.genre === opt.val;
            return (
              <TouchableOpacity key={opt.val} onPress={() => set('genre', opt.val)} activeOpacity={0.8}
                style={{ flex: 1, alignItems: 'center', gap: 5, paddingVertical: 12, paddingHorizontal: 6, borderRadius: 14,
                  borderWidth: 2, borderColor: active ? t.eloBorder : Colors.border,
                  backgroundColor: active ? t.selectBg : Colors.bgCard,
                }}>
                <Text style={{ fontSize: 22 }}>{opt.icon}</Text>
                <Text style={{ fontSize: 12, fontWeight: '900', color: active ? t.selectColor : Colors.textPrimary, textAlign: 'center' }}>{opt.label}</Text>
                <Text style={{ fontSize: 9.5, color: Colors.textMuted, textAlign: 'center' }}>{opt.desc}</Text>
                {active && <Icon name="check" size={14} color={t.accent} stroke={2.5} />}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Level range — masqué en Défi (géré à l'étape « Mise & plafond ») */}
        {form.gameType !== 'Défi' && (
          <>
            <Text style={sty.sectionLabel}>Niveau (Padel)</Text>
            <View style={{ backgroundColor: Colors.bgCard, borderRadius: 16, borderWidth: 1.5, borderColor: Colors.border, padding: 16, marginBottom: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                {/* Min */}
                <View style={{ flex: 1, alignItems: 'center' }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.textMuted, marginBottom: 6 }}>
                    Minimum{lockMin ? ' 🔒' : ''}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    {!lockMin && (
                      <TouchableOpacity onPress={() => set('minLevel', Math.max(1.0, +(form.minLevel - 0.1).toFixed(2)))}
                        style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: Colors.bgCardAlt, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ fontSize: 18, color: Colors.textPrimary }}>−</Text>
                      </TouchableOpacity>
                    )}
                    <Text style={{ fontSize: 26, fontFamily: Fonts.uiBlack, fontWeight: '900', color: t.eloColor, minWidth: 42, textAlign: 'center' }}>
                      {form.minLevel.toFixed(2)}
                    </Text>
                    {!lockMin && (
                      <TouchableOpacity onPress={() => set('minLevel', Math.min(+(form.maxLevel - DEFI_BAND_MIN_LEVEL).toFixed(2), +(form.minLevel + 0.1).toFixed(2)))}
                        style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: Colors.bgCardAlt, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ fontSize: 18, color: Colors.textPrimary }}>+</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
                <View style={{ width: 1, height: 40, backgroundColor: Colors.border }} />
                {/* Max */}
                <View style={{ flex: 1, alignItems: 'center' }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.textMuted, marginBottom: 6 }}>
                    Maximum{lockMax ? ' 🔒' : ''}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    {!lockMax && (
                      <TouchableOpacity onPress={() => set('maxLevel', Math.max(+(form.minLevel + DEFI_BAND_MIN_LEVEL).toFixed(2), +(form.maxLevel - 0.1).toFixed(2)))}
                        style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: Colors.bgCardAlt, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ fontSize: 18, color: Colors.textPrimary }}>−</Text>
                      </TouchableOpacity>
                    )}
                    <Text style={{ fontSize: 26, fontFamily: Fonts.uiBlack, fontWeight: '900', color: t.eloColor, minWidth: 42, textAlign: 'center' }}>
                      {form.maxLevel.toFixed(2)}
                    </Text>
                    {!lockMax && (
                      <TouchableOpacity onPress={() => set('maxLevel', Math.min(8.0, +(form.maxLevel + 0.1).toFixed(2)))}
                        style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: Colors.bgCardAlt, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ fontSize: 18, color: Colors.textPrimary }}>+</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </View>
              {/* Range bar */}
              <View style={{ height: 5, borderRadius: 99, backgroundColor: Colors.bgCardAlt, overflow: 'hidden' }}>
                <View style={{ position: 'absolute', height: '100%', borderRadius: 99, backgroundColor: t.btnBg,
                  left: `${((form.minLevel - 1) / 7) * 100}%`,
                  right: `${100 - ((form.maxLevel - 1) / 7) * 100}%`,
                }} />
              </View>
              {lockMin && (
                <View style={{ marginTop: 8, backgroundColor: t.eloBg, borderWidth: 1, borderColor: t.eloBorder, borderRadius: 8, padding: 8 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: t.eloColor, textAlign: 'center' }}>
                    {lockMax ? '🔒 Niveaux fixés selon votre niveau' : '🔒 Niveau minimum fixé selon votre niveau'}
                  </Text>
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>
    );
  }

  // ─── Step 2: The team ──────────────────────────────────────
  function renderStep2() {
    const recapItems = [
      ALL_DAYS.find(d => d.val === form.day)?.label || form.day,
      form.time, form.location || '—', form.gameType,
      form.genre === 'mixed' ? '⚧ Mixte' : form.genre === 'men' ? '♂ Hommes' : '♀ Femmes',
      `Niv. ${form.minLevel.toFixed(2)}–${form.maxLevel.toFixed(2)}`,
    ];
    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        {/* Status */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14, padding: 10, borderRadius: 12,
          backgroundColor: missingCount === 0 ? t.eloBg : '#fff7ed',
          borderWidth: 1, borderColor: missingCount === 0 ? t.eloBorder : '#fed7aa',
        }}>
          <Text style={{ fontSize: 16 }}>{missingCount === 0 ? '✅' : 'ℹ️'}</Text>
          <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, fontWeight: '900', color: missingCount === 0 ? t.eloColor : '#B45309' }}>
            {missingCount === 0 ? 'Équipe complète !'
              : `${missingCount} place${missingCount > 1 ? 's' : ''} libre${missingCount > 1 ? 's' : ''}`}
          </Text>
          {missingCount > 0 && (
            <Text style={{ fontSize: 11, color: '#9a3412', marginLeft: 'auto', flexShrink: 1 }}>
              Tapez un emplacement pour inviter
            </Text>
          )}
        </View>

        {/* Slot grid — les photos prennent toute la largeur disponible :
            2 équipes (écart 10), chacune avec marge 10 + bordure 1,5 de chaque
            côté, et 2 places séparées de 8. */}
        <View
          style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}
          onLayout={e => { const w = e.nativeEvent.layout.width; setLargeurEquipes(prev => (Math.abs(prev - w) < 1 ? prev : w)); }}
        >
          {(['A', 'B'] as const).map(team => (
            <View key={team} style={{ flex: 1, backgroundColor: team === 'A' ? t.teamABg : t.teamBBg,
              borderWidth: 1.5, borderColor: team === 'A' ? t.teamABorder : t.teamBBorder,
              borderRadius: 14, padding: 10, alignItems: 'center', gap: 8,
            }}>
              <View style={{ backgroundColor: team === 'A' ? t.teamABorder : t.teamBBorder, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ fontSize: 9, fontWeight: '900', color: t.accent, textTransform: 'uppercase', letterSpacing: 1 }}>
                  Équipe {team}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {([0, 1] as const).map(pos => {
                  const key    = `${team}${pos}`;
                  const PLACE  = largeurEquipes > 0
                    ? Math.max(48, Math.min(88, Math.floor(((largeurEquipes - 10) / 2 - 23 - 8) / 2)))
                    : 56;
                  const isMe   = form.mySlot === key;
                  const inv    = form.invites[key];
                  const isEmpty = !isMe && !inv;
                  // Couleur par ÉQUIPE relative à moi : mon équipe garde ma couleur
                  // (noir), l'équipe adverse en jaune. Mon partenaire invité partage
                  // donc la même couleur que moi.
                  const myTeam   = form.mySlot ? form.mySlot.charAt(0) : 'A';
                  const isMyTeam = team === myTeam;
                  const teamFill = isMyTeam ? Colors.primary : Colors.brand;
                  const teamFg   = isMyTeam ? Colors.textOnDark : Colors.textOnBrand;
                  return (
                    <View key={pos} style={{ alignItems: 'center', gap: 5 }}>
                      <TouchableOpacity
                        onPress={() => {
                          if (isMe) { pickMeSlot(null); }
                          else if (inv) { /* tap to remove */ const ni = { ...form.invites }; delete ni[key]; set('invites', ni); }
                          else if (!form.mySlot) { pickMeSlot(key); }
                          else { openInvite(key); }
                        }}
                        activeOpacity={0.7}
                        style={isEmpty ? {
                          width: PLACE, height: PLACE, borderRadius: PLACE / 2, alignItems: 'center', justifyContent: 'center',
                          backgroundColor: t.libreBg, borderWidth: 2, borderStyle: 'dashed', borderColor: t.libreBorder,
                        } : undefined}>
                        {isMe || inv ? (
                          <PlayerAvatar
                            name={isMe ? (player?.name ?? '?') : inv!.name}
                            path={isMe ? (player as any)?.avatar_path : inv!.avatar_path}
                            size={PLACE}
                            backgroundColor={teamFill} textColor={teamFg}
                            fontSize={Math.round(PLACE * 0.32)}
                            ring={isMe ? 2.5 : undefined} ringColor={Colors.bgCard}
                          >
                            {isMe ? <CreatorCrownBadge avatarSize={PLACE} /> : null}
                          </PlayerAvatar>
                        ) : (
                          <Text style={{ color: t.libreColor, fontSize: 22, fontWeight: '300' }}>+</Text>
                        )}
                      </TouchableOpacity>
                      <Text style={{ fontSize: 9.5, fontWeight: '700', color: isMe ? Colors.primary : inv ? Colors.primary : t.libreColor, maxWidth: PLACE + 8, textAlign: 'center' }} numberOfLines={1}>
                        {isMe ? 'Vous' : inv ? inv.name.split(' ')[0] : 'Libre'}
                      </Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <View style={{ backgroundColor: Colors.textPrimary, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                          <Text style={{ fontSize: 8, fontWeight: '900', color: Colors.textOnDark, letterSpacing: 0.5 }}>
                            {pos === 0 ? 'G' : 'D'}
                          </Text>
                        </View>
                        {(isMe && player) || inv ? (
                          <Text style={{ fontSize: 8.5, fontWeight: '700', color: Colors.textMuted }} numberOfLines={1}>
                            Niv. {formatPadelLevel(isMe ? player!.elo_score : inv!.elo_score)}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          ))}
        </View>

        {/* Invite panel */}
        {renderInvitePanel()}

        {/* Recap */}
        <View style={{ backgroundColor: Colors.bgCard, borderWidth: 1.5, borderColor: Colors.border, borderRadius: 14, overflow: 'hidden', marginBottom: 8 }}>
          <View style={{ height: 3, backgroundColor: t.btnBg }} />
          <View style={{ padding: 12 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {recapItems.map((item, i) => (
                <View key={i} style={{ backgroundColor: Colors.bgCardAlt, borderWidth: 1, borderColor: Colors.border, borderRadius: 99, paddingHorizontal: 9, paddingVertical: 3 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.textSecondary }}>{item}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      </ScrollView>
    );
  }

  // ─── Panneau d'invitation (DRY — partagé entre renderStep2 et renderDefiBinome) ──
  function renderInvitePanel() {
    if (!inviteTarget) return null;
    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ backgroundColor: Colors.bgCard, borderWidth: 1.5, borderColor: Colors.border, borderRadius: 14, padding: 12, marginBottom: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <Text style={{ fontSize: 11, fontWeight: '900', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 }}>
              {form.gameType === 'Défi' ? 'Mon binôme' : `Inviter — Éq. ${inviteTarget[0]} · ${inviteTarget[1] === '0' ? 'Gauche' : 'Droite'}`}
            </Text>
            <TouchableOpacity onPress={() => { setInviteTarget(null); setSearchQ(''); }}
              style={{ width: 24, height: 24, backgroundColor: Colors.bgCardAlt, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="x" size={11} color={Colors.textSecondary} stroke={2.5} />
            </TouchableOpacity>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.bg, borderRadius: 10, padding: 10, borderWidth: 1.5, borderColor: Colors.border, marginBottom: 10 }}>
            <Icon name="search" size={13} color={Colors.textMuted} stroke={2.2} />
            <TextInput
              value={searchQ} onChangeText={setSearchQ}
              placeholder="Nom du joueur…" placeholderTextColor={Colors.textMuted}
              style={{ flex: 1, fontSize: 13, color: Colors.textPrimary }}
              autoFocus
            />
            {searching && <ActivityIndicator size="small" color={Colors.primary} />}
          </View>
          {/* Frequent players */}
          {!searchQ && freqAvail.length > 0 && (
            <>
              <Text style={[sty.sectionLabel, { marginBottom: 6 }]}>Habituels</Text>
              <View style={{ gap: 5, marginBottom: searchAvail.length > 0 ? 10 : 0 }}>
                {freqAvail.map(p => (
                  <TouchableOpacity key={p.id} onPress={() => assignPlayer(p)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.bgCard }}>
                    <Avatar name={p.name} path={(p as any).avatar_path} size={40} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.textPrimary }}>{p.name}</Text>
                      <Text style={{ fontSize: 10, color: Colors.textMuted }}>Niv. {formatPadelLevel(p.elo_score)}</Text>
                    </View>
                    <Pill variant="brand">Habituel</Pill>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}
          {/* Search results */}
          {searchAvail.length > 0 && (
            <View style={{ gap: 5 }}>
              {searchAvail.map(p => (
                <TouchableOpacity key={p.id} onPress={() => assignPlayer(p)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#fff' }}>
                  <Avatar name={p.name} path={(p as any).avatar_path} size={40} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#0f172a' }}>{p.name}</Text>
                    <Text style={{ fontSize: 10, color: '#94a3b8' }}>Niv. {formatPadelLevel(p.elo_score)}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    );
  }

  // ── Étape Défi : choisir mon binôme (Team A = moi + 1 partenaire) ──
  function renderDefiBinome() {
    const teamBSlots = (['B0', 'B1'] as const);
    // Maquette « Binôme du défi » (2026-09-19) : deux cartes (Capitaine /
    // Partenaire), la moyenne, le plancher, et une note d'équipe.
    const carteJoueur = {
      flex: 1, backgroundColor: 'rgba(255,193,26,0.08)', borderWidth: 1.5, borderColor: 'rgba(255,193,26,0.55)',
      borderRadius: 18, paddingVertical: 16, paddingHorizontal: 10, alignItems: 'center', gap: 6,
    } as const;
    const pastille = (fond: string) => ({
      flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: fond,
      borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4,
    }) as const;
    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120, gap: 14 }}>
        {/* En-tête de section */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon name="users" size={18} color={Colors.brandDeep} stroke={2.4} />
          <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.textPrimary, letterSpacing: 0.6, textTransform: 'uppercase' }}>Binôme du défi</Text>
          <Text numberOfLines={1} style={{ flex: 1, textAlign: 'right', fontSize: 11, fontStyle: 'italic', color: Colors.textMuted }}>
            Un binôme. Un défi. Plus loin ensemble.
          </Text>
        </View>

        <View style={{ flexDirection: 'row', gap: 10 }}>
          {/* Moi (A0) — le capitaine */}
          <View style={carteJoueur}>
            <View style={{ position: 'absolute', top: 10, left: 10, width: 30, height: 22, borderRadius: 11, backgroundColor: 'rgba(255,193,26,0.25)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="crown" size={13} color={Colors.brandDeep} stroke={2.4} />
            </View>
            <Avatar name={player?.name ?? '?'} path={(player as any)?.avatar_path} size={78} />
            <Text style={{ fontSize: 17, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }} numberOfLines={1}>Toi</Text>
            <View style={pastille('rgba(255,193,26,0.30)')}>
              <Icon name="crown" size={12} color={Colors.brandDeep} stroke={2.4} />
              <Text style={{ fontSize: 11.5, fontFamily: Fonts.uiBold, color: Colors.textPrimary }}>Capitaine</Text>
            </View>
            <Text style={{ fontSize: 13, color: Colors.textMuted }}>Niv. {player ? formatPadelLevel(player.elo_score) : '—'}</Text>
          </View>

          {/* Partenaire (A1) — toucher pour choisir, ou pour changer */}
          <TouchableOpacity activeOpacity={0.8}
            onPress={() => defiPartner ? (() => { const ni = { ...form.invites }; delete ni['A1']; set('invites', ni); })() : openInvite('A1')}
            accessibilityLabel={defiPartner ? 'Changer de partenaire' : 'Choisir mon partenaire'}
            style={[carteJoueur, !defiPartner && { borderStyle: 'dashed', backgroundColor: t.libreBg, borderColor: t.libreBorder, justifyContent: 'center' }]}>
            {defiPartner ? (
              <>
                <Avatar name={defiPartner.name} path={(defiPartner as any).avatar_path} size={78} />
                <Text style={{ fontSize: 17, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }} numberOfLines={1}>{defiPartner.name.split(' ')[0]}</Text>
                <View style={pastille(Colors.bgCardAlt)}>
                  <Icon name="users" size={12} color={Colors.textSecondary} stroke={2.4} />
                  <Text style={{ fontSize: 11.5, fontFamily: Fonts.uiBold, color: Colors.textSecondary }}>Partenaire</Text>
                </View>
                <Text style={{ fontSize: 13, color: Colors.textMuted }}>Niv. {formatPadelLevel(defiPartner.elo_score)}</Text>
                <Text style={{ fontSize: 10.5, fontFamily: Fonts.uiBold, color: Colors.textMuted }}>Toucher pour changer</Text>
              </>
            ) : (
              <>
                <View style={{ width: 62, height: 62, borderRadius: 31, borderWidth: 2, borderStyle: 'dashed', borderColor: t.libreBorder, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 28, color: t.libreColor, fontWeight: '300' }}>+</Text>
                </View>
                <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, color: t.libreColor }}>Choisir mon partenaire</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {defiPartner && (
          <>
            {/* Moyenne du binôme */}
            <View style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 16, backgroundColor: 'rgba(255,193,26,0.08)', borderWidth: 1.5, borderColor: 'rgba(255,193,26,0.45)', borderRadius: 16, paddingVertical: 12, paddingHorizontal: 22 }}>
              <Icon name="users" size={30} color={Colors.brand} stroke={2.2} />
              <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: 'rgba(255,193,26,0.45)' }} />
              <View>
                <Text style={{ fontSize: 11, fontFamily: Fonts.uiBlack, color: Colors.textPrimary, letterSpacing: 1 }}>MOYENNE DU BINÔME</Text>
                <Text style={{ fontSize: 30, fontFamily: Fonts.uiBlack, color: Colors.brandDeep }}>{defiFloorLevel.toFixed(2)}</Text>
              </View>
            </View>

            {/* Plancher — sans objet pour un défi ciblé (adversaires déjà choisis) */}
            {!targeted && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: 'rgba(255,193,26,0.10)', borderWidth: 1.5, borderColor: 'rgba(255,193,26,0.55)', borderRadius: 18, padding: 16 }}>
                <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: Colors.brand, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="trophy" size={24} color="#0A0A0A" stroke={2.2} />
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={{ fontSize: 16, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>Plancher du défi</Text>
                  <Text style={{ fontSize: 12.5, fontFamily: Fonts.uiBold, color: Colors.textSecondary }}>
                    Niveau minimum éligible : <Text style={{ fontFamily: Fonts.uiBlack, color: Colors.brandDeep }}>{defiFloorLevel.toFixed(2)}</Text> (moyenne du binôme)
                  </Text>
                  <Text style={{ fontSize: 12, fontFamily: Fonts.ui, color: Colors.textMuted, lineHeight: 17 }}>
                    Seuls les binômes dont la moyenne est d'au moins {defiFloorLevel.toFixed(2)} pourront relever ton défi.
                  </Text>
                </View>
              </View>
            )}

            {/* Note d'équipe */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: Colors.bgCardAlt, borderRadius: 16, padding: 14 }}>
              <Icon name="radar" size={26} color={Colors.textPrimary} stroke={2} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>Même objectif, même ambition.</Text>
                <Text style={{ fontSize: 12, fontFamily: Fonts.ui, color: Colors.textSecondary, marginTop: 1 }}>Faites équipe et relevez le défi !</Text>
              </View>
            </View>
          </>
        )}

        {/* En mode ciblé : afficher Team B verrouillée (lecture seule) */}
        {targeted && (
          <>
            <Text style={[sty.sectionLabel, { marginTop: 10 }]}>Adversaires (verrouillés)</Text>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
              {teamBSlots.map(slot => {
                const opp = form.invites[slot];
                return (
                  <View key={slot} style={{
                    flex: 1, backgroundColor: t.teamBBg, borderWidth: 1.5,
                    borderColor: t.teamBBorder, borderRadius: 14, padding: 12,
                    alignItems: 'center', gap: 6, opacity: 0.85,
                  }}>
                    {opp ? (
                      <>
                        <Avatar name={opp.name} path={(opp as any).avatar_path} size={54} />
                        <Text style={{ fontSize: 12.5, fontWeight: '900', color: Colors.textPrimary }} numberOfLines={1}>
                          {opp.name.split(' ')[0]}
                        </Text>
                        <Text style={{ fontSize: 10, color: Colors.textMuted }}>Niv. {formatPadelLevel(opp.elo_score)}</Text>
                        <Text style={{ fontSize: 9, fontWeight: '700', color: Colors.textMuted, letterSpacing: 0.5 }}>🔒</Text>
                      </>
                    ) : (
                      <>
                        <View style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderStyle: 'dashed', borderColor: t.teamBBorder, alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ fontSize: 16, color: Colors.textMuted }}>?</Text>
                        </View>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: Colors.textMuted }}>Libre</Text>
                      </>
                    )}
                  </View>
                );
              })}
            </View>
          </>
        )}

        {/* Panneau d'invitation (réutilise le rendu existant : recherche + habituels) */}
        {renderInvitePanel()}
      </ScrollView>
    );
  }

  // ── Étape Défi : mise (3 paliers) + plafond de niveau adverse ──
  // Maquette « Mise & plafond » (2026-09-18) : Soft ×2 · Standard ×3 ·
  // High Stakes ×4 (contrainte serveur relevée à 4.0 : defi_stake_4.sql).
  function renderDefiSettings() {
    // Le plafond ne redescend jamais jusqu'au plancher : il resterait une
    // fourchette nulle, donc un défi que personne ne peut relever.
    const setCap   = (v: number) => set('maxLevel', +Math.min(8.0, Math.max(defiMinimumMaxLevel(defiFloorLevel), v)).toFixed(2));
    const partenaire = defiPartner?.name?.split(' ')[0] ?? 'ton binôme';
    const adversaires = ['B0', 'B1']
      .map(k => form.invites[k]?.name?.split(' ')[0])
      .filter((n): n is string => !!n);
    const carte = { backgroundColor: Colors.bgCard, borderRadius: 18, borderWidth: 1, borderColor: Colors.border, padding: 16 } as const;
    const pas = { width: 52, height: 52, borderRadius: 14, backgroundColor: Colors.bgCardAlt, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' } as const;
    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120, gap: 14 }}>
        {/* Mise */}
        <Text style={[sty.sectionLabel, { marginBottom: -4 }]}>Mise du défi</Text>
        <View style={carte}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 14 }}>
            <Icon name="zap" size={26} color={Colors.textPrimary} stroke={2} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>Mise</Text>
              <Text style={{ fontSize: 12, fontFamily: Fonts.ui, color: Colors.textMuted, marginTop: 1 }}>Multiplicateur ELO</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {DEFI_STAKES.map(p => {
              const on = form.stakeMultiplier === p.value;
              const ton = stakeTone(p.value);
              return (
                <TouchableOpacity
                  key={p.value}
                  onPress={() => set('stakeMultiplier', p.value)}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={{
                    flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 14,
                    backgroundColor: on ? ton.bg : Colors.bgCard,
                    borderWidth: 1.5, borderColor: on ? ton.bg : Colors.border,
                    borderTopWidth: on ? 1.5 : 4, borderTopColor: ton.bg,
                  }}
                >
                  <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}
                    style={{ fontSize: 13, fontFamily: Fonts.uiExtraBold, color: on ? ton.fg : Colors.textPrimary }}>
                    {p.label}
                  </Text>
                  <Text style={{ fontSize: 24, fontFamily: Fonts.uiBlack, color: on ? ton.fg : ton.soft, marginTop: 2 }}>
                    ×{p.value}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={{ fontSize: 13, fontFamily: Fonts.uiBold, color: stakeTone(form.stakeMultiplier).soft, textAlign: 'center', marginTop: 12 }}>
            Points ELO gagnés/perdus : ×{form.stakeMultiplier}
          </Text>
          <Text style={{ fontSize: 11.5, fontFamily: Fonts.ui, color: Colors.textMuted, textAlign: 'center', marginTop: 2 }}>
            Choisis l'intensité du défi.
          </Text>
        </View>

        {/* Mon binôme : son niveau moyen fixe le plancher */}
        <View style={[carte, { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: Colors.bgCardAlt }]}>
          <Icon name="users" size={24} color={Colors.textPrimary} stroke={2} />
          <Text style={{ flex: 1, fontSize: 14, fontFamily: Fonts.uiBold, color: Colors.textPrimary }}>
            <Text style={{ fontFamily: Fonts.uiBlack }}>Ton binôme</Text> : niveau moyen{' '}
            <Text style={{ fontFamily: Fonts.uiBlack, color: t.eloColor }}>{defiFloorLevel.toFixed(2)}</Text>
          </Text>
          <TouchableOpacity
            hitSlop={10}
            accessibilityLabel="Explication"
            onPress={() => Alert.alert(
              'Niveau moyen du binôme',
              `C'est la moyenne de ton niveau et de celui de ${partenaire}. `
              + (targeted
                ? 'Pour un défi ciblé, les adversaires sont déjà choisis : pas de plafond à régler.'
                : 'Les binômes adverses doivent avoir au moins ce niveau moyen, et au plus le niveau maximum choisi ci-dessous.'),
            )}
          >
            <Text style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: Colors.textSecondary, textAlign: 'center', lineHeight: 21, fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.textSecondary }}>i</Text>
          </TouchableOpacity>
        </View>

        {/* Niveau maximum adverse — masqué en mode ciblé (adversaires pré-désignés) */}
        {!targeted && (
          <>
            <Text style={[sty.sectionLabel, { marginBottom: -4 }]}>Niveau maximum adverse</Text>
            <View style={carte}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 12 }}>
                <Icon name="signal" size={26} color={Colors.textPrimary} stroke={2.2} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>Niveau maximum adverse</Text>
                  <Text style={{ fontSize: 12, fontFamily: Fonts.ui, color: Colors.textMuted, marginTop: 1 }}>Limite du niveau moyen du binôme</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 22 }}>
                <TouchableOpacity onPress={() => setCap(form.maxLevel - 0.1)} style={pas} accessibilityLabel="Baisser le niveau maximum">
                  <Text style={{ fontSize: 26, color: Colors.textPrimary }}>−</Text>
                </TouchableOpacity>
                <Text style={{ fontSize: 40, fontFamily: Fonts.uiBlack, color: t.eloColor, minWidth: 104, textAlign: 'center' }}>{form.maxLevel.toFixed(2)}</Text>
                <TouchableOpacity onPress={() => setCap(form.maxLevel + 0.1)} style={pas} accessibilityLabel="Monter le niveau maximum">
                  <Text style={{ fontSize: 26, color: Colors.textPrimary }}>+</Text>
                </TouchableOpacity>
              </View>
              <Text style={{ fontSize: 13, fontFamily: Fonts.uiBold, color: t.eloColor, textAlign: 'center', marginTop: 12 }}>
                Binômes acceptés : {defiFloorLevel.toFixed(2)} → {form.maxLevel.toFixed(2)}
              </Text>
            </View>
          </>
        )}

        {/* Visibilité : le défi reste privé tant que le binôme n'a pas accepté */}
        <View style={[carte, { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: t.eloBg, borderColor: t.eloBorder }]}>
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,193,26,0.18)', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="lock" size={20} color={Colors.textPrimary} stroke={2.3} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>Défi privé jusqu'à acceptation</Text>
            <Text style={{ fontSize: 12, fontFamily: Fonts.ui, color: Colors.textSecondary, marginTop: 2, lineHeight: 17 }}>
              {targeted
                ? `${adversaires.length > 0 ? adversaires.join(' & ') : 'Tes adversaires'} seront prévenus dès que ${partenaire} accepte.`
                : `La partie sera visible après l'acceptation de ${partenaire}.`}
            </Text>
          </View>
        </View>
      </ScrollView>
    );
  }

  // ─── Published screen ──────────────────────────────────────
  if (published) {
    return (
      <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
        <View style={{ flex: 1, backgroundColor: Colors.bg, paddingTop: insets.top }}>
          <View style={{ alignItems: 'center', padding: 32, paddingBottom: 16 }}>
            <Text numberOfLines={2}
              style={{ fontSize: 26, lineHeight: 34, fontFamily: Fonts.welcome, color: Colors.textPrimary, letterSpacing: 0.2, marginBottom: 6, paddingRight: 5 }}>
              Partie <Text style={{ color: Colors.brand }}>publiée !</Text>
            </Text>
            <Text style={{ fontSize: 13, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 }}>
              Visible dans l'Explorer.{Object.keys(form.invites).length > 0
                ? ` ${Object.keys(form.invites).length} invitation${Object.keys(form.invites).length > 1 ? 's' : ''} envoyée${Object.keys(form.invites).length > 1 ? 's' : ''}.`
                : ''}
            </Text>
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}>
            <View style={{ backgroundColor: Colors.bgCard, borderRadius: 18, borderWidth: 1.5, borderColor: Colors.border, overflow: 'hidden' }}>
              <View style={{ height: 4, backgroundColor: t.btnBg }} />
              <View style={{ padding: 14 }}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                  <Pill variant={form.gameType === 'Défi' ? 'brand' : form.gameType === 'Amical' ? 'success' : 'ink'}>{form.gameType}</Pill>
                  <Pill variant={form.genre === 'mixed' ? 'neutral' : form.genre === 'men' ? 'info' : 'magenta'}>
                    {form.genre === 'mixed' ? '⚧ Mixte' : form.genre === 'men' ? '♂ Hommes' : '♀ Femmes'}
                  </Pill>
                </View>
                <Text style={{ fontSize: 15, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary }}>
                  {ALL_DAYS.find(d => d.val === form.day)?.label || form.day}
                  <Text style={{ color: t.accent }}> · {form.time}</Text>
                </Text>
                <Text style={{ fontSize: 11, color: Colors.textMuted, marginTop: 3 }}>
                  Niv. {form.minLevel.toFixed(2)}–{form.maxLevel.toFixed(2)} · {form.location}
                </Text>
              </View>
            </View>
          </ScrollView>
          <View style={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 16, gap: 10 }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity onPress={shareCreatedGame} style={{
                flex: 1, padding: 13, borderRadius: 14, borderWidth: 1.5, borderColor: Colors.border,
                backgroundColor: Colors.bgCard, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
              }}>
                <Icon name="share" size={15} color={Colors.textPrimary} stroke={2} />
                <Text style={{ color: Colors.textPrimary, fontFamily: Fonts.uiExtraBold, fontWeight: '800', fontSize: 13 }}>Partager</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={addCreatedGameToCalendar} style={{
                flex: 1, padding: 13, borderRadius: 14, borderWidth: 1.5, borderColor: Colors.border,
                backgroundColor: Colors.bgCard, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
              }}>
                <Icon name="calendar" size={15} color={Colors.textPrimary} stroke={2} />
                <Text style={{ color: Colors.textPrimary, fontFamily: Fonts.uiExtraBold, fontWeight: '800', fontSize: 13 }}>Calendrier</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity onPress={onPublishedDone ?? onClose} style={{
              padding: 14, borderRadius: 14, backgroundColor: t.btnBg, alignItems: 'center',
              shadowColor: t.btnBg, shadowOpacity: 0.3, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 6,
            }}>
              <Text style={{ color: Colors.textOnDark, fontFamily: Fonts.uiBlack, fontWeight: '900', fontSize: 14 }}>Retour au Lobby</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  // ─── Wizard shell ──────────────────────────────────────────
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => setShowAbandon(true)}>
      <View style={{ flex: 1, backgroundColor: Colors.bg }}>

        {/* Abandon confirm */}
        {showAbandon && (
          <View style={{ position: 'absolute', inset: 0, zIndex: 100, backgroundColor: 'rgba(11,17,33,0.75)', justifyContent: 'flex-end' }}>
            <View style={{ backgroundColor: Colors.bgCard, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 32 }}>
              <Text style={{ fontSize: 32, textAlign: 'center', marginBottom: 10 }}>🚫</Text>
              <Text style={{ fontSize: 17, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary, textAlign: 'center', marginBottom: 8 }}>Abandonner la création ?</Text>
              <Text style={{ fontSize: 13, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: 22 }}>
                Ta partie n'a pas été sauvegardée.{'\n'}Toutes les informations seront perdues.
              </Text>
              <View style={{ gap: 9 }}>
                <TouchableOpacity onPress={() => { setShowAbandon(false); onClose(); }}
                  style={{ padding: 14, borderRadius: 14, backgroundColor: Colors.danger, alignItems: 'center' }}>
                  <Text style={{ color: Colors.textOnDark, fontFamily: Fonts.uiBlack, fontWeight: '900', fontSize: 14 }}>Abandonner</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setShowAbandon(false)}
                  style={{ padding: 13, borderRadius: 14, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.bgCard, alignItems: 'center' }}>
                  <Text style={{ color: Colors.textSecondary, fontFamily: Fonts.uiExtraBold, fontWeight: '800', fontSize: 14 }}>Continuer la création</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* Header */}
        <View style={{ backgroundColor: t.headerBg, paddingHorizontal: 16, paddingTop: insets.top + 12, paddingBottom: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <TouchableOpacity onPress={() => step > 0 ? setStep(s => s - 1) : undefined}
              style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center', opacity: step > 0 ? 1 : 0 }}>
              <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 16, fontWeight: '600' }}>‹</Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={2}
                style={{ fontSize: 22, lineHeight: 29, fontFamily: Fonts.welcome, color: Colors.textOnDark, letterSpacing: 0.2, paddingRight: 5 }}>
                Nouvelle <Text style={{ color: Colors.brand }}>partie</Text>
              </Text>
              <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontFamily: Fonts.uiSemi, fontWeight: '600' }}>{STEP_LABELS[step]}</Text>
            </View>
            {/* Step dots */}
            <View style={{ flexDirection: 'row', gap: 5, alignItems: 'center' }}>
              {STEP_LABELS.map((_, i) => (
                <View key={i} style={{ height: 6, borderRadius: 99, backgroundColor: i < step ? 'rgba(255,255,255,0.55)' : i === step ? Colors.textOnDark : 'rgba(255,255,255,0.18)', width: i === step ? 18 : 6 }} />
              ))}
            </View>
            <TouchableOpacity onPress={() => setShowAbandon(true)}
              style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center', marginLeft: 4 }}>
              <Icon name="x" size={14} color="rgba(255,255,255,0.7)" stroke={2.5} />
            </TouchableOpacity>
          </View>
          {/* Progress bar */}
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {STEP_LABELS.map((_, i) => (
              <View key={i} style={{ flex: 1, height: 3, borderRadius: 99,
                backgroundColor: i < step ? 'rgba(255,255,255,0.75)' : i === step ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.12)',
              }} />
            ))}
          </View>
        </View>

        {/* Step content */}
        <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 18 }}>
          {step === 0 && renderStep0()}
          {step === 1 && renderStep1()}
          {step === 2 && (isDefi ? renderDefiBinome() : renderStep2())}
          {step === 3 && isDefi && renderDefiSettings()}
        </View>

        {/* CTA */}
        <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: insets.bottom + 14, backgroundColor: Colors.bgCard, borderTopWidth: 1.5, borderTopColor: Colors.border, flexDirection: 'row', gap: 8 }}>
          {step > 0 && (
            <TouchableOpacity onPress={() => setStep(s => s - 1)}
              style={{ width: 50, height: 50, borderRadius: 13, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.bgCard, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: Colors.textSecondary, fontWeight: '900', fontSize: 16 }}>‹</Text>
            </TouchableOpacity>
          )}
          {step < LAST_STEP ? (
            <TouchableOpacity onPress={() => canNext && setStep(s => s + 1)}
              activeOpacity={canNext ? 0.8 : 1}
              style={{ flex: 1, height: 50, borderRadius: 14, backgroundColor: canNext ? t.btnBg : Colors.border, alignItems: 'center', justifyContent: 'center',
                ...(canNext ? { shadowColor: t.btnBg, shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 } : {}),
              }}>
              <Text style={{ color: canNext ? Colors.textOnDark : Colors.textMuted, fontFamily: Fonts.uiBlack, fontWeight: '900', fontSize: 14 }}>
                {step === 0 && !canNext ? 'Choisissez un terrain, une date et une heure' : 'Continuer →'}
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={handlePublish} disabled={submitting}
              style={{ flex: 1, height: 50, borderRadius: 14, backgroundColor: submitting ? Colors.border : t.btnBg, alignItems: 'center', justifyContent: 'center',
                ...(!submitting ? { shadowColor: t.btnBg, shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 } : {}),
              }}>
              {submitting
                ? <ActivityIndicator color={Colors.textMuted} />
                : <Text style={{ color: Colors.textOnDark, fontFamily: Fonts.uiBlack, fontWeight: '900', fontSize: 14 }}>Publier la partie</Text>
              }
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────
const sty = StyleSheet.create({
  sectionLabel: {
    fontSize: 10, fontWeight: '900', color: Colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 7,
  },
});
