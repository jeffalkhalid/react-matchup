import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Modal, TextInput,
  Alert, ActivityIndicator, StyleSheet, Dimensions, KeyboardAvoidingView, Platform,
  Share, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { Colors, eloToLevel, formatPadelLevel, padelLevelToElo, Fonts } from '../../lib/theme';
import { lobbyGameLink } from '../../lib/community';
import { Pill } from '../../components/Pill';

// ─── Types ────────────────────────────────────────────────────
type GameType = 'Compétitif' | 'Amical' | 'Défi';
type Genre    = 'mixed' | 'men' | 'women';
type BusyGame = { ts: number; location: string | null; role: string };

export interface WizardResult {
  gameType: GameType; genre: Genre;
  matchDate: string; matchTime: string;
  location: string; hasReservation: boolean;
  minLevel: number; maxLevel: number;
  creatorSide: string;
  confirmedPlayers: Array<{ id: string; name: string; elo_score: number; team_side?: string }>;
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
  initialInvites?: Partial<Record<'A1' | 'B0' | 'B1', { id: string; name: string; elo_score: number }>>;
}

// ─── Constants ────────────────────────────────────────────────
const SLOT_TO_SIDE: Record<string, string> = { A0: 'A_GAU', A1: 'A_DRO', B0: 'B_GAU', B1: 'B_DRO' };
const SCREEN_LABELS = ['Quand & Où', 'La partie', "L'équipe"];

const TIMES = [
  '08:00','08:30','09:00','09:30','10:00','10:30','11:00','11:30',
  '12:00','12:30','13:00','13:30','14:00','14:30','15:00','15:30',
  '16:00','16:30','17:00','17:30','18:00','18:30','19:00','19:30',
  '20:00','20:30','21:00','21:30','22:00','22:30',
];
// Fenêtre d'anti-chevauchement (identique au pre-check du publish dans lobby.tsx)
const OVERLAP_MS = 2 * 60 * 60 * 1000;
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
function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const tone = hashTone(name);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: tone.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: tone.fg, fontSize: Math.round(size * 0.4), fontWeight: '900' }}>
        {(name || '?').charAt(0).toUpperCase()}
      </Text>
    </View>
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
export default function CreateWizard({ visible, onClose, onPublishedDone, onPublish, player, initialGameType, initialInvite, initialInvites }: Props) {
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
  const [inviteTarget, setInviteTarget] = useState<string | null>(null);

  // Data
  const [clubsList,   setClubsList]   = useState<string[]>([]);
  const [freqPlayers, setFreqPlayers] = useState<Array<{ id: string; name: string; elo_score: number }>>([]);
  const [searchQ,     setSearchQ]     = useState('');
  const [searchRes,   setSearchRes]   = useState<any[]>([]);
  const [searching,   setSearching]   = useState(false);
  const [busyGames, setBusyGames] = useState<BusyGame[]>([]);

  // Form
  const myLevel = player ? eloToLevel(player.elo_score) : 4.0;
  const defaultMin = Math.max(1.0, Math.round((myLevel - 0.5) * 2) / 2);
  const defaultMax = Math.min(9.0, Math.round((myLevel + 0.5) * 2) / 2);

  const [form, setFormState] = useState({
    day:            QUICK_DAYS[1]?.val ?? '',
    time:           '19:00',
    location:       '',
    hasReservation: false,
    gameType:       'Compétitif' as GameType,
    genre:          'mixed' as Genre,
    minLevel:       defaultMin,
    maxLevel:       defaultMax,
    mySlot:         'A0' as string | null,
    invites:        {} as Record<string, { id: string; name: string; elo_score: number }>,
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

  // Reset on open
  useEffect(() => {
    if (!visible) return;
    const lv = player ? eloToLevel(player.elo_score) : 4.0;
    const mn = Math.max(1.0, Math.round((lv - 0.5) * 2) / 2);
    const mx = Math.min(9.0, Math.round((lv + 0.5) * 2) / 2);
    setStep(0); setPublished(false); setPublishedGameId(null); setSubmitting(false);
    setShowAbandon(false); setShowCal(false); setVenueOpen(false); setVenueSearch('');
    setInviteTarget(null); setSearchQ(''); setSearchRes([]);
    const gameType = initialGameType ?? 'Compétitif';
    const invites: Record<string, { id: string; name: string; elo_score: number }> = {};
    if (initialInvites) {
      (['A1', 'B0', 'B1'] as const).forEach(slot => {
        const p = initialInvites[slot];
        if (p) invites[slot] = { id: p.id, name: p.name, elo_score: p.elo_score };
      });
    } else if (initialInvite) {
      const opponentSlot = initialInvite.court_side === 'right' ? 'B1' : 'B0';
      invites[opponentSlot] = {
        id: initialInvite.id,
        name: initialInvite.name,
        elo_score: initialInvite.elo_score,
      };
    }
    const defaultGenre: Genre =
      player?.gender === 'male' ? 'men' : player?.gender === 'female' ? 'women' : 'mixed';
    setFormState({
      day: QUICK_DAYS[1]?.val ?? '', time: '19:00', location: '',
      hasReservation: false, gameType, genre: defaultGenre,
      minLevel: mn, maxLevel: mx, mySlot: 'A0', invites,
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
        supabase.from('players').select('id,name,elo_score').in('id', topIds).is('deleted_at', null).then(({ data: players }) => {
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
          .select('status, game:game_id(location, match_date, status)')
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
      (joined ?? []).forEach((p: any) => {
        const g = p.game;
        if (!g || g.status === 'cancelled' || !g.match_date) return;
        const ts = new Date(g.match_date).getTime();
        if (ts < todayStart.getTime()) return;
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
      supabase.from('players').select('id,name,elo_score')
        .is('deleted_at', null)
        .ilike('name', `%${searchQ}%`)
        .neq('id', player?.id ?? '')
        .limit(6)
        .then(({ data }) => { setSearchRes(data || []); setSearching(false); });
    }, 300);
    return () => clearTimeout(t);
  }, [searchQ, player]);

  // Step validation
  const canNext = [
    !!form.day && !!form.time && !!form.location && !isPastSlot(form.day, form.time),
    !!form.gameType && form.minLevel <= form.maxLevel,
    true,
  ][step] ?? true;

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
      if (busyGames.some(g => Math.abs(g.ts - slotTs) <= OVERLAP_MS)) s.add(tm);
    }
    return s;
  }, [busyGames, form.day]);
  const selectedConflicts = useMemo<BusyGame[]>(() => {
    if (!form.day || !form.time) return [];
    const slotTs = new Date(`${form.day}T${form.time}`).getTime();
    if (isNaN(slotTs)) return [];
    return busyGames.filter(g => Math.abs(g.ts - slotTs) <= OVERLAP_MS);
  }, [busyGames, form.day, form.time]);

  // Step 2 helpers
  const invitedPlayers = Object.values(form.invites);
  const filledCount    = ['A0','A1','B0','B1'].filter(k => k === form.mySlot || form.invites[k]).length;
  const missingCount   = 4 - filledCount;
  const freqAvail  = freqPlayers.filter(fp => !invitedPlayers.find(i => i.id === fp.id) && fp.id !== player?.id);
  const searchAvail = searchRes.filter(r => !invitedPlayers.find(i => i.id === r.id) && r.id !== player?.id);

  function openInvite(key: string) { setInviteTarget(key); setSearchQ(''); }

  function assignPlayer(p: { id: string; name: string; elo_score: number }) {
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
        creatorSide:    form.mySlot ? SLOT_TO_SIDE[form.mySlot] : 'A_GAU',
        confirmedPlayers: Object.entries(form.invites).map(([slot, p]) => ({ ...p, team_side: SLOT_TO_SIDE[slot] })),
      });
      setPublishedGameId(newId ?? null);
      setPublished(true);
    } catch { /* onPublish shows Alert */ }
    finally { setSubmitting(false); }
  }

  // ─── Partage + Ajout au calendrier (écran "Partie publiée") ────
  async function shareCreatedGame() {
    const start = new Date(`${form.day}T${form.time}:00`);
    const dateStr = start.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    const link = publishedGameId ? `\n🔗 ${lobbyGameLink(publishedGameId)}` : '';
    const msg =
      `Match Padel – ${form.gameType}\n` +
      `📅 ${dateStr} à ${form.time}\n` +
      `📍 ${form.location}\n` +
      `📊 Niveau : ${form.minLevel.toFixed(2)} – ${form.maxLevel.toFixed(2)}${link}`;
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

  // ─── Step 0: When & Where ──────────────────────────────────
  function renderStep0() {
    const filteredClubs = clubsList.filter(c => c.toLowerCase().includes(venueSearch.toLowerCase()));
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
          <Text style={{ fontSize: 15 }}>📅</Text>
          <Text style={{ flex: 1, fontSize: 13, fontFamily: Fonts.uiBlack, fontWeight: '900', color: form.hasReservation ? Colors.brandDeep : Colors.textSecondary }}>
            J'ai une réservation
          </Text>
          <View style={{ width: 42, height: 24, borderRadius: 99, backgroundColor: form.hasReservation ? Colors.brand : Colors.border, justifyContent: 'center', paddingHorizontal: 3 }}>
            <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: Colors.bgCard, alignSelf: form.hasReservation ? 'flex-end' : 'flex-start', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 2 }} />
          </View>
        </TouchableOpacity>

        {/* Venue picker */}
        <TouchableOpacity onPress={() => setVenueOpen(v => !v)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 13,
            borderWidth: 1.5, borderColor: form.location ? t.eloBorder : Colors.border,
            backgroundColor: form.location ? t.selectBg : Colors.bgCard, marginBottom: venueOpen ? 0 : 10,
          }}>
          <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: form.location ? t.btnBg : Colors.bgCardAlt, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 14 }}>📍</Text>
          </View>
          <Text style={{ flex: 1, fontSize: 13, fontWeight: form.location ? '900' : '500', color: form.location ? t.selectColor : Colors.textMuted }}>
            {form.location || 'Choisir un terrain…'}
          </Text>
          <Text style={{ color: Colors.textMuted, fontSize: 12 }}>{venueOpen ? '▲' : '▼'}</Text>
        </TouchableOpacity>

        {venueOpen && (
          <View style={{ backgroundColor: Colors.bgCard, borderWidth: 1.5, borderColor: t.eloBorder, borderTopWidth: 0, borderBottomLeftRadius: 13, borderBottomRightRadius: 13, marginBottom: 10, overflow: 'hidden' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderBottomWidth: 1, borderBottomColor: Colors.bgCardAlt }}>
              <Text style={{ fontSize: 13 }}>🔍</Text>
              <TextInput
                value={venueSearch} onChangeText={setVenueSearch}
                placeholder="Rechercher…" placeholderTextColor={Colors.textMuted}
                style={{ flex: 1, fontSize: 13, color: Colors.textPrimary }}
                autoFocus
              />
              {venueSearch ? <TouchableOpacity onPress={() => setVenueSearch('')}><Text style={{ color: Colors.textMuted }}>✕</Text></TouchableOpacity> : null}
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
                    {active && <Text style={{ color: t.accent, fontWeight: '900' }}>✓</Text>}
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
            <Text style={{ fontSize: 13 }}>📅</Text>
            <Text style={{ fontSize: 12, fontWeight: '900', color: t.selectColor, flex: 1 }}>
              {ALL_DAYS.find(d => d.val === form.day)?.label || form.day}
            </Text>
            <TouchableOpacity onPress={() => pickDay(QUICK_DAYS[0].val)}>
              <Text style={{ color: t.selectColor, fontWeight: '900' }}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Time */}
        <Text style={[sty.sectionLabel, { marginTop: 4 }]}>Heure</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
          {TIMES.map(tm => {
            const active = form.time === tm;
            const past   = isPastSlot(form.day, tm);
            return (
              <TouchableOpacity key={tm} disabled={past} onPress={() => set('time', tm)}
                style={{ width: '23%', paddingVertical: 9, borderRadius: 10,
                  borderWidth: 1.5, borderColor: active ? t.eloBorder : Colors.border,
                  backgroundColor: active ? t.selectBg : Colors.bgCard, alignItems: 'center',
                  opacity: past ? 0.35 : 1,
                }}>
                <Text style={{ fontSize: 12, fontWeight: active ? '900' : '600',
                  color: active ? t.selectColor : Colors.textPrimary,
                  textDecorationLine: past ? 'line-through' : 'none' }}>{tm}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    );
  }

  // ─── Step 1: The match ─────────────────────────────────────
  function renderStep1() {
    const gameOptions: Array<{ val: GameType; icon: string; desc: string }> = [
      { val: 'Compétitif', icon: '🏆', desc: 'Points ELO, matchs classés' },
      { val: 'Amical',     icon: '😄', desc: 'Détente, sans classement' },
      { val: 'Défi',       icon: '⚡', desc: 'Défier une équipe adverse' },
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
                  const mn = Math.max(1.0, +(lv - 0.5).toFixed(2));
                  const mx = Math.min(9.0, +(lv + 0.5).toFixed(2));
                  if (opt.val === 'Compétitif') setFormState(f => ({ ...f, gameType: opt.val, minLevel: mn, maxLevel: mx }));
                  else if (opt.val === 'Défi')  setFormState(f => ({ ...f, gameType: opt.val, minLevel: mx }));
                  else set('gameType', opt.val);
                }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14,
                  borderWidth: 2, borderColor: active ? ot.eloBorder : Colors.border,
                  backgroundColor: active ? ot.teamABg : Colors.bgCard,
                }}>
                <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: active ? ot.btnBg : Colors.bgCardAlt, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 20 }}>{opt.icon}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, fontWeight: '900', color: active ? ot.eloColor : Colors.textPrimary }}>{opt.val}</Text>
                  <Text style={{ fontSize: 11, color: Colors.textMuted, marginTop: 1 }}>{opt.desc}</Text>
                </View>
                {active && <Text style={{ color: ot.accent, fontWeight: '900', fontSize: 16 }}>✓</Text>}
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
                {active && <Text style={{ color: t.accent, fontWeight: '900' }}>✓</Text>}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Level range */}
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
                  <TouchableOpacity onPress={() => set('minLevel', Math.min(9.0, +(form.minLevel + 0.1).toFixed(2)))}
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
                  <TouchableOpacity onPress={() => set('maxLevel', Math.max(form.minLevel, +(form.maxLevel - 0.1).toFixed(2)))}
                    style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: Colors.bgCardAlt, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 18, color: Colors.textPrimary }}>−</Text>
                  </TouchableOpacity>
                )}
                <Text style={{ fontSize: 26, fontFamily: Fonts.uiBlack, fontWeight: '900', color: t.eloColor, minWidth: 42, textAlign: 'center' }}>
                  {form.maxLevel.toFixed(2)}
                </Text>
                {!lockMax && (
                  <TouchableOpacity onPress={() => set('maxLevel', Math.min(9.0, +(form.maxLevel + 0.1).toFixed(2)))}
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
              left: `${((form.minLevel - 1) / 8) * 100}%`,
              right: `${100 - ((form.maxLevel - 1) / 8) * 100}%`,
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

        {/* Slot grid */}
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
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
                  const isMe   = form.mySlot === key;
                  const inv    = form.invites[key];
                  const isEmpty = !isMe && !inv;
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
                        style={{ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center',
                          backgroundColor: isMe ? Colors.primary : inv ? Colors.brand : t.libreBg,
                          borderWidth: isEmpty ? 2 : isMe ? 2.5 : 0,
                          borderStyle: isEmpty ? 'dashed' : 'solid',
                          borderColor: isEmpty ? t.libreBorder : isMe ? Colors.bgCard : 'transparent',
                        }}>
                        {isMe
                          ? <Text style={{ color: Colors.textOnDark, fontWeight: '900', fontSize: 14 }}>{(player?.name || '?').charAt(0).toUpperCase()}</Text>
                          : inv
                            ? <Text style={{ color: Colors.textOnBrand, fontWeight: '900', fontSize: 14 }}>{(inv.name || '?').charAt(0).toUpperCase()}</Text>
                            : <Text style={{ color: t.libreColor, fontSize: 20, fontWeight: '300' }}>+</Text>
                        }
                      </TouchableOpacity>
                      <Text style={{ fontSize: 9.5, fontWeight: '700', color: isMe ? Colors.primary : inv ? Colors.primary : t.libreColor, maxWidth: 52, textAlign: 'center' }} numberOfLines={1}>
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
        {inviteTarget && (
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={{ backgroundColor: Colors.bgCard, borderWidth: 1.5, borderColor: Colors.border, borderRadius: 14, padding: 12, marginBottom: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <Text style={{ fontSize: 11, fontWeight: '900', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                  Inviter — Éq. {inviteTarget[0]} · {inviteTarget[1] === '0' ? 'Gauche' : 'Droite'}
                </Text>
                <TouchableOpacity onPress={() => { setInviteTarget(null); setSearchQ(''); }}
                  style={{ width: 24, height: 24, backgroundColor: Colors.bgCardAlt, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 11, color: Colors.textSecondary, fontWeight: '900' }}>✕</Text>
                </TouchableOpacity>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.bg, borderRadius: 10, padding: 10, borderWidth: 1.5, borderColor: Colors.border, marginBottom: 10 }}>
                <Text style={{ fontSize: 13 }}>🔍</Text>
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
                        <Avatar name={p.name} size={32} />
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
                      <Avatar name={p.name} size={32} />
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
        )}

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

  // ─── Published screen ──────────────────────────────────────
  if (published) {
    return (
      <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
        <View style={{ flex: 1, backgroundColor: Colors.bg, paddingTop: insets.top }}>
          <View style={{ alignItems: 'center', padding: 32, paddingBottom: 16 }}>
            <Text style={{ fontSize: 26, fontFamily: Fonts.welcome, color: Colors.textPrimary, letterSpacing: 0.2, marginBottom: 6 }}>
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
                <Text style={{ fontSize: 15 }}>📤</Text>
                <Text style={{ color: Colors.textPrimary, fontFamily: Fonts.uiExtraBold, fontWeight: '800', fontSize: 13 }}>Partager</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={addCreatedGameToCalendar} style={{
                flex: 1, padding: 13, borderRadius: 14, borderWidth: 1.5, borderColor: Colors.border,
                backgroundColor: Colors.bgCard, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
              }}>
                <Text style={{ fontSize: 15 }}>📅</Text>
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
              <Text style={{ fontSize: 22, fontFamily: Fonts.welcome, color: Colors.textOnDark, letterSpacing: 0.2 }}>
                Nouvelle <Text style={{ color: Colors.brand }}>partie</Text>
              </Text>
              <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontFamily: Fonts.uiSemi, fontWeight: '600' }}>{SCREEN_LABELS[step]}</Text>
            </View>
            {/* Step dots */}
            <View style={{ flexDirection: 'row', gap: 5, alignItems: 'center' }}>
              {[0, 1, 2].map(i => (
                <View key={i} style={{ height: 6, borderRadius: 99, backgroundColor: i < step ? 'rgba(255,255,255,0.55)' : i === step ? Colors.textOnDark : 'rgba(255,255,255,0.18)', width: i === step ? 18 : 6 }} />
              ))}
            </View>
            <TouchableOpacity onPress={() => setShowAbandon(true)}
              style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center', marginLeft: 4 }}>
              <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: '900' }}>✕</Text>
            </TouchableOpacity>
          </View>
          {/* Progress bar */}
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {[0, 1, 2].map(i => (
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
          {step === 2 && renderStep2()}
        </View>

        {/* CTA */}
        <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: insets.bottom + 14, backgroundColor: Colors.bgCard, borderTopWidth: 1.5, borderTopColor: Colors.border, flexDirection: 'row', gap: 8 }}>
          {step > 0 && (
            <TouchableOpacity onPress={() => setStep(s => s - 1)}
              style={{ width: 50, height: 50, borderRadius: 13, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.bgCard, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: Colors.textSecondary, fontWeight: '900', fontSize: 16 }}>‹</Text>
            </TouchableOpacity>
          )}
          {step < 2 ? (
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
